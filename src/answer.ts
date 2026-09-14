import type { ActivityEvent, RunLog } from './activity.js';
import { chat, ModelFailure, type ChatModel, type ModelUsage } from './llm.js';
import { buildEvidence, buildUserPrompt, SYSTEM_PROMPT, type EvidenceItem } from './prompt.js';
import { getIndex, type RetrievalResult } from './retrieve.js';
import type { ResearchStore } from './store.js';
import type { Chunk, SourceRecord } from './types.js';
import {
  checkClaim,
  summariseGrounding,
  type CitedPassage,
  type ClaimCheck,
  type GroundingSummary,
} from './verify.js';

export type AnswerStatus = 'answered' | 'partial' | 'insufficient';

const REFUSAL_TEXT = {
  no_research:
    'No research has been gathered yet. Run the gather step before asking questions.',
  no_query_terms:
    'The question could not be searched: after removing punctuation and common words it left no ' +
    'searchable term. Retrieval is word-based and indexes English page text, so a question written ' +
    'in another script, or made only of emoji or common words, cannot be matched against the stored ' +
    'research. This says nothing about what the research contains. Please rephrase in English using ' +
    'specific words such as a plan name, a feature or a figure.',
  no_match:
    'The stored research contains no passage related to this question, so it cannot be answered from ' +
    'the current evidence. Add a source covering this topic to config/sources.json and gather again.',
} as const;

export interface Citation {
  label: string;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  url: string;
  retrievedAt: string;
  heading: string | null;
  /** Enough text to see the support without opening the full passage. */
  snippet: string;
  region?: string;
  currency?: string;
  /** Set when the source's most recent refresh attempt failed. */
  staleWarning?: string;
}

export interface AnsweredClaim {
  text: string;
  citations: Citation[];
  check: ClaimCheck;
}

export interface AnswerResult {
  runId: string;
  question: string;
  askedAt: string;
  status: AnswerStatus;
  answer: string;
  claims: AnsweredClaim[];
  unknowns: string[];
  notes: string;
  citations: Citation[];
  grounding: GroundingSummary;
  retrieval: {
    terms: string[];
    matchedTerms: string[];
    coverage: number;
    quality: RetrievalResult['quality'];
    consideredChunks: number;
    selected: { label: string; chunkId: string; sourceId: string; score: number; heading: string | null }[];
  };
  model: {
    called: boolean;
    name: string | null;
    usage: ModelUsage | null;
    latencyMs: number | null;
  } | null;
  /** Problems the application detected and is reporting rather than hiding. */
  warnings: string[];
  events: ActivityEvent[];
}

export interface AskOptions {
  store: ResearchStore;
  run: RunLog;
  question: string;
  /** Injected in tests and offline evaluation; defaults to the configured endpoint. */
  model?: ChatModel;
  topK?: number;
}

interface ModelPayload {
  status?: unknown;
  answer?: unknown;
  claims?: unknown;
  unknowns?: unknown;
  notes?: unknown;
}

/**
 * Answer a question from stored research.
 *
 * This path never fetches. It retrieves a subset of the stored passages, sends
 * only those to the model, and then verifies the model's own citations against
 * the passages before returning anything.
 */
export async function ask(options: AskOptions): Promise<AnswerResult> {
  const { store, run } = options;
  const question = options.question.trim();
  const askedAt = new Date().toISOString();
  if (!question) throw new Error('A question is required');

  const sources = new Map(store.listSources().map((source) => [source.id, source]));
  const index = getIndex(store);
  const retrieval = index.search(question, { topK: options.topK });
  const evidence = buildEvidence(retrieval.results, sources);

  run.event(
    'retrieval',
    `selected ${evidence.length} of ${retrieval.consideredChunks} stored passage(s) from ` +
      `${retrieval.sourceIds.length} source(s); no network access`,
    {
      question,
      terms: retrieval.terms,
      matchedTerms: retrieval.matchedTerms,
      coverage: Number(retrieval.coverage.toFixed(2)),
      quality: retrieval.quality,
      selected: evidence.map((item) => ({ label: item.label, chunkId: item.chunkId, score: Number(item.score.toFixed(3)) })),
    },
  );

  const warnings: string[] = [];
  for (const item of evidence) {
    if (item.source.lastError) {
      const warning =
        `${item.source.title}: the most recent refresh attempt failed ` +
        `(${item.source.lastError.kind} at ${item.source.lastError.at}); ` +
        `evidence shown was retrieved ${item.source.fetchedAt}`;
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }

  // Nothing to send: answer from application logic, and spend no model call
  // establishing that there is nothing to answer from. The three reasons are
  // reported separately, because telling a user the research does not cover
  // their topic when the real cause was an unsearchable question is a false
  // statement about the evidence.
  if (evidence.length === 0) {
    const reason: 'no_research' | 'no_query_terms' | 'no_match' =
      store.listSources().length === 0
        ? 'no_research'
        : retrieval.terms.length === 0
          ? 'no_query_terms'
          : 'no_match';
    run.event('answer_refused', `${reason}: no evidence was sent to the model`, {
      question,
      reason,
      consideredChunks: retrieval.consideredChunks,
    });
    return {
      runId: run.runId,
      question,
      askedAt,
      status: 'insufficient',
      answer: REFUSAL_TEXT[reason],
      claims: [],
      unknowns: [question],
      notes: '',
      citations: [],
      grounding: summariseGrounding([]),
      retrieval: describeRetrieval(retrieval, evidence),
      model: { called: false, name: null, usage: null, latencyMs: null },
      warnings,
      events: run.events,
    };
  }

  const model = options.model ?? chat;
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(question, evidence) },
  ];

  let response;
  try {
    response = await model(messages, { json: true });
  } catch (error) {
    const failure =
      error instanceof ModelFailure ? error : new ModelFailure('network', (error as Error).message);
    run.event('model_failed', `model call failed (${failure.kind}): ${failure.message}`, {
      kind: failure.kind,
      httpStatus: failure.httpStatus,
      question,
    });
    // No fallback answer: a failed model call must not be dressed up as a result.
    throw failure;
  }

  run.event('model_call', `model ${response.model} answered in ${response.latencyMs}ms`, {
    model: response.model,
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens: response.usage.totalTokens,
    reasoningTokens: response.usage.reasoningTokens,
    cachedPromptTokens: response.usage.cachedPromptTokens,
    latencyMs: response.latencyMs,
    attempts: response.attempts,
    evidenceCount: evidence.length,
  });

  const payload = parseModelJson(response.text);
  const byLabel = new Map(evidence.map((item) => [item.label.toUpperCase(), item]));
  const chunkById = new Map(evidence.map((item) => [item.chunkId, store.getChunk(item.chunkId)]));

  const rawClaims = Array.isArray(payload.claims) ? payload.claims : [];
  const claims: AnsweredClaim[] = [];
  for (const raw of rawClaims) {
    const entry = raw as { text?: unknown; evidence?: unknown };
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;

    const labels = Array.isArray(entry.evidence) ? entry.evidence : [];
    const citations: Citation[] = [];
    for (const rawLabel of labels) {
      const label = normaliseLabel(rawLabel);
      const item = label ? byLabel.get(label) : undefined;
      if (!item) {
        const warning = `The model cited "${String(rawLabel)}", which was not among the evidence supplied; the citation was dropped.`;
        if (!warnings.includes(warning)) warnings.push(warning);
        continue;
      }
      citations.push(toCitation(item, item.source));
    }

    const citedPassages: CitedPassage[] = [];
    for (const citation of citations) {
      const chunk = chunkById.get(citation.chunkId);
      if (!chunk) continue;
      citedPassages.push({
        text: chunk.text,
        heading: chunk.heading,
        // The metadata the model was shown alongside the passage is part of
        // what it may legitimately restate, so it counts as evidence here too.
        context: `${citation.sourceTitle} ${citation.url} retrieved ${citation.retrievedAt} ${citation.region ?? ''} ${citation.currency ?? ''}`,
      });
    }
    claims.push({
      text,
      citations,
      check: checkClaim(text, citedPassages, { corpusVocabulary: index.vocabulary() }),
    });
  }

  const grounding = summariseGrounding(claims.map((claim) => claim.check.verdict));
  for (const claim of claims) {
    if (claim.check.verdict === 'unsupported' || claim.check.verdict === 'uncited') {
      warnings.push(`Unverified claim: "${truncate(claim.text, 120)}" — ${claim.check.reason}`);
    }
  }

  const status = resolveStatus(payload.status, grounding);
  const citations = dedupeCitations(claims.flatMap((claim) => claim.citations));

  run.event(
    'answer',
    `answer status=${status}; ${grounding.supported}/${grounding.claims} claim(s) verified against cited evidence`,
    {
      status,
      claims: grounding.claims,
      supported: grounding.supported,
      weak: grounding.weak,
      unsupported: grounding.unsupported,
      uncited: grounding.uncited,
      citedSources: [...new Set(citations.map((citation) => citation.sourceId))],
      warnings: warnings.length,
    },
  );

  return {
    runId: run.runId,
    question,
    askedAt,
    status,
    answer: typeof payload.answer === 'string' ? payload.answer.trim() : '',
    claims,
    unknowns: Array.isArray(payload.unknowns)
      ? payload.unknowns.filter((item): item is string => typeof item === 'string')
      : [],
    notes: typeof payload.notes === 'string' ? payload.notes : '',
    citations,
    grounding,
    retrieval: describeRetrieval(retrieval, evidence),
    model: {
      called: true,
      name: response.model,
      usage: response.usage,
      latencyMs: response.latencyMs,
    },
    warnings,
    events: run.events,
  };
}

function describeRetrieval(retrieval: RetrievalResult, evidence: EvidenceItem[]): AnswerResult['retrieval'] {
  return {
    terms: retrieval.terms,
    matchedTerms: retrieval.matchedTerms,
    coverage: Number(retrieval.coverage.toFixed(3)),
    quality: retrieval.quality,
    consideredChunks: retrieval.consideredChunks,
    selected: evidence.map((item) => ({
      label: item.label,
      chunkId: item.chunkId,
      sourceId: item.source.id,
      score: Number(item.score.toFixed(3)),
      heading: item.heading,
    })),
  };
}

function toCitation(item: EvidenceItem, source: SourceRecord): Citation {
  return {
    label: item.label,
    chunkId: item.chunkId,
    sourceId: source.id,
    sourceTitle: source.title,
    url: source.finalUrl || source.url,
    retrievedAt: source.fetchedAt,
    heading: item.heading,
    snippet: truncate(item.text, 400),
    ...(source.region ? { region: source.region } : {}),
    ...(source.currency ? { currency: source.currency } : {}),
    ...(source.lastError
      ? { staleWarning: `Last refresh attempt failed (${source.lastError.kind}) at ${source.lastError.at}` }
      : {}),
  };
}

/**
 * The model is asked for JSON, but a malformed reply is a real failure mode and
 * must surface as one rather than becoming an unsupported answer.
 */
export function parseModelJson(text: string): ModelPayload {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as ModelPayload;
  } catch (error) {
    throw new ModelFailure(
      'invalid_response',
      `Model reply was not valid JSON (${(error as Error).message}). First 200 characters: ${truncate(trimmed, 200)}`,
    );
  }
}

function normaliseLabel(raw: unknown): string | null {
  if (typeof raw === 'number') return `E${raw}`;
  if (typeof raw !== 'string') return null;
  const match = raw.match(/(\d+)/);
  return match ? `E${match[1]}` : null;
}

/**
 * The model reports its own status, but the verification result can only lower
 * it: an answer whose claims failed their evidence check is not "answered".
 */
function resolveStatus(raw: unknown, grounding: GroundingSummary): AnswerStatus {
  const declared: AnswerStatus =
    raw === 'answered' || raw === 'partial' || raw === 'insufficient' ? raw : 'partial';
  if (declared === 'insufficient') return 'insufficient';
  if (grounding.claims === 0) return declared === 'answered' ? 'partial' : declared;
  if (!grounding.clean) return 'partial';
  return declared;
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const byChunk = new Map<string, Citation>();
  for (const citation of citations) if (!byChunk.has(citation.chunkId)) byChunk.set(citation.chunkId, citation);
  return [...byChunk.values()];
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
