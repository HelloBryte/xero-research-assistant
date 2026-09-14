import { statSync, existsSync } from 'node:fs';
import { ActivityLog } from './activity.js';
import { ask, type AnswerResult } from './answer.js';
import { config, llmConfigured, loadSources } from './config.js';
import type { ChatModel } from './llm.js';
import type { PageFetcher } from './http.js';
import { runResearch } from './research.js';
import { getIndex, resetIndexCache } from './retrieve.js';
import { ResearchStore } from './store.js';
import type { Chunk, ResearchReport, SourceConfig, SourceRecord } from './types.js';

export interface ServiceOptions {
  dataDir?: string;
  sourcesFile?: string;
  fetcher?: PageFetcher;
  model?: ChatModel;
}

export interface StatusReport {
  storePath: string;
  configuredSources: number;
  storedSources: number;
  storedPassages: number;
  modelConfigured: boolean;
  model: string;
  sources: (SourceRecord & { configured: boolean })[];
  /** Sources in config that have never been successfully processed. */
  pending: { sourceId: string; url: string; lastError?: string }[];
}

/**
 * Single entry point used by both the web server and the CLI, so the two
 * surfaces cannot drift apart in behaviour.
 */
export class ResearchService {
  private store: ResearchStore;
  private storeMtimeMs = 0;

  readonly activity: ActivityLog;

  constructor(private readonly options: ServiceOptions = {}) {
    const dataDir = options.dataDir ?? config.dataDir;
    ResearchStore.cleanTemp(dataDir);
    this.store = ResearchStore.open(dataDir);
    this.activity = new ActivityLog(dataDir);
    this.storeMtimeMs = this.currentMtime();
  }

  private currentMtime(): number {
    return existsSync(this.store.path) ? statSync(this.store.path).mtimeMs : 0;
  }

  /** Pick up writes made by another process (for example the CLI while the server runs). */
  private syncStore(): ResearchStore {
    const mtime = this.currentMtime();
    if (mtime !== this.storeMtimeMs) {
      this.store = ResearchStore.open(this.options.dataDir ?? config.dataDir);
      this.storeMtimeMs = mtime;
      resetIndexCache();
    }
    return this.store;
  }

  get sources(): SourceConfig[] {
    return loadSources(this.options.sourcesFile ?? config.sourcesFile);
  }

  async gather(options: { only?: string[] } = {}): Promise<ResearchReport> {
    return this.research('gather', options.only);
  }

  async refresh(options: { only?: string[]; force?: boolean } = {}): Promise<ResearchReport> {
    return this.research('refresh', options.only, options.force);
  }

  private async research(mode: 'gather' | 'refresh', only?: string[], force?: boolean): Promise<ResearchReport> {
    const store = this.syncStore();
    const run = this.activity.startRun(mode);
    try {
      return await runResearch({
        store,
        run,
        sources: this.sources,
        mode,
        only,
        force,
        fetcher: this.options.fetcher,
      });
    } finally {
      this.storeMtimeMs = this.currentMtime();
      resetIndexCache();
    }
  }

  async ask(question: string, options: { topK?: number } = {}): Promise<AnswerResult> {
    const store = this.syncStore();
    const run = this.activity.startRun('ask');
    return ask({ store, run, question, model: this.options.model, topK: options.topK });
  }

  status(): StatusReport {
    const store = this.syncStore();
    const configured = this.sources;
    const configuredIds = new Set(configured.map((source) => source.id));
    const stored = store.listSources();
    const storedIds = new Set(stored.map((source) => source.id));

    return {
      storePath: store.path,
      configuredSources: configured.length,
      storedSources: stored.length,
      storedPassages: store.listChunks().length,
      modelConfigured: llmConfigured(),
      model: config.llm.model,
      sources: stored.map((source) => ({ ...source, configured: configuredIds.has(source.id) })),
      pending: configured
        .filter((source) => !storedIds.has(source.id))
        .map((source) => {
          const failure = store.listFailures().find((item) => item.sourceId === source.id);
          return {
            sourceId: source.id,
            url: source.url,
            ...(failure ? { lastError: `${failure.kind}: ${failure.message}` } : {}),
          };
        }),
    };
  }

  /** Full passage text plus its source, so a claim can be traced to the stored evidence. */
  trace(chunkId: string): { chunk: Chunk; source: SourceRecord } | null {
    const store = this.syncStore();
    const chunk = store.getChunk(chunkId);
    if (!chunk) return null;
    const source = store.getSource(chunk.sourceId);
    if (!source) return null;
    return { chunk, source };
  }

  passagesForSource(sourceId: string): Chunk[] {
    return this.syncStore().chunksForSource(sourceId);
  }

  /** Retrieval without a model call: shows which evidence a question selects. */
  preview(question: string, topK?: number) {
    const store = this.syncStore();
    return getIndex(store).search(question, { topK });
  }
}
