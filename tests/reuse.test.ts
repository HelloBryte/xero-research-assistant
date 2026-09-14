import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, fakeModel, html, type Harness } from './helpers.js';
import { FetchFailure } from '../src/http.js';

const PRICING_URL = 'https://example.test/pricing';
const ABOUT_URL = 'https://example.test/about';

const PRICING_V1 = html(
  'Pricing',
  '<h2>Grow</h2><div>$7.80 per month</div><p>Then $78 per month for the Grow plan.</p>' +
    '<h2>Comprehensive</h2><div>$10.70 per month</div><p>Then $107 per month.</p>',
);
const PRICING_V2 = html(
  'Pricing',
  '<h2>Grow</h2><div>$9.00 per month</div><p>Then $90 per month for the Grow plan.</p>' +
    '<h2>Comprehensive</h2><div>$12.00 per month</div><p>Then $120 per month.</p>',
);
const ABOUT = html('About', '<h2>Company</h2><p>Founded in 2006 in Wellington, New Zealand.</p>');

const sources = [
  { id: 'pricing', url: PRICING_URL, region: 'AU', currency: 'AUD' },
  { id: 'about', url: ABOUT_URL, region: 'Global' },
];

let harness: Harness;
afterEach(() => harness?.cleanup());

function newHarness(model = fakeModel({ status: 'answered', answer: 'ok', claims: [] })) {
  harness = createHarness({ sources, pages: { [PRICING_URL]: PRICING_V1, [ABOUT_URL]: ABOUT }, model });
  return harness;
}

describe('reuse of gathered research', () => {
  it('fetches each source once and reuses it on the next gather', async () => {
    const h = newHarness();

    const first = await h.service.gather();
    expect(first.sources.map((s) => s.outcome)).toEqual(['fetched', 'fetched']);
    expect(h.fetchCount()).toBe(2);

    const second = await h.service.gather();
    expect(second.sources.map((s) => s.outcome)).toEqual(['reused', 'reused']);
    expect(h.fetchCount()).toBe(2); // unchanged: no network access at all
  });

  it('never fetches while answering, however many questions are asked', async () => {
    const h = newHarness();
    await h.service.gather();
    const afterGather = h.fetchCount();

    await h.service.ask('What does the Grow plan cost per month?');
    await h.service.ask('What does the Grow plan cost per month?');
    await h.service.ask('Where was the company founded?');

    expect(h.fetchCount()).toBe(afterGather);
    expect(h.modelCount()).toBe(3); // a model call per question is expected; refetching is not
  });

  it('reports reuse in the activity log so a repeated run is visible without reading the code', async () => {
    const h = newHarness();
    await h.service.gather();
    await h.service.gather();

    const types = h.service.activity.tail(100).map((event) => event.type);
    expect(types).toContain('source_fetched');
    expect(types).toContain('source_reused');
  });
});

describe('refresh', () => {
  it('re-fetches but does not reprocess a page whose bytes are unchanged', async () => {
    const h = newHarness();
    await h.service.gather();
    const processedAt = h.service.status().sources.find((s) => s.id === 'pricing')!.processedAt;

    const report = await h.service.refresh();
    expect(report.sources.find((s) => s.sourceId === 'pricing')!.outcome).toBe('unchanged');
    expect(h.fetchCount()).toBe(4); // it did go to the network...
    // ...but the stored passages were not rebuilt.
    expect(h.service.status().sources.find((s) => s.id === 'pricing')!.processedAt).toBe(processedAt);
  });

  it('reprocesses a page whose content changed, and answers then use the new evidence', async () => {
    const h = newHarness();
    await h.service.gather();
    expect(h.service.preview('Grow plan monthly price').results[0]!.chunk.text).toContain('$7.80');

    h.setBody(PRICING_URL, PRICING_V2);
    const report = await h.service.refresh();

    expect(report.sources.find((s) => s.sourceId === 'pricing')!.outcome).toBe('reprocessed');
    expect(h.service.preview('Grow plan monthly price').results[0]!.chunk.text).toContain('$9.00');
  });

  it('rebuilds unchanged pages when a rebuild is explicitly requested', async () => {
    const h = newHarness();
    await h.service.gather();
    const before = h.service.status().sources.find((s) => s.id === 'pricing')!;

    const report = await h.service.refresh({ force: true });

    expect(report.sources.find((s) => s.sourceId === 'pricing')!.outcome).toBe('reprocessed');
    const after = h.service.status().sources.find((s) => s.id === 'pricing')!;
    expect(after.processedAt >= before.processedAt).toBe(true);
    // The page itself did not change, so the "content changed" timestamp must not move.
    expect(after.contentChangedAt).toBe(before.contentChangedAt);
  });

  it('drops evidence for a source that has been removed from configuration', async () => {
    const h = newHarness();
    await h.service.gather();
    expect(h.service.status().storedSources).toBe(2);

    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(h.dataDir, 'sources.json'), JSON.stringify({ sources: [sources[0]] }), 'utf8');

    const report = await h.service.gather();
    expect(report.sources.find((s) => s.sourceId === 'about')!.outcome).toBe('removed');
    expect(h.service.passagesForSource('about')).toHaveLength(0);
  });
});

describe('failure handling', () => {
  it('keeps earlier evidence after a failed refresh and does not present it as fresh', async () => {
    const h = newHarness();
    await h.service.gather();
    const original = h.service.status().sources.find((s) => s.id === 'pricing')!;

    h.setFailure(PRICING_URL, new FetchFailure('http_error', 'Server returned 503', 503));
    const report = await h.service.refresh();

    const outcome = report.sources.find((s) => s.sourceId === 'pricing')!;
    expect(report.ok).toBe(false);
    expect(outcome.outcome).toBe('failed');
    expect(outcome.error?.kind).toBe('http_error');
    expect(outcome.servingEvidenceFrom).toBe(original.fetchedAt);

    const after = h.service.status().sources.find((s) => s.id === 'pricing')!;
    expect(after.fetchedAt).toBe(original.fetchedAt); // retrieval time is not moved forward
    expect(after.chunkCount).toBe(original.chunkCount); // stored research is intact
    expect(after.lastError?.kind).toBe('http_error');
  });

  it('marks answers that rely on a source whose last refresh failed', async () => {
    const h = newHarness(
      fakeModel({
        status: 'answered',
        answer: 'The Grow plan is $7.80 per month (E1).',
        claims: [{ text: 'The Grow plan is $7.80 per month.', evidence: ['E1'] }],
      }),
    );
    await h.service.gather();
    h.setFailure(PRICING_URL, new FetchFailure('timeout', 'Request timed out'));
    await h.service.refresh();

    const answer = await h.service.ask('What does the Grow plan cost per month?');
    expect(answer.warnings.join(' ')).toMatch(/refresh attempt failed/i);
    expect(answer.citations.some((citation) => citation.staleWarning)).toBe(true);
  });

  it('records a source that has never been fetched without inventing a record for it', async () => {
    const h = newHarness();
    h.setFailure(PRICING_URL, new FetchFailure('robots_disallowed', 'robots.txt disallows this path'));

    const report = await h.service.gather();
    const outcome = report.sources.find((s) => s.sourceId === 'pricing')!;

    expect(outcome.outcome).toBe('failed');
    expect(outcome.servingEvidenceFrom).toBeUndefined();
    expect(h.service.status().pending.map((p) => p.sourceId)).toContain('pricing');
  });
});
