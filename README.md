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
                                  └► answer + citations + verdicts ─► server.ts / cli.ts
```

`ResearchService` (`src/service.ts`) is the single entry point behind both the web app and the CLI.

**Persisted** in `data/store.json`: per source, the title, configured and final URL, region/currency
labels, retrieval time, content hash, processing time and last error, plus every extracted passage
with its heading. `data/activity.jsonl` appends fetches, reuse, reprocessing, failures and model
calls. Store writes go to a temp file and are renamed, so an interrupted write cannot corrupt it.

**Evidence reaching the model:** `retrieve.ts` scores stored passages against the question and
returns the top six, capped at three per source. `prompt.ts` renders only those, inside `<passage>`
elements carrying source title, URL, retrieval time, region and currency, with `<`, `>` and `"`
stripped from the content so retrieved text cannot forge a delimiter.

**Decided by application code, not the model:** which sources exist; when to fetch, reuse or
reprocess (`research.ts`); which passages are retrieved (`retrieve.ts`); whether a cited passage
supports its claim (`verify.ts`); and the final status, which verification can lower but never raise
(`resolveStatus` in `src/answer.ts`). The model only drafts prose, splits it into claims, and
attaches labels.

### Decision 1 — BM25 over stored passages, not embeddings

**Chose** in-process lexical BM25 (`src/retrieve.ts`); the alternative was embeddings in a vector
store. These questions turn on rare tokens — plan names, `$78`, `GST`, `AUD` — which IDF weights
heavily for free, and BM25 adds no second service to keep in sync, no per-refresh embedding cost and
no credentials for the offline path. Measured: 58 passages, search well under a millisecond, and the
right passage ranked first in all four evaluation cases.

Scoring is fielded. The passage text and heading are scored with BM25; the source's title, label,
region, currency and topic are scored as a second, weaker field at a flat `CONTEXT_WEIGHT × idf`.
That field is not decoration — a priced plan card reads "$7.80 per month" and never names Xero,
pricing or Australia, so without it a question asking for Australian pricing could not retrieve the
Australian price at all. Folding the metadata into the passage's own term counts was tried first and
was worse: a dozen metadata tokens dominate an eight-token passage and pushed short, low-value
passages to the top.

**Assumption, not measurement:** that recall holds for questions beyond those tested. **Would
reconsider** if questions paraphrase rather than quote ("what does it cost for a sole trader?"
matches nothing lexically), or past ~10⁴ passages. Retrieval sits behind one `search` call, so
swapping it does not touch the answer path.

### Decision 2 — verify the model's citations in application code

**Chose** a deterministic check (`src/verify.ts`): every figure in a claim must appear in the cited
passage or its metadata, and the claim's content words must overlap it. Verdicts (`supported`,
`weak`, `unsupported`, `uncited`) are shown, and an unclean result downgrades the answer to
`partial`. The alternatives were trusting the citation or using a model as judge. Plausible-but-wrong
citations are the failure mode that matters here, fabricated figures are what a fluent model
produces, and a numeric check costs nothing and cannot itself hallucinate. **Measured:** it caught
two real defects during development — a claim restating a retrieval date absent from the passage
text, and inline `(E1)` markers being read as figures; both are fixed and covered by tests.
**Would reconsider** for answers that legitimately paraphrase or aggregate, where word overlap is the
wrong signal; entailment checking is the next step. The check is shallow by design: it cannot detect
a claim that reverses the meaning of the evidence it cites, and it necessarily misreads a claim
*about* the evidence ("that passage does not specify the introductory period"), which has low
overlap by construction. Rather than loosen the check, the prompt now requires claims to be
statements about Xero and sends anything the evidence does not establish to `unknowns`; a
meta-statement that slips through is flagged rather than silently accepted.

## Tests and evaluation

`npm test` — 44 vitest tests, no credentials or network. Reuse (a second gather makes zero fetches;
asking never fetches), refresh semantics (unchanged / reprocessed / forced rebuild), failure safety
(a failed refresh keeps earlier evidence, keeps its retrieval time, and marks it), model failures
(timeout and unparseable reply produce no answer), citation validation, claim verification, API-key
redaction, and that retrieved content cannot forge a prompt delimiter. External services are mocked;
the behaviour under test is not.

`npm run eval` runs four cases — supported, multi-source, insufficient-evidence, repeated — through
the same `ask` path as an ordinary question and writes JSON and Markdown to `eval/results/`. Each
file states at the top whether its model outputs are real or mocked.

- [`live-model-2026-09-14T08-34-56-831Z.md`](eval/results/live-model-2026-09-14T08-34-56-831Z.md) —
  **real model output.** `deepseek-flash`, temperature 0, run 2026-09-14; sources retrieved
  2026-09-14T08:23Z. 4/4 cases passed every check.
- [`offline-mock-2026-09-14T08-34-56-393Z.md`](eval/results/offline-mock-2026-09-14T08-34-56-393Z.md)
  — **mocked model output** over synthetic fixtures, plus a demonstration that a failed refresh
  leaves stored evidence and its retrieval time untouched.

Limitations observed: the repeated case proves reuse by passage identity and retrieval time, not by
answer text — wording still varies slightly at temperature 0. The insufficient case passes because
the model declines; a differently worded question could still draw an over-confident answer, which
verification would then mark rather than prevent.

## AI usage

Claude Code (Opus 5) wrote most of this implementation from the brief; I reviewed and corrected it as
it went.

The substantive correction: the first extractor took the text of the nearest block-level element,
which silently dropped every headline price on the Xero pricing pages — those are bare `<div>`s of
`<span>`s the selector never matched. The suggested fix, emitting only leaf elements, then lost the
feature lists, whose text sits beside a nested icon `<div>`. What shipped emits an element only when
it contributes text its descendants do not (`src/extract.ts`), and promotes `<svg><title>` labels to
text first so comparison tables keep their "Included" markers. Verified by re-extracting the real
pages and checking prices and feature lists are present, plus the extraction tests.

I also rejected the initial chunking, which let passages run across headings and welded three priced
plans into one passage, so the model could not say which price belonged to which plan. Headings now
always start a passage.

## Limitations and cost

**External services:** one OpenAI-compatible chat endpoint (DeepSeek's pay-as-you-go tier as run
here; a local server works instead). Source pages are fetched anonymously, no API.

**Reuse:** after a successful fetch, nothing is refetched or reprocessed until an explicit refresh,
and a refresh returning identical bytes skips reprocessing. Answering never fetches. The retrieval
index rebuilds only when the corpus changes.

**Cost:** one model call per question, nothing else. Measured over the recorded run: 1.8–2.3k prompt
and 0.8–1.8k completion tokens per question, 4–8 s latency, with prompt caching covering 1.7–2.2k
tokens per call. `deepseek-flash` is a reasoning model, so 200–1,450 completion tokens were hidden
reasoning — the largest and least predictable part of the bill, and why `LLM_MAX_TOKENS` defaults to
8,000. At higher usage the levers are `RETRIEVAL_TOP_K` (prompt size grows linearly with it) and a
cheaper non-reasoning model. Answers are not cached, so asking twice costs twice.

**Known weaknesses:** extraction is heuristic — it keeps some page furniture ("Buy now"), leaves a
stray fragment on one page, and can drop text sitting directly inside a container beside a nested
block; the store is one JSON file held in memory, fine at this size but not beyond a few thousand
passages; retrieval is lexical only and verification is lexical rather than entailment (see the two
decisions above); one gather or refresh runs at a time with no cross-process locking; there is no
authentication, so the server is for local use.

**Public sources and security.** `src/http.ts` honours `robots.txt` for the requesting user agent and
applies a one-second minimum gap per host (or the site's `Crawl-delay`, whichever is longer), a
20-second timeout, a 5 MB cap and bounded retries respecting `Retry-After`. Nothing bypasses a login,
paywall or bot protection; a page that cannot be fetched appropriately is reported and can be
replaced in configuration. Retrieved content is delimited in the prompt and the system prompt states
that instructions inside a passage must be ignored. Credentials live only in `.env` (git-ignored) and
every error and log line passes through `redact()`. `data/` is git-ignored, so no bulk page content
is committed; evaluation records contain only short extracts.
