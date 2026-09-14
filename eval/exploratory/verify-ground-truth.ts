/**
 * Independent fact check against the live pages.
 *
 * Everything else in this repository verifies a claim against the *stored*
 * passage. That proves the answer matches what was retained; it cannot prove
 * what was retained matches the page. This script closes that loop from the
 * other side: it fetches each configured URL itself with plain `fetch` and a
 * crude tag strip, deliberately not using `src/extract.ts`, so a bug in our own
 * extraction cannot make a wrong fact look right.
 *
 * It also reports whether the live page still agrees with the stored copy, which
 * is what a stale-evidence check looks like in practice.
 *
 *   npm run verify:sources
 *
 * Results are archived under eval/exploratory/results/ground-truth-<timestamp>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, loadSources, projectRoot } from '../../src/config.js';
import { configureConnectionTimeouts } from '../../src/net.js';
import { ResearchStore } from '../../src/store.js';

interface Fact {
  sourceId: string;
  fact: string;
  pattern: string;
}

interface FactResult extends Fact {
  url: string;
  onLivePage: boolean;
  inStoredResearch: boolean;
  verdict: 'confirmed' | 'stored-only' | 'live-only' | 'missing';
}

/** Crude, on purpose: this must not share code with the extractor being checked. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ');
}

configureConnectionTimeouts();

async function main(): Promise<number> {
  const { facts } = JSON.parse(
    readFileSync(resolve(projectRoot, 'eval/exploratory/ground-truth.json'), 'utf8'),
  ) as { facts: Fact[] };

  const sources = new Map(loadSources().map((source) => [source.id, source]));
  const store = ResearchStore.open();
  const startedAt = new Date().toISOString();

  const needed = [...new Set(facts.map((fact) => fact.sourceId))];
  const livePages = new Map<string, { text: string; status: number; error?: string }>();

  for (const sourceId of needed) {
    const source = sources.get(sourceId);
    if (!source) {
      livePages.set(sourceId, { text: '', status: 0, error: 'not in config/sources.json' });
      continue;
    }
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': config.http.userAgent, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.http.timeoutMs),
      });
      livePages.set(sourceId, { text: visibleText(await response.text()), status: response.status });
      console.log(`  fetched ${sourceId} (${response.status})`);
    } catch (error) {
      livePages.set(sourceId, { text: '', status: 0, error: (error as Error).message });
      console.log(`  FAILED  ${sourceId}: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, config.http.minHostIntervalMs));
  }

  const storedText = new Map(
    needed.map((sourceId) => [
      sourceId,
      store
        .chunksForSource(sourceId)
        .map((chunk) => `${chunk.heading ?? ''} ${chunk.text}`)
        .join(' ')
        .replace(/\s+/g, ' '),
    ]),
  );

  const results: FactResult[] = facts.map((fact) => {
    const pattern = new RegExp(fact.pattern, 'i');
    const live = livePages.get(fact.sourceId);
    const onLivePage = live ? pattern.test(live.text) : false;
    const inStoredResearch = pattern.test(storedText.get(fact.sourceId) ?? '');
    return {
      ...fact,
      url: sources.get(fact.sourceId)?.url ?? '',
      onLivePage,
      inStoredResearch,
      verdict: onLivePage && inStoredResearch
        ? 'confirmed'
        : inStoredResearch
          ? 'stored-only'
          : onLivePage
            ? 'live-only'
            : 'missing',
    };
  });

  const tally = (verdict: FactResult['verdict']) => results.filter((r) => r.verdict === verdict).length;
  const run = {
    startedAt,
    finishedAt: new Date().toISOString(),
    method:
      'Each URL is fetched directly and tag-stripped by this script, not by src/extract.ts, so the check is ' +
      'independent of the extraction code it is checking.',
    pages: needed.map((sourceId) => ({
      sourceId,
      url: sources.get(sourceId)?.url ?? '',
      httpStatus: livePages.get(sourceId)?.status ?? 0,
      error: livePages.get(sourceId)?.error ?? null,
      storedRetrievedAt: store.getSource(sourceId)?.fetchedAt ?? null,
    })),
    facts: results,
    summary: {
      facts: results.length,
      confirmed: tally('confirmed'),
      storedOnly: tally('stored-only'),
      liveOnly: tally('live-only'),
      missing: tally('missing'),
    },
  };

  const directory = join(
    resolve(projectRoot, 'eval/exploratory/results'),
    `ground-truth-${startedAt.replace(/[:.]/g, '-')}`,
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'results.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  writeFileSync(join(directory, 'report.md'), renderMarkdown(run), 'utf8');

  console.log(
    `\n${run.summary.confirmed}/${run.summary.facts} facts confirmed on the live page and in the stored research.`,
  );
  for (const result of results.filter((r) => r.verdict !== 'confirmed')) {
    console.log(`  ${result.verdict.padEnd(12)} ${result.sourceId}: ${result.fact}`);
  }
  console.log(`\nArchived to ${directory}`);
  return run.summary.confirmed === run.summary.facts ? 0 : 1;
}

function renderMarkdown(run: GroundTruthRun): string {
  const lines: string[] = [];
  lines.push('# Ground-truth check against the live pages');
  lines.push('');
  lines.push(`**Run:** ${run.startedAt}`);
  lines.push('');
  lines.push(run.method);
  lines.push('');
  lines.push('| Verdict | Meaning |');
  lines.push('| --- | --- |');
  lines.push('| confirmed | the fact is on the live page and in the stored research |');
  lines.push('| stored-only | the stored copy has it but the live page no longer does: the page changed since retrieval |');
  lines.push('| live-only | the page has it but extraction dropped it: an extraction gap |');
  lines.push('| missing | neither: the fact pattern needs revisiting |');
  lines.push('');
  lines.push('## Pages fetched');
  lines.push('');
  lines.push('| Source | URL | HTTP | Stored copy retrieved |');
  lines.push('| --- | --- | --- | --- |');
  for (const page of run.pages) {
    lines.push(`| ${page.sourceId} | ${page.url} | ${page.error ?? page.httpStatus} | ${page.storedRetrievedAt ?? '—'} |`);
  }
  lines.push('');
  lines.push(
    `## Result: ${run.summary.confirmed}/${run.summary.facts} confirmed ` +
      `(${run.summary.storedOnly} stored-only, ${run.summary.liveOnly} live-only, ${run.summary.missing} missing)`,
  );
  lines.push('');
  lines.push('| Verdict | Source | Fact quoted by an answer |');
  lines.push('| --- | --- | --- |');
  for (const fact of run.facts) {
    lines.push(`| ${fact.verdict} | ${fact.sourceId} | ${fact.fact} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

interface GroundTruthRun {
  startedAt: string;
  method: string;
  pages: { sourceId: string; url: string; httpStatus: number; error: string | null; storedRetrievedAt: string | null }[];
  facts: FactResult[];
  summary: { facts: number; confirmed: number; storedOnly: number; liveOnly: number; missing: number };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Ground-truth check failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
