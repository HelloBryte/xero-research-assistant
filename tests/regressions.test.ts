/**
 * One test per defect found by exploratory testing (`npm run explore`).
 *
 * Each name states the defect, so a failure here says which behaviour came
 * back rather than which assertion tripped. The exploratory reports that found
 * them are archived under eval/exploratory/results/.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLog } from '../src/activity.js';
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
