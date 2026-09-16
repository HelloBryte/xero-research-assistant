# Xero research assistant

Gathers public pages about Xero, stores the extracted evidence locally, and answers questions from
that evidence with a real model. Every substantive claim is checked against the passage it cites
before it is shown, and the application reports what it fetched, what it reused, and when it called
a model.

## Setup

Node.js 20.6 or newer.

```bash
npm install
cp .env.example .env     # then put a real key in LLM_API_KEY
```

```
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your-api-key-here
LLM_MODEL=deepseek-flash
```

**Working real-model configuration.** The recorded run used DeepSeek's OpenAI-compatible endpoint
(`https://api.deepseek.com`, model `deepseek-flash`): a DeepSeek account and an API key with a small
credit balance, nothing downloaded, no hardware requirement. `LLM_BASE_URL` accepts any
OpenAI-compatible `/chat/completions` server, so a local runtime works unchanged — Ollama
(`http://localhost:11434/v1`) with any instruction-tuned model that honours JSON output needs about
8 GB of RAM and no account. Runtime model access is separate from the assistant used to write the code.

## Usage

```bash
npm run gather           # fetch configured sources; anything already stored is reused, not refetched
npm run serve            # web app on http://localhost:3000
npm run ask "How much does the Xero Grow plan cost per month in Australia?"
npm run refresh          # re-fetch every source; unchanged pages are not reprocessed
npm run cli -- refresh --force              # re-fetch and rebuild passages even if a page is unchanged
npm run cli -- refresh --only wikipedia-xero
npm run status           # what is stored, when it was retrieved, whether a model is configured
npm run cli preview "..."                # which passages a question retrieves, no model call
npm run cli trace xero-pricing-au#3      # the full stored passage behind a citation
npm run cli -- log --tail 40                # fetched / reused / reprocessed / model calls
npm test                                 # no credentials, no network
npm run eval                             # live model, writes eval/results/
npm run eval -- --offline                # scripted model over fixtures, no credentials
npm run explore                          # 30-case exploratory sweep, writes eval/exploratory/results/
npm run verify:sources                   # fact-check the answers against the live pages
```

To add or replace a source, edit `config/sources.json`, then `npm run gather` (new sources only) or
`npm run refresh`. A source deleted from that file has its evidence pruned on the next run.

`npm test` and `npm run eval -- --offline` are offline and credential-free. `gather`, `refresh` and
`ask` are live; `ask` needs credentials but never fetches a source.

## System design

```
config/sources.json ─► research.ts ─► http.ts (robots, rate limit, timeout, retries)
                                   └► extract.ts ─► chunk.ts ─► store.ts ──► data/store.json
                                                                                  │
question ─► retrieve.ts (BM25 over stored passages) ─► prompt.ts ─► llm.ts ─► model
                                                                                  │
                      verify.ts (claim ↔ cited passage) ◄── answer.ts ◄───────────┘
                                  └► answer + citations + verdicts ─► app.ts (HTTP) / cli.ts
```

`ResearchService` (`src/service.ts`) sits behind both the web app and the CLI.

**Persisted.** `data/store.json` holds each source's title, URL, region, retrieval time, content hash
and last error, plus its extracted passages; writes go to a temp file and are renamed, so a crash
cannot corrupt it. `data/activity.jsonl` records every fetch, reuse, reprocess, failure and model call.

**Evidence to the model.** `retrieve.ts` selects the top six passages, at most three per source.
`prompt.ts` sends only those, each inside a `<passage>` element carrying title, URL, retrieval time,
region and currency, with characters that could forge the delimiter stripped.

**Application code, not the model, decides** which sources exist, when to fetch, reuse or reprocess
(`research.ts`), which passages are retrieved (`retrieve.ts`), whether a cited passage supports its
claim (`verify.ts`), and the final status, which verification can lower but never raise
(`resolveStatus` in `answer.ts`). The model drafts prose, splits it into claims and attaches labels.

### Decision 1 — BM25, not embeddings

**Chose** in-process BM25; **alternative:** embeddings in a vector store. These questions turn on
rare tokens — plan names, `$78`, `GST` — which IDF weights heavily, and BM25 adds no service to keep
in sync, no per-refresh embedding cost and no credentials for the offline tests. Source title and
region are scored as a separate, weaker field: a plan card reads "$7.80 per month" and never names
Australia, so without it Australian prices were unreachable (F-01). **Measured:** 58 passages,
sub-millisecond search, the right passage first in all four evaluation cases. Also measured, as a
limitation: "Who runs Xero?" misses the passages naming the CEO, because `runs` matches "pay runs"
(K-01). **Would reconsider** once paraphrased questions matter more than exact ones, or past ~10⁴
passages; retrieval sits behind one `search` call.

### Decision 2 — verify citations in application code

**Chose** a deterministic check: every figure in a claim must appear in its cited passages, and its
wording must overlap them; a failing claim is shown as such and downgrades the answer. **Alternative:**
trust citations, or use a model as judge. Fabricated figures are what a fluent model produces, and a
numeric check costs nothing and cannot hallucinate. **Measured:** it caught a live claim quoting
`$2.50` while citing only a passage that does not contain it (F-11). Also measured: it is lexical, not
entailment — a claim that prices *exclude* GST, cited to a passage saying they *include* it, is only
marked `weak`, which does not fail the answer.
**Would reconsider** if answers must aggregate or paraphrase heavily; entailment checking is next.

## Tests and evaluation

`npm test` — 76 vitest tests, no credentials or network. Reuse (a second gather makes zero fetches;
asking never fetches), refresh semantics, failure safety (a failed refresh keeps earlier evidence and
its retrieval time, and marks it), model failures (timeout, unparseable or empty reply produce no
answer), citation and claim verification, key redaction, prompt-delimiter forgery, and the HTTP API
against a real listening server (`tests/http.test.ts`). `tests/regressions.test.ts` holds one test per
defect found, named after the defect. External services are mocked; the behaviour under test is not.

`npm run eval` runs four cases — supported, multi-source, insufficient-evidence, repeated — through
the same `ask` path as an ordinary question and writes JSON and Markdown to `eval/results/`. Each
file states at the top whether its model outputs are real or mocked.

`npm run explore` is the wider sweep that found most defects: 30 questions across pricing, product,
company, multi-source, insufficient, region, freshness, reuse, adversarial and malformed input. A
further 20 **held-out** questions, written after the fixes and never tuned against, passed their
checks 20/20; reading the answers found one verification hole (since fixed) and two retrieval misses
that are documented rather than tuned away (K-01, K-02). `npm run verify:sources` fetches the live
pages and confirms, independently of `src/extract.ts`, that the figures answers quoted are really
there: 19/19. Details in [`eval/exploratory/`](eval/exploratory/README.md).

- [`live-model-2026-09-16T14-26-02-833Z.md`](eval/results/live-model-2026-09-16T14-26-02-833Z.md) —
  **real model output.** `deepseek-flash`, temperature 0, run 2026-09-16; sources retrieved
  2026-09-14. 4/4 cases passed every check.
- [`offline-mock-2026-09-16T14-26-02-380Z.md`](eval/results/offline-mock-2026-09-16T14-26-02-380Z.md)
  — **mocked model output** over synthetic fixtures, plus a demonstration that a failed refresh
  leaves stored evidence and its retrieval time untouched.

Limitations observed: the repeated case proves reuse by passage identity and retrieval time, not by
answer text — wording still varies slightly at temperature 0. The insufficient case passes because
the model declines; a differently worded question could still draw an over-confident answer, which
verification would then mark rather than prevent.

## AI usage

Claude Code (Opus 5) wrote the implementation, tests and documentation. Runtime answers come from
DeepSeek, which is separate from the development assistant.

My part was deciding what had to be proven and when a result was not good enough: a real-model run
of the full reviewer path rather than unit tests alone; then a sweep of realistic and malformed user
questions with every run archived; then a check of quoted figures against the live pages; then a
held-out set of questions written after the fixes, to measure whether they generalised rather than
fitted.

The clearest suggestion that did not survive verification: to make Australian prices reachable
(F-01), Claude Code indexed each source's title and region alongside its passages, and every test
passed. The next exploratory sweep showed the change had also counted that metadata in document
frequency, so "customers" in a source description made the passage that actually says "5 million
customers" rank ninth (F-08). It was corrected with separate body and metadata frequency tables,
locked in by a regression test, and confirmed by re-running the sweep. The full record of defects,
causes and fixes is in [`FINDINGS.md`](eval/exploratory/FINDINGS.md).

## Limitations and cost

**Services.** One OpenAI-compatible chat endpoint (DeepSeek pay-as-you-go here; a local server works
instead). Pages are fetched anonymously, honouring `robots.txt`, one request per host per second, a
20 s timeout and a 5 MB cap.

**Reuse.** After a successful fetch nothing is refetched until an explicit refresh, and a refresh
returning identical bytes skips reprocessing. Answering never fetches.

**Cost.** One model call per question. Measured: 1.8–2.5k prompt and 0.8–1.8k completion tokens,
4–8 s. `deepseek-flash` is a reasoning model, and hidden reasoning (up to ~1.5k tokens) is the largest
and least predictable cost, hence `LLM_MAX_TOKENS=8000`. At volume the levers are `RETRIEVAL_TOP_K`
and a non-reasoning model; answers are not cached.

**Known weaknesses.** Retrieval misses paraphrases (K-01, K-02). Verification is lexical, not
entailment. Extraction is heuristic and keeps some page furniture. The store is one in-memory JSON
file, fine to a few thousand passages. No cross-process locking and no authentication: local use only.

**Security.** Retrieved text is delimited as data and cannot override instructions; credentials live
only in the git-ignored `.env` and every log and error passes through `redact()`; `data/` is
git-ignored, so no bulk page content is committed.
