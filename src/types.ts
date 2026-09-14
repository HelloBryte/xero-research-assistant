/** Shared data shapes for the research store, retrieval and answering pipeline. */

/** A source the application is configured to research. Edit `config/sources.json` to add/replace. */
export interface SourceConfig {
  /** Stable identifier used as the storage key; changing it is treated as a new source. */
  id: string;
  url: string;
  /** Short human label shown in the UI when the page title is unhelpful. */
  label?: string;
  /** Region the page applies to (e.g. "AU"). Passed to the model so it can qualify answers. */
  region?: string;
  /** Currency used by the page (e.g. "AUD"). */
  currency?: string;
  /** What this page is expected to cover; used only for reviewer-facing display. */
  topic?: string;
}

/** One retrievable passage of a source. */
export interface Chunk {
  /** `${sourceId}#${index}` — quoted in answers so a reviewer can trace a claim. */
  id: string;
  sourceId: string;
  index: number;
  /** Nearest heading above the passage, when the page had one. */
  heading: string | null;
  text: string;
}

export type FailureKind =
  | 'robots_disallowed'
  | 'http_error'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'unsupported_content_type'
  | 'too_large'
  | 'empty_extraction';

export interface StoredFailure {
  at: string;
  kind: FailureKind;
  message: string;
  httpStatus?: number;
}

/** A source that has been fetched and processed at least once. */
export interface SourceRecord {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  region?: string;
  currency?: string;
  topic?: string;
  /** Last time the bytes were successfully retrieved from the network. */
  fetchedAt: string;
  /** Last time the retrieved bytes differed from the previous fetch. */
  contentChangedAt: string;
  /** Last time chunks were rebuilt from the retrieved bytes. */
  processedAt: string;
  /** sha256 of the raw response body — drives "unchanged, skip reprocessing". */
  contentHash: string;
  httpStatus: number;
  bytes: number;
  charCount: number;
  chunkCount: number;
  /** Set when the most recent refresh attempt failed; the record above is the older, still-usable evidence. */
  lastError?: StoredFailure | null;
  /** Timestamp of the most recent refresh attempt, successful or not. */
  lastAttemptAt: string;
}

export interface StoreData {
  version: 1;
  createdAt: string;
  updatedAt: string;
  sources: Record<string, SourceRecord>;
  chunks: Record<string, Chunk>;
  /** Sources that have never been successfully processed, keyed by source id. */
  failures: Record<string, StoredFailure & { url: string }>;
}

export type SourceOutcome =
  | 'fetched'          // fetched and processed for the first time
  | 'reused'           // already in the store, not touched
  | 'unchanged'        // re-fetched, bytes identical, reprocessing skipped
  | 'reprocessed'      // re-fetched, bytes differed, chunks rebuilt
  | 'failed'           // fetch or processing failed
  | 'removed';         // dropped from config, evidence pruned

export interface SourceOutcomeReport {
  sourceId: string;
  url: string;
  outcome: SourceOutcome;
  /** Present for 'failed'. */
  error?: StoredFailure;
  /** Evidence that remains usable after a failure, if any. */
  servingEvidenceFrom?: string;
  chunkCount?: number;
  durationMs?: number;
}

export interface ResearchReport {
  runId: string;
  mode: 'gather' | 'refresh';
  startedAt: string;
  finishedAt: string;
  sources: SourceOutcomeReport[];
  /** True when every configured source ended in a usable state. */
  ok: boolean;
}
