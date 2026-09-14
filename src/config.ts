import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceConfig } from './types.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Load .env without a dependency. Existing environment variables always win. */
function loadDotEnv(): void {
  const file = resolve(projectRoot, '.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  return parsed;
}

export const config = {
  dataDir: resolve(projectRoot, process.env.DATA_DIR ?? 'data'),
  sourcesFile: resolve(projectRoot, process.env.SOURCES_FILE ?? 'config/sources.json'),
  port: num('PORT', 3000),

  http: {
    timeoutMs: num('HTTP_TIMEOUT_MS', 20_000),
    maxBytes: num('HTTP_MAX_BYTES', 5_000_000),
    /** Minimum gap between requests to the same host. */
    minHostIntervalMs: num('HTTP_MIN_HOST_INTERVAL_MS', 1_000),
    maxRetries: num('HTTP_MAX_RETRIES', 2),
    userAgent:
      process.env.USER_AGENT ??
      'XeroResearchAssistant/1.0 (candidate exercise; contact via repository)',
  },

  llm: {
    /** OpenAI-compatible endpoint. DeepSeek by default; any compatible server works. */
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'deepseek-flash',
    timeoutMs: num('LLM_TIMEOUT_MS', 60_000),
    maxRetries: num('LLM_MAX_RETRIES', 1),
    temperature: num('LLM_TEMPERATURE', 0),
    // Reasoning models count hidden thinking tokens against this budget, so the
    // default is generous enough that a normal answer is never truncated.
    maxTokens: num('LLM_MAX_TOKENS', 8000),
  },

  retrieval: {
    topK: num('RETRIEVAL_TOP_K', 6),
    /** Cap per source so a single long page cannot crowd out a second source. */
    maxPerSource: num('RETRIEVAL_MAX_PER_SOURCE', 3),
    /** Below this share of matched query terms the evidence is flagged as weak. */
    weakCoverage: num('RETRIEVAL_WEAK_COVERAGE', 0.34),
  },

  chunking: {
    targetChars: num('CHUNK_TARGET_CHARS', 1_200),
    maxChars: num('CHUNK_MAX_CHARS', 1_800),
  },
} as const;

export function llmConfigured(): boolean {
  return config.llm.apiKey.trim().length > 0;
}

/** Redact secrets before anything reaches a log or an HTTP response. */
export function redact(text: string): string {
  const key = config.llm.apiKey;
  let out = text;
  if (key.length > 6) out = out.split(key).join('[redacted-api-key]');
  return out.replace(/\b(sk-[A-Za-z0-9]{8,})\b/g, '[redacted-api-key]');
}

export function loadSources(file: string = config.sourcesFile): SourceConfig[] {
  if (!existsSync(file)) throw new Error(`Source configuration not found at ${file}`);
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { sources?: unknown })?.sources;
  if (!Array.isArray(list)) throw new Error(`${file} must contain an array or a { "sources": [...] } object`);

  const seen = new Set<string>();
  return list.map((entry, i) => {
    const s = entry as Partial<SourceConfig>;
    if (!s || typeof s.id !== 'string' || !s.id.trim()) throw new Error(`Source #${i + 1} is missing "id"`);
    if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) {
      throw new Error(`Source "${s.id}" needs an http(s) "url"`);
    }
    if (seen.has(s.id)) throw new Error(`Duplicate source id "${s.id}"`);
    seen.add(s.id);
    return {
      id: s.id,
      url: s.url,
      label: s.label,
      region: s.region,
      currency: s.currency,
      topic: s.topic,
    };
  });
}
