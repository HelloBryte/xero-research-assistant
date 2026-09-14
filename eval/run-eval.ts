/**
 * Repeatable research evaluation.
 *
 * Every case goes through exactly the same retrieve-then-answer path as an
 * ordinary question (`ResearchService.ask`). Nothing here is special-cased for
 * evaluation, and no answer is hard-coded.
 *
 *   npm run eval              live model, live stored research
 *   npm run eval -- --offline scripted model over synthetic fixtures, no credentials
 *
 * Results are written to eval/results/ as JSON and Markdown.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AnswerResult } from '../src/answer.js';
import { config, llmConfigured, projectRoot } from '../src/config.js';
import { FetchFailure, type PageResponse } from '../src/http.js';
import { ModelFailure, type ChatMessage, type ChatModel } from '../src/llm.js';
import { ResearchService } from '../src/service.js';

interface CaseChecks {
  status?: string[];
  minCitations?: number;
  minDistinctCitedSources?: number;
  requireSourceIds?: string[];
  maxUnsupportedClaims?: number;
  requireNoFetch?: boolean;
  requireUnknowns?: boolean;
  requireRegionContext?: boolean;
  requireSameEvidenceAs?: string;
}

interface EvalCase {
  id: string;
  kind: string;
  question: string;
  expectedBehaviour: string;
  checks: CaseChecks;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const offline = process.argv.includes('--offline');
const resultsDir = resolve(projectRoot, 'eval/results');

/* ---------------------------------------------------------------- offline ---
 * A scripted model and fixture pages, so the whole evaluation can be re-run on
 * a fresh clone with no credentials. Everything it produces is labelled as a
 * mocked model output.
 */

const FIXTURES: Record<string, string> = {
  'https://fixture.invalid/pricing-au': 'pricing-au.html',
  'https://fixture.invalid/about': 'about.html',
  'https://fixture.invalid/encyclopedia': 'encyclopedia.html',
};

let fixtureFetches = 0;
const fixtureFetcher = async (url: string): Promise<PageResponse> => {
  const file = FIXTURES[url];
  if (!file) throw new Error(`No fixture for ${url}`);
  fixtureFetches += 1;
  const body = readFileSync(resolve(projectRoot, 'eval/fixtures', file), 'utf8');
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

/**
 * Scripted replies keyed by what the question is about. The script only ever
 * cites labels; the application still resolves, verifies and can reject them,
 * so the grounding checks are exercised for real.
 */
const scriptedModel: ChatModel = async (messages: ChatMessage[]) => {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  // Resolve a label by looking inside each passage the application actually
  // supplied, rather than assuming an order. A needle that matches nothing
  // yields null, which the application then reports as an uncited claim.
  const passages = [...user.matchAll(/<passage id=(E\d+)[^>]*>([\s\S]*?)<\/passage>/g)];
  const labelFor = (needle: string): string | null =>
    passages.find((passage) => passage[2]!.toLowerCase().includes(needle.toLowerCase()))?.[1] ?? null;

  // Only statements that a supplied passage actually backs are asserted. A
  // statement whose evidence was not retrieved is reported as unknown, which is
  // what the real system prompt asks a model to do.
  const compose = (wanted: { text: string; needle: string }[], notes: string) => {
    const found = wanted.map((item) => ({ ...item, label: labelFor(item.needle) }));
    const supported = found.filter((item) => item.label !== null);
    return {
      status: supported.length === found.length ? 'answered' : 'partial',
      answer: supported.map((item) => `${item.text} (${item.label})`).join(' '),
      claims: supported.map((item) => ({ text: item.text, evidence: [item.label] })),
      unknowns: found.filter((item) => item.label === null).map((item) => item.text),
      notes,
    };
  };

  let payload: unknown;
  if (/canadian|salary/i.test(user)) {
    payload = {
      status: 'insufficient',
      answer:
        'The stored research does not cover Canadian staffing. The passages describe plans, pricing and the ' +
        'company overall, and none of them gives a headcount for Canada or any salary information.',
      claims: [],
      unknowns: ['Number of staff employed in Canada', 'Average salary of staff in Canada'],
      notes: 'No region-specific employment data is present in the stored evidence.',
    };
  } else if (/founded/i.test(user)) {
    payload = compose(
      [
        { text: 'The company was founded on 6 July 2006 in Wellington, New Zealand.', needle: 'founded on 6 July 2006' },
        { text: 'It serves 5 million customers in 180+ countries.', needle: '5 million customers' },
      ],
      'The customer figure is a global figure as published on the company page, as at its retrieval date.',
    );
  } else {
    payload = compose(
      [
        { text: 'The Grow plan is listed at $7.80 per month, then $78 per month.', needle: '7.80' },
        { text: 'Prices are in AUD and include GST.', needle: 'AUD and include GST' },
      ],
      'Region: AU, currency: AUD, as published on the pricing page at its retrieval date.',
    );
  }

  return {
    text: JSON.stringify(payload),
    model: 'scripted-offline-mock',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedPromptTokens: 0 },
    latencyMs: 0,
    attempts: 1,
  };
};

/* ------------------------------------------------------------------ checks --- */

function runChecks(
  testCase: EvalCase,
  result: AnswerResult,
  context: {
    fetchesDuringCase: number;
    previous: Map<string, AnswerResult>;
    retrievedAt: (chunkId: string) => string;
  },
): CheckResult[] {
  const checks: CheckResult[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const want = testCase.checks;

  if (want.status) {
    add('status', want.status.includes(result.status), `status=${result.status}, allowed=${want.status.join('|')}`);
  }
  if (want.minCitations !== undefined) {
    add('citations', result.citations.length >= want.minCitations, `${result.citations.length} citation(s)`);
  }
  if (want.minDistinctCitedSources !== undefined) {
    const distinct = new Set(result.citations.map((citation) => citation.sourceId));
    add(
      'distinct cited sources',
      distinct.size >= want.minDistinctCitedSources,
      `${distinct.size} source(s): ${[...distinct].join(', ') || 'none'}`,
    );
  }
  if (want.requireSourceIds) {
    const cited = new Set(result.citations.map((citation) => citation.sourceId));
    const missing = want.requireSourceIds.filter((id) => !cited.has(id));
    add('required sources cited', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'all present');
  }
  if (want.maxUnsupportedClaims !== undefined) {
    const bad = result.grounding.unsupported + result.grounding.uncited;
    add(
      'claims verified against cited evidence',
      bad <= want.maxUnsupportedClaims,
      `${result.grounding.supported} supported, ${result.grounding.weak} weak, ${result.grounding.unsupported} unsupported, ${result.grounding.uncited} uncited`,
    );
  }
  if (want.requireNoFetch) {
    add('no source fetched while answering', context.fetchesDuringCase === 0, `${context.fetchesDuringCase} fetch(es)`);
  }
  if (want.requireUnknowns) {
    add('states what could not be established', result.unknowns.length > 0, `${result.unknowns.length} unknown(s) listed`);
  }
  if (want.requireRegionContext) {
    const haystack = `${result.answer} ${result.notes}`.toLowerCase();
    const hasRegion = /\b(au|australia|australian|aud)\b/.test(haystack);
    add('region or currency stated', hasRegion, hasRegion ? 'region/currency mentioned' : 'no region or currency mentioned');
  }
  if (want.requireSameEvidenceAs) {
    const earlier = context.previous.get(want.requireSameEvidenceAs);
    if (!earlier) {
      add('reuse of earlier research', false, `case "${want.requireSameEvidenceAs}" did not run`);
    } else {
      // Retrieval is deterministic; which passages the model chooses to cite is
      // not, so reuse is asserted on the retrieved set and the retrieval time
      // carried by each of those passages.
      const signature = (answer: AnswerResult) =>
        answer.retrieval.selected
          .map((item) => `${item.chunkId}@${context.retrievedAt(item.chunkId)}`)
          .sort()
          .join(',');
      const same = signature(earlier) === signature(result);
      add(
        'reuse of earlier research',
        same,
        same
          ? `the same passages, each still carrying the retrieval time it had in the "${want.requireSameEvidenceAs}" case`
          : `the retrieved passages or their retrieval times differ from the "${want.requireSameEvidenceAs}" case`,
      );
    }
  }
  return checks;
}

/* -------------------------------------------------------------------- run --- */

interface CaseRecord {
  id: string;
  kind: string;
  question: string;
  expectedBehaviour: string;
  status: string;
  answer: string;
  notes: string;
  unknowns: string[];
  evidence: {
    label: string;
    chunkId: string;
    sourceTitle: string;
    url: string;
    retrievedAt: string;
    heading: string | null;
    snippet: string;
  }[];
  claims: { text: string; cites: string[]; verdict: string; reason: string }[];
  retrieval: AnswerResult['retrieval'];
  model: AnswerResult['model'];
  warnings: string[];
  fetchesDuringCase: number;
  checks: CheckResult[];
  passed: boolean;
  error?: { kind: string; message: string };
}

interface FailureDemonstration {
  description: string;
  refreshReport: { sourceId: string; outcome: string; error: string | null; servingEvidenceFrom: string | null }[];
  evidenceSurvived: {
    passagesBefore: number;
    passagesAfter: number;
    retrievedAtBefore: string | null;
    retrievedAtAfter: string | null;
    retrievalTimeUnchanged: boolean;
    recordedError: unknown;
  };
  answerAfterFailure: { status: string; warnings: string[]; citationsMarkedStale: number };
}

interface EvalRun {
  mode: string;
  modelOutputs: string;
  startedAt: string;
  finishedAt: string;
  model: string;
  endpoint: string;
  configuration: { temperature: number; maxTokens: number; retrievalTopK: number; retrievalMaxPerSource: number };
  research: {
    gatherOutcomes: { sourceId: string; outcome: string }[];
    sources: {
      id: string;
      title: string;
      url: string;
      retrievedAt: string;
      contentChangedAt: string;
      passages: number;
      lastError: unknown;
    }[];
    storedPassages: number;
  };
  cases: CaseRecord[];
  failureDemonstration: FailureDemonstration | null;
  summary: { cases: number; passed: number; failed: number };
}

async function main(): Promise<number> {
  const { cases } = JSON.parse(readFileSync(resolve(projectRoot, 'eval/cases.json'), 'utf8')) as {
    cases: EvalCase[];
  };

  let service: ResearchService;
  let tempDir: string | null = null;
  let countFetches: () => number;

  if (offline) {
    tempDir = mkdtempSync(join(tmpdir(), 'xero-research-eval-'));
    service = new ResearchService({
      dataDir: tempDir,
      sourcesFile: resolve(projectRoot, 'eval/fixtures/sources.json'),
      fetcher: fixtureFetcher,
      model: scriptedModel,
    });
    countFetches = () => fixtureFetches;
  } else {
    if (!llmConfigured()) {
      console.error(
        'No model credentials configured. Set LLM_API_KEY in .env for a live run, or use `npm run eval -- --offline`.',
      );
      return 2;
    }
    service = new ResearchService();
    // A live run counts real fetches from the activity log rather than a hook,
    // so the "nothing was fetched" claim is evidence from the application itself.
    countFetches = () =>
      service.activity
        .tail(2000)
        .filter((event) => event.type === 'source_fetched' || event.type === 'source_reprocessed').length;
  }

  const startedAt = new Date().toISOString();

  // Both modes start by making sure research exists. On a live run this reuses
  // whatever is already stored; nothing is refetched just because an evaluation
  // is running.
  const gatherReport = await service.gather();
  const status = service.status();

  const previous = new Map<string, AnswerResult>();
  const records: CaseRecord[] = [];

  for (const testCase of cases) {
    const before = countFetches();
    try {
      const result = await service.ask(testCase.question);
      const fetchesDuringCase = countFetches() - before;
      previous.set(testCase.id, result);
      const checks = runChecks(testCase, result, {
        fetchesDuringCase,
        previous,
        retrievedAt: (chunkId) => service.trace(chunkId)?.source.fetchedAt ?? '?',
      });
      records.push({
        id: testCase.id,
        kind: testCase.kind,
        question: testCase.question,
        expectedBehaviour: testCase.expectedBehaviour,
        status: result.status,
        answer: result.answer,
        notes: result.notes,
        unknowns: result.unknowns,
        evidence: result.retrieval.selected.map((item) => {
          const traced = service.trace(item.chunkId);
          return {
            label: item.label,
            chunkId: item.chunkId,
            sourceTitle: traced?.source.title ?? item.sourceId,
            url: traced?.source.finalUrl ?? traced?.source.url ?? '',
            retrievedAt: traced?.source.fetchedAt ?? '',
            heading: item.heading,
            snippet: (traced?.chunk.text ?? '').slice(0, 300),
          };
        }),
        claims: result.claims.map((claim) => ({
          text: claim.text,
          cites: claim.citations.map((citation) => citation.chunkId),
          verdict: claim.check.verdict,
          reason: claim.check.reason,
        })),
        retrieval: result.retrieval,
        model: result.model,
        warnings: result.warnings,
        fetchesDuringCase,
        checks,
        passed: checks.every((check) => check.passed),
      });
    } catch (error) {
      const failure = error instanceof ModelFailure ? error : new ModelFailure('network', (error as Error).message);
      records.push({
        id: testCase.id,
        kind: testCase.kind,
        question: testCase.question,
        expectedBehaviour: testCase.expectedBehaviour,
        status: 'error',
        answer: '',
        notes: '',
        unknowns: [],
        evidence: [],
        claims: [],
        retrieval: { terms: [], matchedTerms: [], coverage: 0, quality: 'none', consideredChunks: 0, selected: [] },
        model: null,
        warnings: [],
        fetchesDuringCase: countFetches() - before,
        checks: [{ name: 'completed', passed: false, detail: `${failure.kind}: ${failure.message}` }],
        passed: false,
        error: { kind: failure.kind, message: failure.message },
      });
    }
  }

  // Offline only: demonstrate that a failed refresh degrades safely rather than
  // corrupting the store or presenting stale evidence as fresh.
  const failureDemo = offline && tempDir ? await demonstrateFailure(tempDir) : null;

  const run: EvalRun = {
    mode: offline ? 'offline-mock' : 'live-model',
    modelOutputs: offline
      ? 'MOCKED — replies come from eval/run-eval.ts scriptedModel, not from a language model'
      : 'REAL — replies come from the configured model endpoint',
    startedAt,
    finishedAt: new Date().toISOString(),
    model: offline ? 'scripted-offline-mock' : config.llm.model,
    endpoint: offline ? 'n/a (no network)' : config.llm.baseUrl,
    configuration: {
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      retrievalTopK: config.retrieval.topK,
      retrievalMaxPerSource: config.retrieval.maxPerSource,
    },
    research: {
      gatherOutcomes: gatherReport.sources.map(({ sourceId, outcome }) => ({ sourceId, outcome })),
      sources: status.sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.finalUrl || source.url,
        retrievedAt: source.fetchedAt,
        contentChangedAt: source.contentChangedAt,
        passages: source.chunkCount,
        lastError: source.lastError ?? null,
      })),
      storedPassages: status.storedPassages,
    },
    cases: records,
    failureDemonstration: failureDemo,
    summary: {
      cases: records.length,
      passed: records.filter((record) => record.passed).length,
      failed: records.filter((record) => !record.passed).length,
    },
  };

  mkdirSync(resultsDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const base = join(resultsDir, `${run.mode}-${stamp}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  writeFileSync(`${base}.md`, renderMarkdown(run), 'utf8');

  if (tempDir) rmSync(tempDir, { recursive: true, force: true });

  console.log(`\n${run.mode}: ${run.summary.passed}/${run.summary.cases} case(s) passed every check.`);
  for (const record of records) {
    console.log(`  ${record.passed ? 'PASS' : 'FAIL'}  ${record.id.padEnd(13)} ${record.kind}`);
    for (const check of record.checks.filter((c) => !c.passed)) {
      console.log(`        failed check: ${check.name} — ${check.detail}`);
    }
  }
  console.log(`\nWritten to ${base}.json and ${base}.md`);
  return run.summary.failed === 0 ? 0 : 1;
}

async function demonstrateFailure(dataDir: string): Promise<FailureDemonstration> {
  const target = 'xero-pricing-au';

  // A second service over the same store, with a fetcher that fails for this
  // one source exactly as an unavailable page would.
  const failing = new ResearchService({
    dataDir,
    sourcesFile: resolve(projectRoot, 'eval/fixtures/sources.json'),
    fetcher: async (url: string) => {
      if (url.endsWith('/pricing-au')) {
        throw new FetchFailure('http_error', 'Simulated 503 from the pricing page', 503);
      }
      return fixtureFetcher(url);
    },
    model: scriptedModel,
  });
  const before = failing.status().sources.find((source) => source.id === target);

  const report = await failing.refresh();
  const after = failing.status().sources.find((source) => source.id === target);
  const answer = await failing.ask('How much does the Xero Grow plan cost per month in Australia?');

  return {
    description:
      'One source is made to fail during an explicit refresh. The stored evidence must survive untouched, keep its ' +
      'original retrieval time, and be reported as not refreshed.',
    refreshReport: report.sources.map((source) => ({
      sourceId: source.sourceId,
      outcome: source.outcome,
      error: source.error?.kind ?? null,
      servingEvidenceFrom: source.servingEvidenceFrom ?? null,
    })),
    evidenceSurvived: {
      passagesBefore: before?.chunkCount ?? 0,
      passagesAfter: after?.chunkCount ?? 0,
      retrievedAtBefore: before?.fetchedAt ?? null,
      retrievedAtAfter: after?.fetchedAt ?? null,
      retrievalTimeUnchanged: before?.fetchedAt === after?.fetchedAt,
      recordedError: after?.lastError ?? null,
    },
    answerAfterFailure: {
      status: answer.status,
      warnings: answer.warnings,
      citationsMarkedStale: answer.citations.filter((citation) => citation.staleWarning).length,
    },
  };
}

function renderMarkdown(run: EvalRun): string {
  const lines: string[] = [];
  lines.push(`# Research evaluation — ${run.mode}`);
  lines.push('');
  lines.push(`**Model outputs:** ${run.modelOutputs}`);
  lines.push(`**Model:** \`${run.model}\` via \`${run.endpoint}\``);
  lines.push(
    `**Configuration:** temperature ${run.configuration.temperature}, max tokens ${run.configuration.maxTokens}, ` +
      `top-k ${run.configuration.retrievalTopK}, max ${run.configuration.retrievalMaxPerSource} passages per source`,
  );
  lines.push(`**Run started:** ${run.startedAt}`);
  lines.push('');
  lines.push('## Sources used');
  lines.push('');
  lines.push('| Source | URL | Retrieved | Passages |');
  lines.push('| --- | --- | --- | --- |');
  for (const source of run.research.sources) {
    lines.push(`| ${source.title} | ${source.url} | ${source.retrievedAt} | ${source.passages} |`);
  }
  lines.push('');
  lines.push(
    `Research step for this run: ${run.research.gatherOutcomes.map((o) => `${o.sourceId}=${o.outcome}`).join(', ')}.`,
  );
  lines.push('');
  lines.push(`## Results: ${run.summary.passed}/${run.summary.cases} cases passed every check`);

  for (const record of run.cases) {
    lines.push('');
    lines.push(`### ${record.kind} — \`${record.id}\` — ${record.passed ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(`**Question:** ${record.question}`);
    lines.push('');
    lines.push(`**Expected behaviour:** ${record.expectedBehaviour}`);
    lines.push('');
    if (record.error) {
      lines.push(`**Result:** no answer produced — ${record.error.kind}: ${record.error.message}`);
      continue;
    }
    lines.push(`**Actual output (status: ${record.status}):**`);
    lines.push('');
    lines.push(`> ${record.answer.replace(/\n/g, '\n> ')}`);
    if (record.notes) {
      lines.push('');
      lines.push(`**Context stated:** ${record.notes}`);
    }
    if (record.unknowns.length) {
      lines.push('');
      lines.push(`**Reported as not established:** ${record.unknowns.join('; ')}`);
    }
    lines.push('');
    lines.push('**Evidence retrieved for this question:**');
    lines.push('');
    for (const item of record.evidence) {
      lines.push(`- \`${item.chunkId}\` — ${item.sourceTitle} (${item.url}), retrieved ${item.retrievedAt}`);
      lines.push(`  > ${item.snippet.replace(/\n/g, ' ')}`);
    }
    if (record.claims.length) {
      lines.push('');
      lines.push('**Claim verification (application-side):**');
      lines.push('');
      lines.push('| Verdict | Claim | Cites |');
      lines.push('| --- | --- | --- |');
      for (const claim of record.claims) {
        lines.push(`| ${claim.verdict} | ${claim.text.replace(/\|/g, '\\|')} | ${claim.cites.join(', ') || '—'} |`);
      }
    }
    if (record.warnings.length) {
      lines.push('');
      lines.push(`**Warnings:** ${record.warnings.join(' / ')}`);
    }
    lines.push('');
    lines.push('**Assessment:**');
    lines.push('');
    for (const check of record.checks) {
      lines.push(`- ${check.passed ? 'pass' : 'FAIL'} — ${check.name}: ${check.detail}`);
    }
    const model = record.model;
    lines.push(
      `- retrieval: ${record.retrieval.selected.length} of ${record.retrieval.consideredChunks} stored passages, ` +
        `${record.fetchesDuringCase} source fetch(es) during this case` +
        (model?.called
          ? `; model ${model.name} used ${model.usage?.totalTokens ?? 0} tokens in ${model.latencyMs}ms`
          : '; no model call was needed'),
    );
  }

  if (run.failureDemonstration) {
    lines.push('');
    lines.push('## Failure handling');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(run.failureDemonstration, null, 2));
    lines.push('```');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Evaluation failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
