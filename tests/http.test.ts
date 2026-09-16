/**
 * The HTTP API as a reviewer's browser or curl reaches it: a real listening
 * server around a service with a fake fetcher and a fake model.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ModelFailure } from '../src/llm.js';
import { createHarness, fakeModel, html, type Harness } from './helpers.js';

const PRICING_URL = 'https://example.test/pricing';

let harness: Harness;
let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = null;
  harness?.cleanup();
});

async function start(model = fakeModel({
  status: 'answered',
  answer: 'The Grow plan is $7.80 per month (E1).',
  claims: [{ text: 'The Grow plan is $7.80 per month.', evidence: ['E1'] }],
})) {
  harness = createHarness({
    sources: [{ id: 'pricing', url: PRICING_URL, region: 'AU', currency: 'AUD' }],
    pages: { [PRICING_URL]: html('Pricing', '<h2>Grow</h2><div>$7.80 per month</div><p>Then $78 per month.</p>') },
    model,
  });
  await harness.service.gather();
  server = await new Promise<Server>((resolve) => {
    const listening = createApp(harness.service).listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    get: (path: string) => fetch(`${base}${path}`),
    post: (path: string, body: string) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
  };
}

describe('request validation', () => {
  it('answers malformed JSON with 400, not a server error', async () => {
    const api = await start();
    const response = await api.post('/api/ask', '{"question": "grow plan');
    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe('invalid_json');
  });

  it('answers an oversized body with 413, not a server error', async () => {
    const api = await start();
    const response = await api.post('/api/ask', JSON.stringify({ question: 'x'.repeat(50_000) }));
    expect(response.status).toBe(413);
    expect((await response.json()).error.kind).toBe('payload_too_large');
  });

  it('rejects a missing or non-string question', async () => {
    const api = await start();
    expect((await api.post('/api/ask', '{}')).status).toBe(400);
    expect((await api.post('/api/ask', '{"question": ["a", "b"]}')).status).toBe(400);
    expect((await api.post('/api/ask', '{"question": "   "}')).status).toBe(400);
  });

  it('returns 404 for an unknown passage or source', async () => {
    const api = await start();
    expect((await api.get('/api/passage?id=nope')).status).toBe(404);
    expect((await api.get('/api/sources/nope/passages')).status).toBe(404);
    expect((await api.get('/api/sources/pricing/passages')).status).toBe(200);
  });
});

describe('answering over HTTP', () => {
  it('still retrieves evidence when the client sends a top-k of zero', async () => {
    const api = await start();
    const body = await (await api.post('/api/ask', JSON.stringify({ question: 'Grow plan price', topK: 0 }))).json();
    expect(body.retrieval.selected.length).toBeGreaterThan(0);
    expect(body.answer).not.toMatch(/contains no passage related/i);
  });

  it('reports a model failure as 502 with no answer and no credentials', async () => {
    const api = await start(
      fakeModel(null, { fail: new ModelFailure('http_error', 'Auth failed for sk-abcdef0123456789', 401) }),
    );
    const response = await api.post('/api/ask', JSON.stringify({ question: 'Grow plan price' }));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).not.toHaveProperty('answer');
    expect(text).not.toContain('sk-abcdef0123456789');
  });

  it('reports a model reply with no answer text as a failure, not an empty result', async () => {
    const api = await start(fakeModel({ status: 'answered', answer: '', claims: [] }));
    const response = await api.post('/api/ask', JSON.stringify({ question: 'Grow plan price' }));
    expect(response.status).toBe(502);
    expect((await response.json()).error.kind).toBe('invalid_response');
  });

  it('never fetches a source to answer', async () => {
    const api = await start();
    const before = harness.fetchCount();
    await api.post('/api/ask', JSON.stringify({ question: 'Grow plan price' }));
    await api.post('/api/ask', JSON.stringify({ question: 'Grow plan price' }));
    expect(harness.fetchCount()).toBe(before);
  });

  it('pages the activity log without dumping it for a limit of zero', async () => {
    const api = await start();
    expect((await (await api.get('/api/activity?limit=0')).json()).events).toHaveLength(0);
    expect((await (await api.get('/api/activity?limit=2')).json()).events).toHaveLength(2);
  });
});
