import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageResponse } from '../src/http.js';
import { ModelFailure, type ChatMessage, type ChatModel, type ModelResponse } from '../src/llm.js';
import { ResearchService } from '../src/service.js';
import type { SourceConfig } from '../src/types.js';

// The suite never touches the network or a real model, so it runs on a fresh
// clone with no credentials.
process.env.ACTIVITY_QUIET = '1';

export interface Harness {
  service: ResearchService;
  dataDir: string;
  /** Number of page fetches performed, used to prove reuse. */
  fetchCount(): number;
  /** Number of model calls performed. */
  modelCount(): number;
  /** Replace the body a URL returns on the next fetch. */
  setBody(url: string, body: string): void;
  /** Make the next fetch of a URL fail. */
  setFailure(url: string, error: Error): void;
  lastPrompt(): ChatMessage[] | null;
  cleanup(): void;
}

export interface HarnessOptions {
  sources: SourceConfig[];
  pages: Record<string, string>;
  model?: ChatModel;
}

export function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

/** A model that always returns the same JSON payload, recording what it was asked. */
export function fakeModel(
  payload: unknown | ((messages: ChatMessage[]) => unknown),
  options: { raw?: string; fail?: ModelFailure } = {},
): ChatModel & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const model = (async (messages: ChatMessage[]): Promise<ModelResponse> => {
    calls.push(messages);
    if (options.fail) throw options.fail;
    const body =
      options.raw ?? JSON.stringify(typeof payload === 'function' ? (payload as (m: ChatMessage[]) => unknown)(messages) : payload);
    return {
      text: body,
      model: 'test-model',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, reasoningTokens: 0, cachedPromptTokens: 0 },
      latencyMs: 1,
      attempts: 1,
    };
  }) as ChatModel & { calls: ChatMessage[][] };
  model.calls = calls;
  return model;
}

export function createHarness(options: HarnessOptions): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'xero-research-test-'));
  const sourcesFile = join(dataDir, 'sources.json');
  writeFileSync(sourcesFile, JSON.stringify({ sources: options.sources }), 'utf8');

  const bodies = new Map(Object.entries(options.pages));
  const failures = new Map<string, Error>();
  let fetches = 0;
  let modelCalls = 0;

  const fetcher = async (url: string): Promise<PageResponse> => {
    fetches += 1;
    const failure = failures.get(url);
    if (failure) throw failure;
    const body = bodies.get(url);
    if (body === undefined) throw new Error(`Test fixture missing for ${url}`);
    return {
      url,
      finalUrl: url,
      status: 200,
      body,
      contentType: 'text/html',
      bytes: Buffer.byteLength(body),
      fetchedAt: new Date().toISOString(),
    };
  };

  let lastPrompt: ChatMessage[] | null = null;
  const baseModel = options.model ?? fakeModel({ status: 'insufficient', answer: 'no model configured for this test', claims: [] });
  const model: ChatModel = async (messages, opts) => {
    modelCalls += 1;
    lastPrompt = messages;
    return baseModel(messages, opts);
  };

  const service = new ResearchService({ dataDir, sourcesFile, fetcher, model });

  return {
    service,
    dataDir,
    fetchCount: () => fetches,
    modelCount: () => modelCalls,
    setBody: (url, body) => bodies.set(url, body),
    setFailure: (url, error) => failures.set(url, error),
    lastPrompt: () => lastPrompt,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}
