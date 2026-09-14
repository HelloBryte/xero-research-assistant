import { describe, expect, it } from 'vitest';
import { buildChunks } from '../src/chunk.js';
import { extractPage } from '../src/extract.js';
import { isAllowed, parseRobots } from '../src/robots.js';
import { RetrievalIndex, tokenize } from '../src/retrieve.js';
import { checkClaim, extractFigures, stripEvidenceLabels } from '../src/verify.js';
import type { Chunk } from '../src/types.js';

describe('extraction', () => {
  it('keeps page content and drops site chrome', () => {
    const page = extractPage(
      `<html><head><title>Pricing | Example</title></head><body>
         <nav><a href="/x">Home</a><a href="/y">Features</a></nav>
         <main><h2>Grow</h2><p>Then $78 per month.</p></main>
         <footer>Copyright notice</footer>
       </body></html>`,
      'fallback',
    );

    expect(page.title).toBe('Pricing | Example');
    const texts = page.blocks.map((block) => block.text);
    expect(texts).toContain('Then $78 per month.');
    expect(texts.join(' ')).not.toMatch(/Copyright notice|Features/);
  });

  it('recovers a value rendered as spans inside a bare div', () => {
    const page = extractPage(
      '<main><div class="price"><span>$</span><span>14</span><span>.30</span><b> per month</b></div></main>',
      'fallback',
    );
    expect(page.blocks.map((block) => block.text)).toContain('$14.30 per month');
  });

  it('promotes an icon label so a comparison table keeps its meaning', () => {
    const page = extractPage(
      '<main><li><svg><title>Included</title></svg><span>Multiple currencies</span></li></main>',
      'fallback',
    );
    expect(page.blocks.map((block) => block.text)).toContain('Included Multiple currencies');
  });

  it('skips citation and link-list sections', () => {
    const page = extractPage(
      `<main><h2>History</h2><p>Founded in 2006.</p>
         <h2>References</h2><p>Smith, J. (2019). Something irrelevant.</p>
         <h2>External links</h2><p>Official website</p></main>`,
      'fallback',
    );
    const texts = page.blocks.map((block) => block.text).join(' ');
    expect(texts).toContain('Founded in 2006.');
    expect(texts).not.toMatch(/Smith, J|Official website/);
  });

  it('does not repeat text that a container and its children both hold', () => {
    const page = extractPage('<main><ul><li><span>One</span></li><li><span>Two</span></li></ul></main>', 'fallback');
    expect(page.blocks.map((block) => block.text)).toEqual(['One', 'Two']);
  });
});

describe('chunking', () => {
  it('starts a new passage at every heading so values stay with their heading', () => {
    const chunks = buildChunks('src', [
      { kind: 'heading', text: 'Grow' },
      { kind: 'text', text: '$7.80 per month' },
      { kind: 'heading', text: 'Comprehensive' },
      { kind: 'text', text: '$10.70 per month' },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: 'Grow', id: 'src#0' });
    expect(chunks[0]!.text).toContain('$7.80');
    expect(chunks[1]).toMatchObject({ heading: 'Comprehensive' });
    expect(chunks[1]!.text).not.toContain('$7.80');
  });

  it('splits an oversized block on sentence boundaries instead of dropping it', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about pricing.`).join(' ');
    const chunks = buildChunks('src', [{ kind: 'text', text: long }], { targetChars: 200, maxChars: 300 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 330)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toContain('Sentence number 39');
  });
});

describe('robots.txt', () => {
  const robots = `User-agent: *
Disallow: /private/
Disallow: /downloads/*
Allow: /private/public-page
Crawl-delay: 2

User-agent: EvilBot
Disallow: /`;

  it('applies the wildcard group to an unlisted agent', () => {
    const policy = parseRobots(robots, 'XeroResearchAssistant/1.0');
    expect(isAllowed(policy, '/pricing')).toBe(true);
    expect(isAllowed(policy, '/private/secret')).toBe(false);
    expect(isAllowed(policy, '/downloads/file.zip')).toBe(false);
    expect(policy.crawlDelayMs).toBe(2000);
  });

  it('prefers the longest matching rule, so a specific Allow wins', () => {
    const policy = parseRobots(robots, 'XeroResearchAssistant/1.0');
    expect(isAllowed(policy, '/private/public-page')).toBe(true);
  });

  it('uses the agent-specific group when one matches', () => {
    const policy = parseRobots(robots, 'EvilBot/2.0');
    expect(isAllowed(policy, '/pricing')).toBe(false);
  });

  it('honours an end-of-path anchor', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /*.pdf$', 'any');
    expect(isAllowed(policy, '/docs/report.pdf')).toBe(false);
    expect(isAllowed(policy, '/docs/report.pdf.html')).toBe(true);
  });
});

describe('retrieval', () => {
  const chunk = (id: string, sourceId: string, text: string, heading: string | null = null): Chunk => ({
    id,
    sourceId,
    index: Number(id.split('#')[1]),
    heading,
    text,
  });

  const corpus = [
    chunk('au#0', 'au', '$7.80 per month then $78 per month. Prices are in AUD and include GST.', 'Grow'),
    chunk('au#1', 'au', 'Payroll for two people and a 60 day cashflow forecast.', 'Grow'),
    chunk('au#2', 'au', 'Send invoices and quotes, reconcile bank transactions.', 'Grow'),
    chunk('au#3', 'au', 'Claim expenses and mileage for one user.', 'Grow'),
    chunk('about#0', 'about', 'The company was founded in 2006 in Wellington, New Zealand.', 'History'),
    chunk('about#1', 'about', 'It serves 5 million customers in 180 countries.', 'Scale'),
  ];

  it('selects a relevant subset rather than everything stored', () => {
    const result = new RetrievalIndex(corpus).search('What does the Grow plan cost per month?', { topK: 3 });

    expect(result.results).toHaveLength(3);
    expect(result.consideredChunks).toBe(6);
    expect(result.results[0]!.chunk.id).toBe('au#0');
    expect(result.quality).toBe('strong');
  });

  it('caps passages per source so a second source can still be reached', () => {
    const result = new RetrievalIndex(corpus).search('company founded month plan', {
      topK: 4,
      maxPerSource: 2,
    });
    const sourceIds = new Set(result.results.map((item) => item.chunk.sourceId));
    expect(sourceIds.size).toBe(2);
  });

  it('returns nothing when no stored passage shares a term with the question', () => {
    const result = new RetrievalIndex(corpus).search('quantum chromodynamics lattice');
    expect(result.results).toHaveLength(0);
    expect(result.quality).toBe('none');
  });

  it('normalises plurals and keeps figures as searchable terms', () => {
    expect(tokenize('Invoices cost $78.50 per month')).toEqual(['invoice', 'cost', '78.50', 'per', 'month']);
  });
});

describe('claim verification', () => {
  const passage: Chunk = {
    id: 'au#0',
    sourceId: 'au',
    index: 0,
    heading: 'Grow',
    text: '$7.80 per month\nThen $78 per month. Prices are in AUD and include GST.',
  };

  it('accepts a claim whose figures and wording come from the passage', () => {
    const check = checkClaim('The Grow plan is $7.80 per month, then $78 per month.', [passage]);
    expect(check.verdict).toBe('supported');
    expect(check.missingFigures).toHaveLength(0);
  });

  it('rejects a claim that quotes a figure the passage does not contain', () => {
    const check = checkClaim('The Grow plan is $99 per month.', [passage]);
    expect(check.verdict).toBe('unsupported');
    expect(check.missingFigures).toEqual(['99']);
  });

  it('flags a claim attached to an unrelated passage', () => {
    const check = checkClaim('The company employs staff across nineteen regional offices.', [passage]);
    expect(check.verdict).toBe('unsupported');
  });

  it('ignores inline evidence labels when comparing figures', () => {
    const check = checkClaim('The Grow plan is $7.80 per month, then $78 per month (E1).', [passage]);
    expect(check.verdict).toBe('supported');
    expect(check.missingFigures).toHaveLength(0);
  });

  it('reports a claim with no citation at all', () => {
    expect(checkClaim('Anything at all.', []).verdict).toBe('uncited');
  });

  it('strips citation markers without touching the rest of the sentence', () => {
    expect(stripEvidenceLabels('It costs $78 (E1, E3) per month.')).toBe('It costs $78 per month.');
  });

  it('compares figures by value, not by spelling', () => {
    expect(extractFigures('$14.30 and 1,000 and 90%')).toEqual(['14.3', '1000', '90']);
    expect(checkClaim('It costs 78 dollars monthly.', [passage]).missingFigures).toHaveLength(0);
  });
});
