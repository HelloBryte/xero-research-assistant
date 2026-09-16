/**
 * One test per defect found by exploratory testing (`npm run explore`).
 *
 * Each name states the defect, so a failure here says which behaviour came
 * back rather than which assertion tripped. The exploratory reports that found
 * them are archived under eval/exploratory/results/.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLog } from '../src/activity.js';
import { parseModelJson } from '../src/answer.js';
import { loadSources } from '../src/config.js';
import { ResearchStore } from '../src/store.js';
import { RetrievalIndex, tokenize } from '../src/retrieve.js';
import { checkClaim } from '../src/verify.js';
import { createHarness, fakeModel, html, type Harness } from './helpers.js';
import type { Chunk } from '../src/types.js';

const chunk = (id: string, sourceId: string, text: string, heading: string | null = null): Chunk => ({
  id,
  sourceId,
  index: Number(id.split('#')[1]),
  heading,
  text,
});

let harness: Harness;
afterEach(() => harness?.cleanup());

describe('activity log paging', () => {
  it('does not return the whole log when the limit is zero or negative', () => {
    // `slice(-0)` is `slice(0)`, so /api/activity?limit=0 dumped every event.
    const directory = mkdtempSync(join(tmpdir(), 'xero-activity-'));
    try {
      const log = new ActivityLog(directory);
      const run = log.startRun('gather');
      for (let i = 0; i < 5; i++) run.event('source_reused', `event ${i}`);

      expect(log.tail(5)).toHaveLength(5);
      expect(log.tail(2)).toHaveLength(2);
      expect(log.tail(0)).toHaveLength(0);
      expect(log.tail(-3)).toHaveLength(0);
      expect(log.tail(Number.NaN)).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('retrieval input validation', () => {
  const corpus = [
    chunk('au#0', 'au', '$7.80 per month then $78 per month for the Grow plan.', 'Grow'),
    chunk('au#1', 'au', 'Payroll for two people and a 60 day cashflow forecast.', 'Grow'),
    chunk('au#2', 'au', 'Send invoices and quotes, reconcile bank transactions.', 'Grow'),
  ];

  it('does not report an empty result for a top-k of zero', () => {
    // A top-k of 0 arriving from an HTTP body produced zero passages, which the
    // answer path then reported as "the research contains nothing on this
    // topic" — a false statement about the evidence caused by an input value.
    const index = new RetrievalIndex(corpus);
    expect(index.search('Grow plan monthly price', { topK: 0 }).results.length).toBeGreaterThan(0);
    expect(index.search('Grow plan monthly price', { topK: -5 }).results.length).toBeGreaterThan(0);
    expect(index.search('Grow plan monthly price', { topK: Number.NaN }).results.length).toBeGreaterThan(0);
  });

  it('caps an oversized top-k instead of sending the whole corpus to the model', () => {
    const many = Array.from({ length: 200 }, (_, i) => chunk(`au#${i}`, 'au', `Passage ${i} about the Grow plan.`));
    const result = new RetrievalIndex(many).search('Grow plan', { topK: 10_000, maxPerSource: 10_000 });
    expect(result.results.length).toBeLessThanOrEqual(50);
  });

  it('treats a per-source cap of zero as one, so diversity still applies', () => {
    const twoSources = [
      ...corpus,
      chunk('about#0', 'about', 'The Grow plan is used by small businesses worldwide.', 'Customers'),
    ];
    // A cap of 0 must not disable the per-source rule. The first pick from each
    // source comes before a second pick from any source; the remaining slots
    // are then topped up, which is what keeps top-k full when sources are few.
    const result = new RetrievalIndex(twoSources).search('Grow plan', { topK: 3, maxPerSource: 0 });
    expect(new Set(result.results.slice(0, 2).map((item) => item.chunk.sourceId)).size).toBe(2);
  });
});

describe('retrieval ranking', () => {
  it('does not let the pronoun "us" match a question about the United States', () => {
    // "the US" collided with "Tell us a little about your business", and BM25
    // ranked an Australian call-to-action above every US pricing passage.
    const corpus = [
      chunk('au#0', 'au', 'Tell us a little about your business and we will point you to the right plan.', 'Pick a plan'),
      chunk('us#0', 'us', '$2.50 per month. Then $25 per month. An easy financial foundation.', 'Early'),
    ];
    const context = new Map([
      ['au', 'Pricing Plans Australia AU AUD'],
      ['us', 'Pricing Plans United States US USD'],
    ]);

    const result = new RetrievalIndex(corpus, context).search("What's the cheapest Xero plan in the US?");

    expect(result.results[0]!.chunk.sourceId).toBe('us');
    expect(result.terms).not.toContain('us');
    expect(result.terms).toContain('united');
  });

  it('does not let source metadata dilute the weight of a word in the passage text', () => {
    // Counting metadata in one document-frequency table made any word in a
    // source description look common, stripping its IDF for real body matches:
    // the passage that actually says "5 million customers" fell to ninth.
    const corpus = [
      chunk('about#0', 'about', 'Xero serves 5 million customers in 180+ countries.', 'Reach'),
      chunk('about#1', 'about', 'Automate everyday business admin with online tools.', 'Admin'),
      chunk('about#2', 'about', 'Work with an advisor who knows your business.', 'Advisors'),
    ];
    // Every passage of this source carries "customers" in its metadata.
    const context = new Map([['about', 'About Xero Global company overview and intended customers']]);

    const result = new RetrievalIndex(corpus, context).search('How many customers does Xero have?');

    expect(result.results[0]!.chunk.id).toBe('about#0');
  });

  it('prefers a passage that states a price when the question asks about cost', () => {
    // "Cheapest" appears nowhere in the evidence; the passages that answer it
    // are the ones holding a monetary amount, which no word in them announces.
    const corpus = [
      chunk('us#0', 'us', 'Rich, visual analytics on every plan with Xero Analytics.', 'Insights'),
      chunk('us#1', 'us', '$2.50 per month. Then $25 per month. An easy financial foundation.', 'Early'),
    ];
    const context = new Map([['us', 'Pricing Plans United States USD']]);

    const priced = new RetrievalIndex(corpus, context).search('What is the cheapest plan?');
    expect(priced.results[0]!.chunk.id).toBe('us#1');
    expect(priced.facets).toContain('facet:price');

    // The facet must not fire for a question that is not about cost.
    const unpriced = new RetrievalIndex(corpus, context).search('Which plan includes analytics?');
    expect(unpriced.facets).toHaveLength(0);
    expect(unpriced.results[0]!.chunk.id).toBe('us#0');
  });

  it('does not treat annual revenue as a price', () => {
    // The first version of the facet matched any monetary amount, so a question
    // about what a plan costs pulled the encyclopaedia infobox's revenue line in
    // ahead of the plan cards.
    const corpus = [
      chunk('wiki#0', 'wiki', 'Revenue NZ$2.753 billion (2026) Operating income NZ$316.1 million', 'Xero Limited'),
      chunk('us#0', 'us', '$2.50 per month. Then $25 per month.', 'Early'),
    ];
    const result = new RetrievalIndex(corpus).search('What is the cheapest Xero plan per month?');
    expect(result.results[0]!.chunk.id).toBe('us#0');
  });

  it('does not return a passage that only matches a facet and none of the words typed', () => {
    const corpus = [chunk('us#0', 'us', '$2.50 per month. Then $25 per month.', 'Early')];
    // "Cost" triggers the price facet, but nothing in the question matches the
    // passage, so a facet alone must not manufacture a result.
    expect(new RetrievalIndex(corpus).search('What does onboarding cost in Canada?').results).toHaveLength(0);
  });
});

describe('claim verification', () => {
  const passage = {
    heading: 'Comprehensive',
    text:
      '$10.70 per month\nThen $107 per month\nIncluded Payroll for 5 people\n' +
      'Included Use multiple currencies\nIncluded Budget with smart suggestions',
  };
  // Words the corpus uses somewhere. "heading" and "lists" are the model's own
  // framing and appear in no passage.
  const vocabulary = new Set(
    tokenize(
      'xero plan information shown under comprehensive included multiple currencies feature ' +
        'payroll month budget suggestions people company staff office employs regional across',
    ),
  );

  it('does not fail a verbatim-correct claim because it is wrapped in framing words', () => {
    const claim =
      'The Xero plan information shown under the heading "Comprehensive" lists ' +
      '"Included Use multiple currencies" as a feature.';

    // Two thirds of this claim is framing; counting it made a claim whose facts
    // are quoted verbatim from the passage look unsupported.
    expect(checkClaim(claim, [passage]).verdict).toBe('unsupported');
    expect(checkClaim(claim, [passage], { corpusVocabulary: vocabulary }).verdict).not.toBe('unsupported');
  });

  it('still rejects a citation that points at an unrelated passage', () => {
    const claim = 'The company employs staff across nineteen regional offices.';
    expect(checkClaim(claim, [passage], { corpusVocabulary: vocabulary }).verdict).toBe('unsupported');
  });

  it('still rejects a figure the cited passage does not contain', () => {
    const claim = 'The Comprehensive plan costs $99 per month.';
    const check = checkClaim(claim, [passage], { corpusVocabulary: vocabulary });
    expect(check.verdict).toBe('unsupported');
    expect(check.missingFigures).toContain('99');
  });
});

describe('questions the index cannot search', () => {
  const PRICING_URL = 'https://example.test/pricing';

  async function gathered() {
    harness = createHarness({
      sources: [{ id: 'pricing', url: PRICING_URL, region: 'AU', currency: 'AUD' }],
      pages: {
        [PRICING_URL]: html('Pricing', '<h2>Grow</h2><div>$7.80 per month</div><p>Then $78 per month.</p>'),
      },
      model: fakeModel({ status: 'answered', answer: 'should not be reached', claims: [] }),
    });
    await harness.service.gather();
    return harness;
  }

  it('says the question could not be searched, not that the research lacks the topic', async () => {
    // A question in another script tokenizes to nothing. Reporting that as
    // "the stored research contains no passage related to this question" is a
    // false statement about the evidence: the research does cover pricing.
    const h = await gathered();

    const result = await h.service.ask('这个会计软件每个月多少钱？');

    expect(result.status).toBe('insufficient');
    expect(result.model?.called).toBe(false);
    expect(h.modelCount()).toBe(0);
    expect(result.answer).not.toMatch(/contains no passage related/i);
    expect(result.answer).toMatch(/could not be searched/i);
  });

  it('applies the same wording to emoji and to stopword-only questions', async () => {
    const h = await gathered();
    for (const question of ['😀😀😀', 'what is the of and a']) {
      const result = await h.service.ask(question);
      expect(result.answer, question).toMatch(/could not be searched/i);
    }
  });

  it('still reports a genuine coverage gap as a coverage gap', async () => {
    const h = await gathered();

    const result = await h.service.ask('quantum chromodynamics lattice spacing');

    expect(result.answer).toMatch(/contains no passage related/i);
    expect(result.answer).not.toMatch(/could not be searched/i);
  });
});

describe('source configuration', () => {
  function load(content: string) {
    const directory = mkdtempSync(join(tmpdir(), 'xero-config-'));
    const file = join(directory, 'sources.json');
    writeFileSync(file, content, 'utf8');
    try {
      return { result: loadSources(file), error: null as Error | null, file };
    } catch (error) {
      return { result: null, error: error as Error, file };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it('refuses an empty source list rather than letting gather delete all stored research', () => {
    // Gather prunes evidence for sources no longer configured, so an empty list
    // used to wipe every stored source on the next run.
    const { error } = load('{"sources": []}');
    expect(error?.message).toMatch(/no sources/i);
  });

  it('names the file when it is not valid JSON', () => {
    const { error, file } = load('{"sources": [{"id": "a", "url": "https://x.test/"} {"id": "b"}]}');
    expect(error?.message).toContain(file);
    expect(error?.message).toMatch(/not valid JSON/);
  });

  it('refuses source ids that would break passage ids or URL paths', () => {
    for (const id of ['xero#1', 'xero/pricing', 'xero pricing', '-leading']) {
      const { error } = load(JSON.stringify({ sources: [{ id, url: 'https://x.test/' }] }));
      expect(error, id).not.toBeNull();
    }
    expect(load('{"sources": [{"id": "xero-pricing_au", "url": "https://x.test/"}]}').error).toBeNull();
  });
});

describe('claims the verifier cannot read', () => {
  const passage = {
    heading: 'Grow',
    text: '$7.80 per month\nThen $78 per month\nIncluded Payroll for 2 people\nPrices are in AUD and include GST.',
  };

  it('does not report a claim in another script as supported', () => {
    // Tokenisation drops the Chinese entirely, leaving [grow, 7.80, gst]: a
    // perfect overlap for a claim that says prices EXCLUDE GST.
    const wrong = 'Grow 套餐每月 $7.80，不含 GST，而且支持无限员工的工资发放。';
    const check = checkClaim(wrong, [passage]);
    expect(check.verdict).toBe('weak');
    expect(check.reason).toMatch(/only its figures could be checked/);
  });

  it('still rejects a wrong figure in a claim written in another script', () => {
    expect(checkClaim('Grow 套餐每月 $9.99', [passage]).verdict).toBe('unsupported');
  });

  it('leaves English claims with a few non-Latin characters alone', () => {
    expect(checkClaim('The Grow plan is $7.80 per month, then $78 per month (套餐).', [passage]).verdict).toBe(
      'supported',
    );
  });
});

describe('model reply validation', () => {
  it('treats well-formed JSON without answer text as an invalid response', () => {
    // These used to be returned to the user as successful, empty answers.
    for (const raw of [
      '{"status": "answered", "claims": []}',
      '{"status": "answered", "answer": "", "claims": []}',
      '{"status": "answered", "answer": "   ", "claims": []}',
      '{"status": "answered", "answer": 42, "claims": []}',
    ]) {
      expect(() => parseModelJson(raw), raw).toThrow(/no "answer" text/);
    }
    expect(parseModelJson('{"status": "insufficient", "answer": "Not covered.", "claims": []}').answer).toBe(
      'Not covered.',
    );
  });
});

describe('store temp files', () => {
  it('removes the temp files a crashed write actually leaves behind', () => {
    // persist() writes store.json.<pid>.tmp; cleanup looked for store.json.tmp,
    // which nothing writes, so it never removed anything.
    const directory = mkdtempSync(join(tmpdir(), 'xero-store-'));
    try {
      const stray = join(directory, 'store.json.12345.tmp');
      const unrelated = join(directory, 'notes.tmp');
      writeFileSync(stray, '{"half":', 'utf8');
      writeFileSync(unrelated, 'keep me', 'utf8');

      ResearchStore.cleanTemp(directory);

      expect(existsSync(stray)).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
