/**
 * Exploratory test run.
 *
 * The four cases in `eval/cases.json` are the required evaluation. This is the
 * wider sweep: questions a reviewer or a real user would actually type,
 * including the ones they type by accident, grouped by what each is probing.
 *
 * Every case goes through `ResearchService.ask` — the same path the web app
 * uses — and each records the question, what was being checked, the retrieved
 * evidence, the actual answer, the application's own claim verdicts, and a
 * mechanical pass or fail. Nothing is hard-coded per question and no model
 * grades another model.
 *
 *   npm run explore
 *   npm run explore -- --bank eval/exploratory/questions-held-out.json --label 07-held-out
 *
 * This needs a real model: exploratory questions are about what a model does
 * with real evidence, so there is no mocked mode. The credential-free paths are
 * `npm test` and `npm run eval -- --offline`.
 *
 * Results are archived under eval/exploratory/results/<label or timestamp>/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AnswerResult } from '../../src/answer.js';
import { config, llmConfigured, projectRoot } from '../../src/config.js';
import { ModelFailure } from '../../src/llm.js';
import { ResearchService } from '../../src/service.js';

interface Checks {
  status?: string[];
  minCitations?: number;
  minDistinctSources?: number;
  requireSourceIds?: string[];
  maxUnsupported?: number;
  requireUnknowns?: boolean;
  expectModelCall?: boolean;
  mustMentionAny?: string[];
  mustNotMention?: string[];
  /** Fails only if the answer *is* this text — quoting an injected instruction while refusing it is correct. */
  mustNotBeOnly?: string[];
  sameEvidenceAs?: string;
  expectError?: boolean;
}

interface ExploratoryCase {
  id: string;
  category: string;
  question?: string;
  /** For pasted walls of text, so the bank stays readable. */
  questionRepeat?: { text: string; times: number };
  checking: string;
  checks: Checks;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface CaseRecord {
  id: string;
  category: string;
  question: string;
  questionLength: number;
  checking: string;
  outcome: 'pass' | 'fail';
  status: string;
  answer: string;
  notes: string;
  unknowns: string[];
  modelCalled: boolean;
  modelTokens: number | null;
  latencyMs: number | null;
  fetchesDuringCase: number;
  retrieval: { terms: string[]; coverage: number; quality: string; selected: string[]; consideredChunks: number };
  claims: { verdict: string; text: string; cites: string[]; reason: string }[];
  warnings: string[];
  error: { kind: string; message: string } | null;
  checks: CheckResult[];
}

function questionOf(testCase: ExploratoryCase): string {
  if (testCase.questionRepeat) return testCase.questionRepeat.text.repeat(testCase.questionRepeat.times);
  return testCase.question ?? '';
}

function runChecks(
  testCase: ExploratoryCase,
  result: AnswerResult | null,
  context: {
    error: Error | null;
    fetchesDuringCase: number;
    previous: Map<string, AnswerResult>;
    /** Retrieved passages plus the retrieval time of each passage's source. */
    reuseSignature: (result: AnswerResult) => string;
  },
): CheckResult[] {
  const checks: CheckResult[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const want = testCase.checks;

  if (want.expectError) {
    add(
      'rejected as invalid input',
      context.error !== null,
      context.error ? `rejected: ${context.error.message}` : 'the application answered instead of rejecting it',
    );
    return checks;
  }

  if (context.error || !result) {
    add('produced a result', false, context.error ? `${context.error.name}: ${context.error.message}` : 'no result');
    return checks;
  }

  // Every case asserts this: answering must never touch the network.
  add('no source fetched while answering', context.fetchesDuringCase === 0, `${context.fetchesDuringCase} fetch(es)`);

  if (want.status) {
    add('status', want.status.includes(result.status), `status=${result.status}, allowed=${want.status.join('|')}`);
  }
  if (want.minCitations !== undefined) {
    add('citations', result.citations.length >= want.minCitations, `${result.citations.length} citation(s)`);
  }
  if (want.minDistinctSources !== undefined) {
    const distinct = new Set(result.citations.map((citation) => citation.sourceId));
    add(
      'distinct cited sources',
      distinct.size >= want.minDistinctSources,
      `${distinct.size}: ${[...distinct].join(', ') || 'none'}`,
    );
  }
  if (want.requireSourceIds) {
    const cited = new Set(result.citations.map((citation) => citation.sourceId));
    const missing = want.requireSourceIds.filter((id) => !cited.has(id));
    add('required source cited', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : 'present');
  }
  if (want.maxUnsupported !== undefined) {
    const bad = result.grounding.unsupported + result.grounding.uncited;
    add(
      'every claim verified against its citation',
      bad <= want.maxUnsupported,
      `${result.grounding.supported} supported, ${result.grounding.weak} weak, ${result.grounding.unsupported} unsupported, ${result.grounding.uncited} uncited`,
    );
  }
  if (want.requireUnknowns) {
    add('states what it could not establish', result.unknowns.length > 0, `${result.unknowns.length} unknown(s)`);
  }
  if (want.expectModelCall !== undefined) {
    const called = result.model?.called === true;
    add(
      want.expectModelCall ? 'model was called' : 'no model call was spent',
      called === want.expectModelCall,
      `model called = ${called}`,
    );
  }

  const haystack = `${result.answer} ${result.notes} ${result.unknowns.join(' ')}`.toLowerCase();
  if (want.mustMentionAny) {
    const hit = want.mustMentionAny.find((needle) => haystack.includes(needle.toLowerCase()));
    add('mentions required context', hit !== undefined, hit ? `found "${hit}"` : `none of: ${want.mustMentionAny.join(', ')}`);
  }
  if (want.mustNotMention) {
    const leaked = want.mustNotMention.filter((needle) => haystack.includes(needle.toLowerCase()));
    add('does not contain forbidden text', leaked.length === 0, leaked.length ? `leaked: ${leaked.join(', ')}` : 'clean');
  }
  if (want.mustNotBeOnly) {
    const bare = result.answer.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const complied = want.mustNotBeOnly.find((needle) => bare === needle.replace(/[^a-z0-9]/gi, '').toLowerCase());
    add(
      'did not comply with the injected instruction',
      complied === undefined,
      complied ? `the answer is exactly "${complied}"` : 'the answer is a grounded refusal, not the injected output',
    );
  }
  if (want.sameEvidenceAs) {
    const earlier = context.previous.get(want.sameEvidenceAs);
    if (!earlier) {
      add('reuses earlier research', false, `case "${want.sameEvidenceAs}" did not run`);
    } else {
      // Compared on what the application decides, not on what the model chose
      // to cite: retrieval is deterministic, citation is not.
      const same = context.reuseSignature(earlier) === context.reuseSignature(result);
      add(
        'reuses earlier research',
        same,
        same
          ? `identical passages, each still carrying the retrieval time it had in "${want.sameEvidenceAs}"`
          : 'the retrieved passages or their retrieval times differ',
      );
    }
  }
  return checks;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<number> {
  // An earlier version accepted --offline but still called the real model while
  // labelling its outputs "MOCKED". Mislabelled evidence is worse than none, so
  // the flag is refused outright.
  if (process.argv.includes('--offline')) {
    console.error('The exploratory sweep has no offline mode. Use `npm test` or `npm run eval -- --offline`.');
    return 2;
  }
  if (!llmConfigured()) {
    console.error('No model credentials configured. Set LLM_API_KEY in .env.');
    return 2;
  }

  const bankPath = argument('--bank') ?? 'eval/exploratory/questions.json';
  const label = argument('--label');
  const bank = JSON.parse(readFileSync(resolve(projectRoot, bankPath), 'utf8')) as {
    categories: Record<string, string>;
    cases: ExploratoryCase[];
  };

  const service = new ResearchService();
  const startedAt = new Date().toISOString();

  const gatherReport = await service.gather();
  const status = service.status();
  if (status.storedSources === 0) {
    console.error('No research is stored. Run `npm run gather` first.');
    return 2;
  }

  // Fetches are counted from the application's own activity log, so "nothing
  // was fetched" is the application's evidence rather than the harness's claim.
  const countFetches = () =>
    service.activity
      .tail(5000)
      .filter((event) => event.type === 'source_fetched' || event.type === 'source_reprocessed').length;

  const previous = new Map<string, AnswerResult>();
  const records: CaseRecord[] = [];

  for (const testCase of bank.cases) {
    const question = questionOf(testCase);
    const before = countFetches();
    let result: AnswerResult | null = null;
    let error: Error | null = null;
    try {
      result = await service.ask(question);
      previous.set(testCase.id, result);
    } catch (caught) {
      error = caught as Error;
    }
    const fetchesDuringCase = countFetches() - before;
    const reuseSignature = (answer: AnswerResult) =>
      answer.retrieval.selected
        .map((selected) => `${selected.chunkId}@${service.trace(selected.chunkId)?.source.fetchedAt ?? '?'}`)
        .sort()
        .join(',');
    const checks = runChecks(testCase, result, { error, fetchesDuringCase, previous, reuseSignature });

    records.push({
      id: testCase.id,
      category: testCase.category,
      question,
      questionLength: question.length,
      checking: testCase.checking,
      outcome: checks.every((check) => check.passed) ? 'pass' : 'fail',
      status: result?.status ?? (error ? 'rejected' : 'unknown'),
      answer: result?.answer ?? '',
      notes: result?.notes ?? '',
      unknowns: result?.unknowns ?? [],
      modelCalled: result?.model?.called ?? false,
      modelTokens: result?.model?.usage?.totalTokens ?? null,
      latencyMs: result?.model?.latencyMs ?? null,
      fetchesDuringCase,
      retrieval: {
        terms: result?.retrieval.terms ?? [],
        coverage: result?.retrieval.coverage ?? 0,
        quality: result?.retrieval.quality ?? 'none',
        selected: result?.retrieval.selected.map((s) => `${s.label}=${s.chunkId}`) ?? [],
        consideredChunks: result?.retrieval.consideredChunks ?? 0,
      },
      claims:
        result?.claims.map((claim) => ({
          verdict: claim.check.verdict,
          text: claim.text,
          cites: claim.citations.map((citation) => citation.chunkId),
          reason: claim.check.reason,
        })) ?? [],
      warnings: result?.warnings ?? [],
      error: error
        ? { kind: error instanceof ModelFailure ? error.kind : error.name, message: error.message }
        : null,
      checks,
    });

    const mark = records[records.length - 1]!.outcome === 'pass' ? 'pass' : 'FAIL';
    console.log(`  ${mark.padEnd(4)} ${testCase.category.padEnd(13)} ${testCase.id}`);
  }

  const run = {
    mode: 'live-model',
    modelOutputs: 'REAL — replies come from the configured model endpoint',
    bank: bankPath,
    startedAt,
    finishedAt: new Date().toISOString(),
    model: config.llm.model,
    endpoint: config.llm.baseUrl,
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
        passages: source.chunkCount,
      })),
      storedPassages: status.storedPassages,
    },
    categories: bank.categories,
    cases: records,
    summary: {
      cases: records.length,
      passed: records.filter((r) => r.outcome === 'pass').length,
      failed: records.filter((r) => r.outcome === 'fail').length,
      modelCalls: records.filter((r) => r.modelCalled).length,
      totalTokens: records.reduce((sum, r) => sum + (r.modelTokens ?? 0), 0),
      byCategory: Object.fromEntries(
        Object.keys(bank.categories).map((category) => {
          const inCategory = records.filter((r) => r.category === category);
          return [category, { cases: inCategory.length, passed: inCategory.filter((r) => r.outcome === 'pass').length }];
        }),
      ),
    },
  };

  const stamp = startedAt.replace(/[:.]/g, '-');
  const directory = join(resolve(projectRoot, 'eval/exploratory/results'), label ?? `${run.mode}-${stamp}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'results.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  writeFileSync(join(directory, 'report.md'), renderMarkdown(run), 'utf8');

  console.log(`\n${run.summary.passed}/${run.summary.cases} passed. ${run.summary.modelCalls} model call(s), ${run.summary.totalTokens} tokens.`);
  for (const [category, tally] of Object.entries(run.summary.byCategory)) {
    console.log(`  ${category.padEnd(13)} ${tally.passed}/${tally.cases}`);
  }
  console.log(`\nArchived to ${directory}`);
  return run.summary.failed === 0 ? 0 : 1;
}

type Run = Awaited<ReturnType<typeof buildRun>>;
declare function buildRun(): Promise<{
  mode: string;
  modelOutputs: string;
  bank: string;
  startedAt: string;
  model: string;
  endpoint: string;
  configuration: { temperature: number; maxTokens: number; retrievalTopK: number; retrievalMaxPerSource: number };
  research: {
    sources: { id: string; title: string; url: string; retrievedAt: string; passages: number }[];
    storedPassages: number;
    gatherOutcomes: { sourceId: string; outcome: string }[];
  };
  categories: Record<string, string>;
  cases: CaseRecord[];
  summary: {
    cases: number;
    passed: number;
    failed: number;
    modelCalls: number;
    totalTokens: number;
    byCategory: Record<string, { cases: number; passed: number }>;
  };
}>;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length} characters in total]`;
}

function renderMarkdown(run: Run): string {
  const lines: string[] = [];
  lines.push('# Exploratory test run');
  lines.push('');
  lines.push(`**Model outputs:** ${run.modelOutputs}`);
  lines.push(`**Question bank:** \`${run.bank}\``);
  lines.push(`**Model:** \`${run.model}\` via \`${run.endpoint}\`, temperature ${run.configuration.temperature}`);
  lines.push(`**Retrieval:** top ${run.configuration.retrievalTopK}, max ${run.configuration.retrievalMaxPerSource} per source`);
  lines.push(`**Run started:** ${run.startedAt}`);
  lines.push(`**Research:** ${run.research.storedPassages} passages from ${run.research.sources.length} sources`);
  lines.push('');
  for (const source of run.research.sources) {
    lines.push(`- \`${source.id}\` — ${source.url} — retrieved ${source.retrievedAt} — ${source.passages} passages`);
  }
  lines.push('');
  lines.push(`## Summary: ${run.summary.passed}/${run.summary.cases} passed`);
  lines.push('');
  lines.push('| Category | What it probes | Passed |');
  lines.push('| --- | --- | --- |');
  for (const [category, description] of Object.entries(run.categories)) {
    const tally = run.summary.byCategory[category];
    lines.push(`| ${category} | ${description} | ${tally?.passed ?? 0}/${tally?.cases ?? 0} |`);
  }
  lines.push('');
  lines.push(
    `${run.summary.modelCalls} of ${run.summary.cases} cases reached the model (${run.summary.totalTokens} tokens in total); ` +
      'the rest were resolved by application logic before any model call.',
  );

  for (const category of Object.keys(run.categories)) {
    const inCategory = run.cases.filter((record) => record.category === category);
    if (inCategory.length === 0) continue;
    lines.push('');
    lines.push(`## ${category}`);
    lines.push('');
    lines.push(`_${run.categories[category]}_`);

    for (const record of inCategory) {
      lines.push('');
      lines.push(`### \`${record.id}\` — ${record.outcome === 'pass' ? 'PASS' : 'FAIL'}`);
      lines.push('');
      lines.push(`**Question typed:** ${JSON.stringify(truncate(record.question, 300))}`);
      lines.push('');
      lines.push(`**What this probes:** ${record.checking}`);
      lines.push('');
      if (record.error) {
        lines.push(`**Result:** rejected — ${record.error.kind}: ${record.error.message}`);
      } else {
        lines.push(`**Status:** ${record.status}`);
        lines.push('');
        lines.push('**Answer:**');
        lines.push('');
        lines.push(`> ${truncate(record.answer, 1200).replace(/\n/g, '\n> ') || '(empty)'}`);
        if (record.notes) {
          lines.push('');
          lines.push(`**Context stated:** ${truncate(record.notes, 600)}`);
        }
        if (record.unknowns.length) {
          lines.push('');
          lines.push(`**Reported as not established:** ${record.unknowns.map((u) => truncate(u, 200)).join(' / ')}`);
        }
        lines.push('');
        lines.push(
          `**Retrieval:** terms [${record.retrieval.terms.join(', ')}] → ${record.retrieval.selected.length} of ` +
            `${record.retrieval.consideredChunks} passages (${record.retrieval.quality}, coverage ${record.retrieval.coverage}); ` +
            `${record.retrieval.selected.join(', ') || 'none'}`,
        );
        if (record.claims.length) {
          lines.push('');
          lines.push('| Verdict | Claim | Cites |');
          lines.push('| --- | --- | --- |');
          for (const claim of record.claims) {
            lines.push(
              `| ${claim.verdict} | ${truncate(claim.text, 200).replace(/\|/g, '\\|')} | ${claim.cites.join(', ') || '—'} |`,
            );
          }
        }
        if (record.warnings.length) {
          lines.push('');
          lines.push(`**Warnings:** ${record.warnings.map((w) => truncate(w, 200)).join(' / ')}`);
        }
      }
      lines.push('');
      lines.push('**Checks:**');
      lines.push('');
      for (const check of record.checks) {
        lines.push(`- ${check.passed ? 'pass' : 'FAIL'} — ${check.name}: ${check.detail}`);
      }
      if (record.modelCalled) {
        lines.push(`- model: ${record.modelTokens} tokens, ${record.latencyMs}ms`);
      } else if (!record.error) {
        lines.push('- model: not called');
      }
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Exploratory run failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
