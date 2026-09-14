import express, { type NextFunction, type Request, type Response } from 'express';
import { join } from 'node:path';
import { config, projectRoot, redact } from './config.js';
import { ModelFailure } from './llm.js';
import { ResearchService } from './service.js';

const service = new ResearchService();
const app = express();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(join(projectRoot, 'public')));

/** Research runs touch the network and the store; one at a time keeps both honest. */
let researchInFlight: Promise<unknown> | null = null;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((item): item is string => typeof item === 'string');
  return ids.length ? ids : undefined;
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

app.get('/api/status', wrap((_req, res) => {
  res.json({ ...service.status(), researchInProgress: researchInFlight !== null });
}));

for (const mode of ['gather', 'refresh'] as const) {
  app.post(
    `/api/${mode}`,
    wrap(async (req, res) => {
      if (researchInFlight) {
        res.status(409).json({ error: { kind: 'busy', message: 'A research run is already in progress.' } });
        return;
      }
      const only = asStringArray(req.body?.only);
      const force = req.body?.force === true;
      const task =
        mode === 'gather' ? service.gather({ only }) : service.refresh({ only, force });
      researchInFlight = task;
      try {
        const report = await task;
        // A run that reports failures still succeeded as a request: the report
        // is the answer, and it distinguishes what was refreshed from what was
        // left at its earlier retrieval time.
        res.json(report);
      } finally {
        researchInFlight = null;
      }
    }),
  );
}

app.post(
  '/api/ask',
  wrap(async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      res.status(400).json({ error: { kind: 'bad_request', message: 'A "question" string is required.' } });
      return;
    }
    const topK = typeof req.body?.topK === 'number' ? req.body.topK : undefined;
    try {
      res.json(await service.ask(question, { topK }));
    } catch (error) {
      if (error instanceof ModelFailure) {
        // No answer is returned at all, so a failure cannot be mistaken for one.
        res.status(502).json({
          error: {
            kind: error.kind,
            message: error.message,
            detail: 'No answer was generated. The stored research is unchanged.',
          },
        });
        return;
      }
      throw error;
    }
  }),
);

app.get('/api/preview', wrap((req, res) => {
  const question = typeof req.query.q === 'string' ? req.query.q : '';
  if (!question) {
    res.status(400).json({ error: { kind: 'bad_request', message: 'Query parameter "q" is required.' } });
    return;
  }
  const result = service.preview(question);
  res.json({
    ...result,
    results: result.results.map((item) => ({
      chunkId: item.chunk.id,
      sourceId: item.chunk.sourceId,
      heading: item.chunk.heading,
      score: item.score,
      text: item.chunk.text,
    })),
  });
}));

app.get('/api/sources', wrap((_req, res) => {
  res.json({ configured: service.sources, stored: service.status().sources });
}));

app.get('/api/sources/:id/passages', wrap((req, res) => {
  const id = String(req.params.id ?? '');
  res.json({ sourceId: id, passages: service.passagesForSource(id) });
}));

// Passage ids contain '#', so they travel as a query parameter rather than a path segment.
app.get('/api/passage', wrap((req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const found = id ? service.trace(id) : null;
  if (!found) {
    res.status(404).json({ error: { kind: 'not_found', message: `No stored passage with id "${id}".` } });
    return;
  }
  res.json(found);
}));

app.get('/api/activity', wrap((req, res) => {
  const limit = Number(req.query.limit ?? 60);
  res.json({ events: service.activity.tail(Number.isFinite(limit) ? limit : 60) });
}));

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  const message = redact(error.message || 'Unexpected error');
  process.stderr.write(`[server] ${message}\n`);
  res.status(500).json({ error: { kind: 'server_error', message } });
});

app.listen(config.port, () => {
  process.stdout.write(
    `Xero research assistant on http://localhost:${config.port}\n` +
      `  store: ${service.status().storePath}\n` +
      `  model: ${config.llm.model} (${service.status().modelConfigured ? 'configured' : 'NO credentials'})\n`,
  );
});
