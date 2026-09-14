import { config } from './config.js';
import { configureConnectionTimeouts } from './net.js';
import { isAllowed, parseRobots, type RobotsPolicy } from './robots.js';
import type { FailureKind } from './types.js';

configureConnectionTimeouts();

export class FetchFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'FetchFailure';
  }
}

export interface PageResponse {
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  contentType: string;
  bytes: number;
  fetchedAt: string;
}

/** A page fetcher. Swapped for a fixture-backed implementation in tests and offline evaluation. */
export type PageFetcher = (url: string) => Promise<PageResponse>;

const lastRequestByHost = new Map<string, number>();
const robotsCache = new Map<string, RobotsPolicy>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle(host: string, extraDelayMs = 0): Promise<void> {
  const minGap = Math.max(config.http.minHostIntervalMs, extraDelayMs);
  const last = lastRequestByHost.get(host);
  const now = Date.now();
  if (last !== undefined && now - last < minGap) await sleep(minGap - (now - last));
  lastRequestByHost.set(host, Date.now());
}

async function rawFetch(url: string, accept: string): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': config.http.userAgent,
        Accept: accept,
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(config.http.timeoutMs),
    });
  } catch (error) {
    const err = error as Error;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new FetchFailure('timeout', `Request timed out after ${config.http.timeoutMs}ms: ${url}`);
    }
    const code = (err as { cause?: { code?: string } }).cause?.code;
    throw new FetchFailure('network', `Network error for ${url}: ${err.message}${code ? ` (${code})` : ''}`);
  }
}

async function getRobots(origin: string): Promise<RobotsPolicy> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  let policy: RobotsPolicy = { rules: [], crawlDelayMs: null };
  try {
    const response = await rawFetch(`${origin}/robots.txt`, 'text/plain');
    if (response.ok) policy = parseRobots(await response.text(), config.http.userAgent);
  } catch {
    // An unreachable robots.txt is not a licence to ignore the site, but the
    // standard treats it as unrestricted. We keep the per-host rate limit either way.
  }
  robotsCache.set(origin, policy);
  return policy;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

/**
 * Fetch one public HTML page, honouring robots.txt, a per-host rate limit, a
 * request timeout, a response size cap, and bounded retries for transient errors.
 */
export const fetchPage: PageFetcher = async (url: string): Promise<PageResponse> => {
  const parsed = new URL(url);
  const policy = await getRobots(parsed.origin);
  if (!isAllowed(policy, parsed.pathname + parsed.search)) {
    throw new FetchFailure('robots_disallowed', `robots.txt disallows ${config.http.userAgent} from fetching ${url}`);
  }

  let lastError: FetchFailure | null = null;
  for (let attempt = 0; attempt <= config.http.maxRetries; attempt++) {
    await throttle(parsed.host, policy.crawlDelayMs ?? 0);
    try {
      const response = await rawFetch(url, 'text/html,application/xhtml+xml');

      if (response.status === 429) {
        const wait = retryAfterMs(response) ?? 2_000 * (attempt + 1);
        lastError = new FetchFailure('rate_limited', `Rate limited (429) by ${parsed.host}`, 429);
        if (attempt < config.http.maxRetries) {
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      if (response.status >= 500) {
        lastError = new FetchFailure('http_error', `Server returned ${response.status} for ${url}`, response.status);
        if (attempt < config.http.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        throw new FetchFailure('http_error', `Server returned ${response.status} for ${url}`, response.status);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
        throw new FetchFailure('unsupported_content_type', `Expected HTML from ${url} but received "${contentType}"`);
      }

      const declaredLength = Number(response.headers.get('content-length') ?? NaN);
      if (Number.isFinite(declaredLength) && declaredLength > config.http.maxBytes) {
        throw new FetchFailure('too_large', `${url} declares ${declaredLength} bytes, over the ${config.http.maxBytes} byte cap`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > config.http.maxBytes) {
        throw new FetchFailure('too_large', `${url} returned ${buffer.byteLength} bytes, over the ${config.http.maxBytes} byte cap`);
      }

      return {
        url,
        finalUrl: response.url || url,
        status: response.status,
        body: buffer.toString('utf8'),
        contentType,
        bytes: buffer.byteLength,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof FetchFailure) {
        // Only transient classes are retried; the loop above already continued for those.
        if (error.kind === 'timeout' && attempt < config.http.maxRetries) {
          lastError = error;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      throw new FetchFailure('network', (error as Error).message);
    }
  }
  throw lastError ?? new FetchFailure('network', `Failed to fetch ${url}`);
};

/** Test hook: drop cached robots policies and rate-limit timers. */
export function resetHttpCaches(): void {
  robotsCache.clear();
  lastRequestByHost.clear();
}
