import { config } from './config.js';
import type { ResearchStore } from './store.js';
import type { Chunk } from './types.js';

/**
 * Lexical retrieval over the stored passages using BM25.
 *
 * The corpus here is small, but the requirement is that a question retrieves a
 * relevant subset rather than shipping the whole knowledge base to the model.
 * BM25 gives that with no external service, no embedding cost and no extra
 * moving parts to keep in sync with the store — and rare tokens such as prices
 * and product names, which is what these questions turn on, get high weight
 * from IDF for free.
 */

const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'get', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'just', 'may', 'me', 'much', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out',
  'over', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'up', 'use', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

const K1 = 1.5;
const B = 0.75;

/** Lowercase, strip punctuation, drop stopwords and normalise simple plurals. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9$%.]+/)) {
    // Keep the digits of "$14.30" and "90%", drop bare punctuation.
    const token = raw.replace(/^[$%.]+|[$%.]+$/g, '');
    if (!token || token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    tokens.push(stem(token));
  }
  return tokens;
}

/**
 * Just enough plural folding that "invoices" and "invoice" match. A full
 * stemmer would also fold verb endings, which is not what these questions turn
 * on and would cost a dependency.
 */
function stem(token: string): string {
  if (/\d/.test(token)) return token;
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  // "taxes", "matches", "businesses": the "es" is the plural marker.
  if (token.length > 4 && /(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  // "invoices", "plans": drop the "s" but keep "business" and "status" intact.
  if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  matchedTerms: string[];
}

export interface RetrievalResult {
  query: string;
  /** Query terms after tokenization. */
  terms: string[];
  /** Query terms found in the selected passages. */
  matchedTerms: string[];
  /** Share of query terms covered by the selected passages. */
  coverage: number;
  quality: 'strong' | 'weak' | 'none';
  results: ScoredChunk[];
  /** How many passages existed to search, for the reuse/scale story. */
  consideredChunks: number;
  sourceIds: string[];
}

interface IndexedChunk {
  chunk: Chunk;
  termFrequency: Map<string, number>;
  length: number;
}

export class RetrievalIndex {
  private readonly documents: IndexedChunk[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(chunks: Chunk[]) {
    for (const chunk of chunks) {
      const tokens = tokenize(`${chunk.heading ?? ''} ${chunk.text}`);
      const termFrequency = new Map<string, number>();
      for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      for (const term of termFrequency.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      this.documents.push({ chunk, termFrequency, length: tokens.length });
    }
    const total = this.documents.reduce((sum, document) => sum + document.length, 0);
    this.averageLength = this.documents.length > 0 ? total / this.documents.length : 0;
  }

  get size(): number {
    return this.documents.length;
  }

  search(
    query: string,
    options: { topK?: number; maxPerSource?: number } = {},
  ): RetrievalResult {
    const topK = options.topK ?? config.retrieval.topK;
    const maxPerSource = options.maxPerSource ?? config.retrieval.maxPerSource;
    const terms = [...new Set(tokenize(query))];

    const scored: ScoredChunk[] = [];
    for (const document of this.documents) {
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const frequency = document.termFrequency.get(term);
        if (!frequency) continue;
        matched.push(term);
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (this.documents.length - df + 0.5) / (df + 0.5));
        const normalisation = 1 - B + (B * document.length) / (this.averageLength || 1);
        score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * normalisation));
      }
      if (score > 0) scored.push({ chunk: document.chunk, score, matchedTerms: matched });
    }

    scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));

    // Cap passages per source so one long page cannot crowd out a second
    // source; questions that span sources depend on this.
    const perSource = new Map<string, number>();
    const selected: ScoredChunk[] = [];
    const overflow: ScoredChunk[] = [];
    for (const candidate of scored) {
      const used = perSource.get(candidate.chunk.sourceId) ?? 0;
      if (selected.length < topK && used < maxPerSource) {
        selected.push(candidate);
        perSource.set(candidate.chunk.sourceId, used + 1);
      } else {
        overflow.push(candidate);
      }
    }
    // If the cap left room unused, fill it with the next best passages.
    for (const candidate of overflow) {
      if (selected.length >= topK) break;
      selected.push(candidate);
    }
    selected.sort((a, b) => b.score - a.score);

    const matchedTerms = [...new Set(selected.flatMap((item) => item.matchedTerms))];
    const coverage = terms.length === 0 ? 0 : matchedTerms.length / terms.length;

    return {
      query,
      terms,
      matchedTerms,
      coverage,
      quality:
        selected.length === 0 ? 'none' : coverage >= config.retrieval.weakCoverage ? 'strong' : 'weak',
      results: selected,
      consideredChunks: this.documents.length,
      sourceIds: [...new Set(selected.map((item) => item.chunk.sourceId))],
    };
  }
}

let cached: { version: string; index: RetrievalIndex } | null = null;

/**
 * Build the index once per corpus state. Asking further questions against
 * unchanged research reuses it and never touches the network.
 */
export function getIndex(store: ResearchStore): RetrievalIndex {
  const version = store.corpusVersion();
  if (cached && cached.version === version) return cached.index;
  const index = new RetrievalIndex(store.listChunks());
  cached = { version, index };
  return index;
}

export function resetIndexCache(): void {
  cached = null;
}
