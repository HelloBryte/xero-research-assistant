import { createHash } from 'node:crypto';
import type { RunLog } from './activity.js';
import { buildChunks } from './chunk.js';
import { extractPage } from './extract.js';
import { FetchFailure, fetchPage, type PageFetcher } from './http.js';
import type { ResearchStore } from './store.js';
import type {
  ResearchReport,
  SourceConfig,
  SourceOutcomeReport,
  SourceRecord,
  StoredFailure,
} from './types.js';

export interface ResearchOptions {
  store: ResearchStore;
  run: RunLog;
  sources: SourceConfig[];
  /** `gather` only touches sources that are not already stored; `refresh` re-fetches. */
  mode: 'gather' | 'refresh';
  /** Restrict the run to specific source ids. */
  only?: string[];
  /**
   * Reprocess even when the fetched bytes are unchanged. Needed after the
   * extraction or chunking code changes, since the store keeps passages rather
   * than the raw HTML they came from.
   */
  force?: boolean;
  fetcher?: PageFetcher;
}

/**
 * Fetch, extract and store the configured sources.
 *
 * The reuse rule lives here, not in the answering path: once a source has been
 * successfully processed, `gather` leaves it alone entirely, and `refresh`
 * re-fetches but skips reprocessing when the bytes are byte-for-byte identical
 * to what was stored.
 */
export async function runResearch(options: ResearchOptions): Promise<ResearchReport> {
  const { store, run, mode } = options;
  const fetcher = options.fetcher ?? fetchPage;
  const startedAt = new Date().toISOString();

  const selected = options.only?.length
    ? options.sources.filter((source) => options.only!.includes(source.id))
    : options.sources;

  if (options.only?.length) {
    const missing = options.only.filter((id) => !options.sources.some((source) => source.id === id));
    if (missing.length) throw new Error(`Unknown source id(s): ${missing.join(', ')}`);
  }

  run.event('run_started', `${mode} started for ${selected.length} source(s)${options.force ? ' (forced reprocessing)' : ''}`, {
    mode,
    force: Boolean(options.force),
    sourceIds: selected.map((source) => source.id),
  });

  const reports: SourceOutcomeReport[] = [];

  // Configuration is the source of truth: evidence for sources that have been
  // removed from config is pruned so it can never be cited again.
  if (!options.only?.length) {
    const configured = new Set(options.sources.map((source) => source.id));
    for (const stored of store.listSources()) {
      if (configured.has(stored.id)) continue;
      store.removeSource(stored.id);
      run.event('source_removed', `${stored.id} is no longer configured; its evidence was removed`, {
        sourceId: stored.id,
        url: stored.url,
      });
      reports.push({ sourceId: stored.id, url: stored.url, outcome: 'removed' });
    }
  }

  for (const source of selected) {
    reports.push(await processSource(source, { ...options, fetcher }));
  }

  const finishedAt = new Date().toISOString();
  const ok = reports.every((report) => report.outcome !== 'failed');
  run.event('run_finished', summarise(mode, reports), {
    mode,
    ok,
    outcomes: reports.map(({ sourceId, outcome }) => ({ sourceId, outcome })),
  });

  return { runId: run.runId, mode, startedAt, finishedAt, sources: reports, ok };
}

async function processSource(
  source: SourceConfig,
  options: ResearchOptions & { fetcher: PageFetcher },
): Promise<SourceOutcomeReport> {
  const { store, run, mode, fetcher } = options;
  const existing = store.getSource(source.id);

  // A stored source whose configured URL has since changed is not reusable.
  const urlChanged = existing !== undefined && existing.url !== source.url;

  if (mode === 'gather' && existing && !urlChanged) {
    run.event('source_reused', `${source.id} reused from storage (no network request)`, {
      sourceId: source.id,
      url: existing.url,
      fetchedAt: existing.fetchedAt,
      chunks: existing.chunkCount,
    });
    return {
      sourceId: source.id,
      url: existing.url,
      outcome: 'reused',
      chunkCount: existing.chunkCount,
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetcher(source.url);
    const contentHash = createHash('sha256').update(response.body).digest('hex');
    const durationMs = Date.now() - startedAt;

    if (existing && !urlChanged && !options.force && existing.contentHash === contentHash) {
      store.markUnchanged(source.id, response.fetchedAt);
      run.event('source_unchanged', `${source.id} re-fetched and unchanged; processing skipped`, {
        sourceId: source.id,
        url: source.url,
        contentHash: contentHash.slice(0, 12),
        durationMs,
      });
      return { sourceId: source.id, url: source.url, outcome: 'unchanged', chunkCount: existing.chunkCount, durationMs };
    }

    const contentIsNew = !existing || urlChanged || existing.contentHash !== contentHash;
    const extracted = extractPage(response.body, source.label ?? source.url);
    const chunks = buildChunks(source.id, extracted.blocks);

    if (chunks.length === 0) {
      throw new FetchFailure(
        'empty_extraction',
        `No readable content extracted from ${source.url} (${response.bytes} bytes fetched)`,
        response.status,
      );
    }

    const now = new Date().toISOString();
    const record: SourceRecord = {
      id: source.id,
      url: source.url,
      finalUrl: response.finalUrl,
      title: extracted.title,
      region: source.region,
      currency: source.currency,
      topic: source.topic,
      fetchedAt: response.fetchedAt,
      // A forced rebuild reprocesses identical bytes, so the "content changed"
      // timestamp must not move: it is what tells a reviewer whether the page
      // itself is new or only our processing of it.
      contentChangedAt: contentIsNew ? response.fetchedAt : existing!.contentChangedAt,
      processedAt: now,
      contentHash,
      httpStatus: response.status,
      bytes: response.bytes,
      charCount: extracted.charCount,
      chunkCount: chunks.length,
      lastError: null,
      lastAttemptAt: response.fetchedAt,
    };
    store.saveSource(record, chunks);

    const outcome = existing ? 'reprocessed' : 'fetched';
    const reason = !existing
      ? 'fetched and processed'
      : contentIsNew
        ? 'changed and was reprocessed'
        : 'unchanged but rebuilt on request';
    run.event(
      existing ? 'source_reprocessed' : 'source_fetched',
      `${source.id} ${reason}: ${chunks.length} passage(s) from ${extracted.charCount} characters`,
      {
        contentChanged: contentIsNew,
        sourceId: source.id,
        url: source.url,
        title: extracted.title,
        httpStatus: response.status,
        bytes: response.bytes,
        chunks: chunks.length,
        contentHash: contentHash.slice(0, 12),
        durationMs,
      },
    );
    return { sourceId: source.id, url: source.url, outcome, chunkCount: chunks.length, durationMs };
  } catch (error) {
    const failure = toStoredFailure(error);
    store.recordFailure(source.id, source.url, failure);

    // Evidence gathered earlier stays in place and keeps its original retrieval
    // time, so a failed refresh can never be presented as fresh research.
    const stillServing = store.getSource(source.id)?.fetchedAt;
    run.event(
      'source_failed',
      `${source.id} failed (${failure.kind}): ${failure.message}` +
        (stillServing ? ` — continuing to serve evidence retrieved ${stillServing}` : ' — no stored evidence available'),
      {
        sourceId: source.id,
        url: source.url,
        kind: failure.kind,
        httpStatus: failure.httpStatus,
        servingEvidenceFrom: stillServing ?? null,
      },
    );
    return {
      sourceId: source.id,
      url: source.url,
      outcome: 'failed',
      error: failure,
      ...(stillServing ? { servingEvidenceFrom: stillServing } : {}),
      durationMs: Date.now() - startedAt,
    };
  }
}

function toStoredFailure(error: unknown): StoredFailure {
  const at = new Date().toISOString();
  if (error instanceof FetchFailure) {
    return { at, kind: error.kind, message: error.message, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) };
  }
  return { at, kind: 'network', message: (error as Error)?.message ?? String(error) };
}

function summarise(mode: string, reports: SourceOutcomeReport[]): string {
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report.outcome, (counts.get(report.outcome) ?? 0) + 1);
  const parts = [...counts.entries()].map(([outcome, count]) => `${count} ${outcome}`);
  return `${mode} finished: ${parts.join(', ') || 'nothing to do'}`;
}
