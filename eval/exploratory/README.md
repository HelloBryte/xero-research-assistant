# Exploratory testing

`eval/cases.json` is the required four-case evaluation. This directory is the wider sweep that
found the defects: questions a reviewer or a real user would actually type, including the ones they
type by accident.

Everything here runs through `ResearchService.ask` — the same path the web app uses. No answer is
hard-coded, no model grades another model, and every check is a mechanical assertion about the
application's behaviour.

## What is here

| File | Purpose |
| --- | --- |
| [`questions.json`](questions.json) | The question bank: 30 cases in 10 categories, each with what it probes and its checks. |
| [`run-exploratory.ts`](run-exploratory.ts) | Runs the bank and archives a JSON and Markdown report. |
| [`ground-truth.json`](ground-truth.json) | Facts quoted by answers, with the pattern that proves them. |
| [`verify-ground-truth.ts`](verify-ground-truth.ts) | Fetches the live pages and checks those facts independently. |
| [`FINDINGS.md`](FINDINGS.md) | Every defect found, its root cause, its fix and its regression test. |
| `results/` | Archived runs, in the order they were produced. |

```bash
npm run explore            # the sweep, against the live model
npm run explore -- --offline
npm run verify:sources     # independent fact check against the live pages
```

## Categories

| Category | What it probes |
| --- | --- |
| pricing | The figures the evidence is most specific about, and where a model is most tempted to invent. |
| product | Capability questions phrased the way a small business owner asks them. |
| company | Background, history and business model. |
| multi-source | Answers that need evidence from more than one stored source. |
| insufficient | Questions the stored research genuinely cannot answer. |
| region | Questions where region or currency is ambiguous or spans regions. |
| freshness | Answers that depend on when the evidence was retrieved. |
| reuse | Repeated questions, showing research is reused rather than refetched. |
| adversarial | Attempts to override the application through the question box. |
| malformed | Empty, whitespace, emoji, another language, markup, a pasted wall of text. |

## Two layers of verification

The claim checker in `src/verify.ts` proves an answer matches the **stored passage**. That cannot
prove the stored passage matches the **page**. `verify-ground-truth.ts` closes the loop from the
other side: it fetches each URL itself and strips tags with its own crude routine rather than
`src/extract.ts`, so a bug in the extractor cannot make a wrong fact look right. It reports four
verdicts — `confirmed`, `stored-only` (the page changed since retrieval), `live-only` (extraction
dropped it) and `missing`.

## Archived runs

Kept in sequence, so the effect of each fix is visible rather than asserted.

| Run | Result | What it shows |
| --- | --- | --- |
| `01-first-sweep-25of30` | 25/30 | The first sweep. Five failures across pricing, multi-source, adversarial and malformed input. |
| `02-after-terms-and-log-fixes-28of30` | 28/30 | After the unsearchable-question and activity-log fixes. |
| `03-after-idf-and-us-fixes-29of30` | 29/30 | After separating body and metadata document frequency, and the `us` pronoun collision. |
| `04-after-price-facet-29of30` | 29/30 | After adding the price facet; a different case now exposed the facet being too broad. |
| `05-after-citation-prompt-29of30` | 29/30 | After requiring a claim to cite every passage it draws on. |
| `06-final-all-pass-30of30` | 30/30 | All categories pass. |
| `ground-truth-01-…-15of19` | 15/19 | Four facts unverified: the checker could not reach Wikipedia, which exposed a shared-configuration defect. |
| `ground-truth-02-…-18of19` | 18/19 | After extracting the connection setting into `src/net.ts`. |
| `ground-truth-03-final-19of19` | 19/19 | Every quoted fact confirmed on the live page and in the stored research. |

A run that passes everything proves less than the sequence does. The first sweep is kept precisely
because it failed.
