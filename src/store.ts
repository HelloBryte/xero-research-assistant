import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import type { Chunk, SourceRecord, StoreData, StoredFailure } from './types.js';

const STORE_VERSION = 1;

function emptyStore(): StoreData {
  const now = new Date().toISOString();
  return { version: STORE_VERSION, createdAt: now, updatedAt: now, sources: {}, chunks: {}, failures: {} };
}

/**
 * File-backed research store. Everything the application knows about a source —
 * its metadata, retrieval times and extracted passages — lives in one JSON
 * document that survives restarts.
 *
 * Writes go to a temporary file and are then renamed over the real one, so an
 * interrupted or failed write cannot leave a half-written store behind.
 */
export class ResearchStore {
  private data: StoreData;

  private constructor(
    private readonly file: string,
    data: StoreData,
  ) {
    this.data = data;
  }

  static open(dataDir: string = config.dataDir): ResearchStore {
    mkdirSync(dataDir, { recursive: true });
    const file = join(dataDir, 'store.json');
    if (!existsSync(file)) return new ResearchStore(file, emptyStore());

    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoreData;
      if (parsed.version !== STORE_VERSION) {
        throw new Error(`store.json has version ${parsed.version}, expected ${STORE_VERSION}`);
      }
      parsed.sources ??= {};
      parsed.chunks ??= {};
      parsed.failures ??= {};
      return new ResearchStore(file, parsed);
    } catch (error) {
      throw new Error(
        `Could not read the research store at ${file}: ${(error as Error).message}. ` +
          'Delete the data directory and run `npm run gather` to rebuild it.',
      );
    }
  }

  get path(): string {
    return this.file;
  }

  private persist(): void {
    this.data.updatedAt = new Date().toISOString();
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(temp, this.file);
  }

  /** Discard any temporary files left behind by a crashed write. */
  static cleanTemp(dataDir: string = config.dataDir): void {
    const file = join(dataDir, 'store.json');
    for (const suffix of ['.tmp']) {
      const candidate = `${file}${suffix}`;
      if (existsSync(candidate)) rmSync(candidate);
    }
  }

  listSources(): SourceRecord[] {
    return Object.values(this.data.sources).sort((a, b) => a.id.localeCompare(b.id));
  }

  getSource(id: string): SourceRecord | undefined {
    return this.data.sources[id];
  }

  listChunks(): Chunk[] {
    return Object.values(this.data.chunks);
  }

  getChunk(id: string): Chunk | undefined {
    return this.data.chunks[id];
  }

  chunksForSource(sourceId: string): Chunk[] {
    return this.listChunks()
      .filter((chunk) => chunk.sourceId === sourceId)
      .sort((a, b) => a.index - b.index);
  }

  listFailures(): (StoredFailure & { url: string; sourceId: string })[] {
    return Object.entries(this.data.failures).map(([sourceId, failure]) => ({ ...failure, sourceId }));
  }

  /** Replace a source record and all of its passages in a single write. */
  saveSource(record: SourceRecord, chunks: Chunk[]): void {
    this.dropChunks(record.id);
    for (const chunk of chunks) this.data.chunks[chunk.id] = chunk;
    this.data.sources[record.id] = { ...record, chunkCount: chunks.length };
    delete this.data.failures[record.id];
    this.persist();
  }

  /**
   * Record a failed attempt. Evidence already stored for the source is left
   * untouched so a failed refresh degrades to "older evidence, clearly marked"
   * rather than losing the research.
   */
  recordFailure(sourceId: string, url: string, failure: StoredFailure): void {
    const existing = this.data.sources[sourceId];
    if (existing) {
      this.data.sources[sourceId] = { ...existing, lastError: failure, lastAttemptAt: failure.at };
    } else {
      this.data.failures[sourceId] = { ...failure, url };
    }
    this.persist();
  }

  /** Mark a successful attempt that produced identical bytes: nothing to reprocess. */
  markUnchanged(sourceId: string, at: string): void {
    const existing = this.data.sources[sourceId];
    if (!existing) return;
    this.data.sources[sourceId] = { ...existing, fetchedAt: at, lastAttemptAt: at, lastError: null };
    this.persist();
  }

  removeSource(sourceId: string): void {
    this.dropChunks(sourceId);
    delete this.data.sources[sourceId];
    delete this.data.failures[sourceId];
    this.persist();
  }

  private dropChunks(sourceId: string): void {
    for (const id of Object.keys(this.data.chunks)) {
      if (this.data.chunks[id]?.sourceId === sourceId) delete this.data.chunks[id];
    }
  }

  /** A fingerprint of the corpus, used to decide when the retrieval index is stale. */
  corpusVersion(): string {
    // The store path is part of the fingerprint so two stores that happen to
    // hold the same sources can never share a cached index.
    return `${this.file}::` + this.listSources()
      .map((source) => `${source.id}:${source.contentHash}:${source.chunkCount}`)
      .join('|');
  }

  snapshot(): StoreData {
    return this.data;
  }
}
