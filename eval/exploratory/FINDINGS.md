# Findings

Every defect found by testing this application, with how it was found, what actually caused it, what
changed, and the test that stops it coming back.

Severity is about the answer a user would have received: **high** means the application stated
something false or unsupported; **medium** means a correct answer was unreachable or a correct one
was wrongly flagged; **low** means untidy behaviour with no wrong answer.

| # | Severity | Defect | Found by |
| --- | --- | --- | --- |
| [F-01](#f-01) | high | A passage was unreachable by the name of the source it came from | Reviewer-path testing |
| [F-02](#f-02) | medium | Correct claims about the evidence were flagged unsupported | Required evaluation, flaky |
| [F-03](#f-03) | low | `npm install` reported 7 vulnerabilities, one critical | Fresh-clone install |
| [F-04](#f-04) | low | `tail(0)` returned the entire activity log | Edge-case probe |
| [F-05](#f-05) | high | An out-of-range `topK` made the app deny its own evidence | Edge-case probe |
| [F-06](#f-06) | high | An unsearchable question was reported as a gap in the research | Exploratory, `malformed` |
| [F-07](#f-07) | high | The pronoun "us" matched a question about the United States | Exploratory, `pricing` |
| [F-08](#f-08) | high | Source metadata stripped the weight of real content words | Exploratory, `multi-source` |
| [F-09](#f-09) | medium | Price questions could not reach the passages holding prices | Exploratory, `pricing` |
| [F-10](#f-10) | medium | The price signal also matched annual revenue | Exploratory, `region` |
| [F-11](#f-11) | high | A compound claim cited only one of the passages it drew on | Exploratory, `region` |
| [F-12](#f-12) | medium | Verbatim-correct claims failed because they were verbose | Exploratory, `product` |
| [F-13](#f-13) | medium | A connection fix applied to one entry point only | Ground-truth check |
| [F-14](#f-14) | high | An empty source list deleted all stored research | Pre-submission debug |
| [F-15](#f-15) | high | A model reply with no answer text was returned as a result | Pre-submission debug |
| [F-16](#f-16) | high | Claims in another script were reported as verified | Held-out manual review |
| [F-17](#f-17) | medium | Source ids that break passage ids and URLs were accepted | Pre-submission debug |
| [F-18](#f-18) | low | Client mistakes were reported as server errors | Pre-submission debug |
| [F-19](#f-19) | low | Temp-file cleanup never matched the files it should remove | Pre-submission debug |
| [K-01](#k-01), [K-02](#k-02) | — | Known recall misses, measured and deliberately not tuned | Held-out evaluation |
| [H-01](#h-01) … [H-04](#h-04) | — | Defects in the test harness itself | Reviewing failures |

---

## F-01
**A passage was unreachable by the name of the source it came from.** *(high)*

**Symptom.** "How does Xero pricing in the United States compare with Australia?" retrieved six
passages, none of them Australian pricing. The model answered with US prices only.

**Cause.** The passages holding Australian prices read `$14.30 per month` under the heading
`Ultimate 10`. The words "Xero", "pricing" and "Australia" appear nowhere in them — only in the
source's title and region metadata, which was not indexed.

**Fix.** `src/retrieve.ts` scores source metadata as a second, weaker field at a flat
`CONTEXT_WEIGHT × idf`. Folding it into the passage's own term counts was tried first and was worse:
a dozen metadata tokens dominate an eight-token passage and pushed short, low-value passages to the
top, so passage length normalisation now covers the passage text only.

**Test.** `tests/units.test.ts` — "finds a passage by its source, not only by words the passage repeats".

## F-02
**Correct claims about the evidence were flagged unsupported.** *(medium)*

**Symptom.** The required evaluation passed or failed run to run. The failing claim was always of the
form "the other passage lists the same figures without specifying the introductory period".

**Cause.** A claim describing what a passage *omits* has low word overlap with that passage by
construction, so the verifier called it unsupported and downgraded a sound answer to `partial`.

**Fix.** Not a looser verifier, which would let fabrications through. `src/prompt.ts` now requires a
claim to be a statement about Xero; anything the evidence does not establish goes to `unknowns`,
which is what that field is for. Four consecutive live evaluations passed afterwards.

## F-03
**`npm install` reported 7 vulnerabilities, one critical.** *(low)*

express 4 → 5 cleared the `qs` advisory, vitest 2 → 4 the critical vitest advisory. `npm audit` now
reports none. Verified rather than assumed: every endpoint re-exercised on express 5, including a
model failure still returning 502 with no answer field.

## F-04
**`tail(0)` returned the entire activity log.** *(low)*

**Cause.** `Array.prototype.slice(-0)` is `slice(0)`. `GET /api/activity?limit=0` — or any negative
limit — dumped every event ever logged instead of none.

**Fix.** `src/activity.ts` floors and clamps the limit, returning nothing for zero, negative or NaN.

**Test.** `tests/regressions.test.ts` — "does not return the whole log when the limit is zero or negative".

## F-05
**An out-of-range `topK` made the application deny its own evidence.** *(high)*

**Symptom.** `topK: 0` in an `/api/ask` body produced zero retrieved passages, and the answer path
then reported *"The stored research contains no passage related to this question"* — a false
statement about the evidence, caused entirely by an input value. `topK: 9999` sent 33 passages to the
model, defeating the retrieval requirement and inflating the bill.

**Fix.** `src/retrieve.ts` clamps `topK` to 1–50 and `maxPerSource` to at least 1, at the one place
every caller passes through.

**Test.** `tests/regressions.test.ts` — three cases under "retrieval input validation".

## F-06
**An unsearchable question was reported as a gap in the research.** *(high)*

**Symptom.** `这个会计软件每个月多少钱？` ("how much does this accounting software cost per month?")
answered *"The stored research contains no passage related to this question. Add a source covering
this topic."* The research covers pricing in detail. The same happened for emoji and for questions
made only of stopwords.

**Cause.** The tokenizer keeps `[a-z0-9$%.]`, so a question in another script produces no terms at
all. Zero terms and zero matches were treated as the same outcome.

**Fix.** `src/answer.ts` separates three reasons — `no_research`, `no_query_terms`, `no_match` — and
says which applies. The no-terms message explains that retrieval is word-based and English-language
and that this says nothing about what the research contains. Still no model call is spent.

**Test.** `tests/regressions.test.ts` — "says the question could not be searched, not that the
research lacks the topic", plus a case proving a genuine coverage gap is still reported as one.

## F-07
**The pronoun "us" matched a question about the United States.** *(high)*

**Symptom.** "What's the cheapest Xero plan in the US?" ranked *"Tell us a little about your
business"* — from the Australian pricing page — above every US pricing passage, and answered
`insufficient`.

**Cause.** Lowercasing collapses the country code `US` into the most common English object pronoun,
which my stopword list had omitted. BM25 will always prefer a body match to a metadata match, so the
pronoun won.

**Fix.** `us` is now a stopword, where a pronoun belongs. Country shorthand is expanded on the raw
query **case-sensitively**, so `US`, `USA`, `UK`, `AU` and `NZ` expand to the words that appear in
page text and metadata, while "tell us" does not. Region codes in source metadata are expanded the
same way.

**Test.** `tests/regressions.test.ts` — "does not let the pronoun \"us\" match a question about the
United States".

## F-08
**Source metadata stripped the weight of real content words.** *(high)*

**Symptom.** "How many customers does Xero say it has?" retrieved a passage headed *"Automate
everyday business admin"* and answered that no customer figure was available. The passage saying
*"Xero serves 5 million customers in 180+ countries"* was ranked ninth.

**Cause.** Introduced by the fix for F-01. Metadata repeats across every passage of a source, and it
was counted in the same document-frequency table as body text. The word "customers" in that source's
topic line made "customers" look common across ten passages, collapsing its IDF for the one passage
that genuinely said it.

**Fix.** Two tables: body frequency drives BM25 scoring, body-or-metadata frequency drives the
metadata bonus only.

**Test.** `tests/regressions.test.ts` — "does not let source metadata dilute the weight of a word in
the passage text".

## F-09
**Price questions could not reach the passages holding prices.** *(medium)*

**Symptom.** For "cheapest plan in the US", the three priced plan cards ranked 4th, 10th and 11th
within their own source, below marketing copy that happened to repeat "plan" and "Xero".

**Cause.** "Cheapest" appears nowhere in the evidence, and the passages that answer it announce
themselves only by containing a price — a fact about the passage that none of its words state.

**Fix.** One derived facet in `src/retrieve.ts`: a passage quoting a recurring price carries
`facet:price`, and a question using price-intent vocabulary asks for it. A facet alone never creates
a match; the passage must still match something the user typed. After the fix the three plan cards
rank 1, 2, 3.

**Test.** `tests/regressions.test.ts` — "prefers a passage that states a price when the question asks
about cost", and "does not return a passage that only matches a facet".

## F-10
**The price signal also matched annual revenue.** *(medium)*

**Symptom.** "Is Xero more expensive in Australia than in the United States?" pulled three
encyclopaedia passages into the top six and still reached no Australian price.

**Cause.** The first version of F-09 matched any monetary amount, and the encyclopaedia infobox
quotes `NZ$2.753 billion` in revenue.

**Fix.** The facet requires a *recurring* price — an amount followed by "per month", "a month",
"/mo", "per user" and so on — which is what plan pricing looks like and company financials do not.

**Test.** `tests/regressions.test.ts` — "does not treat annual revenue as a price".

## F-11
**A compound claim cited only one of the passages it drew on.** *(high)*

**Symptom.** A claim reading "the $2.50 US Early price is a new-customer offer of 90% off for the
first 6 months" cited only the offer-terms passage, which does not contain `$2.50`. The verifier
correctly flagged it unsupported.

**Cause.** The prompt asked for "the labels that support it" without saying that a claim assembled
from two passages must cite both.

**Fix.** `src/prompt.ts` states it explicitly, and warns that a claim quoting a figure its own cited
passages do not contain will be rejected. The verifier was not weakened; the instruction was.

## F-12
**Verbatim-correct claims failed because they were verbose.** *(medium)*

**Symptom.** `The Xero plan information shown under the heading "Comprehensive" lists "Included Use
multiple currencies" as a feature.` was flagged unsupported against the Comprehensive plan card,
which contains both quoted strings verbatim.

**Cause.** Overlap was measured across every word of the claim. Seven of its twelve terms were
framing — "information", "shown", "heading", "lists", "feature" — and framing is never in the
evidence, so the denominator sank the score to 0.33, below the unsupported threshold.

**Fix.** Only words that some stored passage actually uses can be confirmed or denied by a stored
passage, so words absent from the whole corpus no longer count against the claim. The trade-off is
stated in `src/verify.ts`: an invented word outside the corpus no longer lowers the score on its own.
Invented *figures* are still caught by the separate figure check, and an invented statement still
fails because its remaining words are absent from the cited passage.

**Tests.** `tests/regressions.test.ts` — the verbose-claim case, plus two guards proving an unrelated
citation and a fabricated figure are still rejected.

## F-13
**A connection fix applied to one entry point only.** *(medium)*

**Symptom.** The ground-truth checker could not reach Wikipedia (`ETIMEDOUT`), while the application
could.

**Cause.** Node races IPv6 and IPv4 and gives the first family 250ms; on a connection where IPv6 is
advertised but unreachable, requests fail. The workaround was a module side effect inside
`src/http.ts`, so any entry point calling `fetch` directly silently lost it.

**Fix.** `src/net.ts` exports `configureConnectionTimeouts()`, called explicitly by both.

## F-14
**An empty source list deleted all stored research.** *(high)*

**Cause.** Configuration is the source of truth, so gathering prunes evidence for any source no
longer listed. `{"sources": []}` passed validation, and the next gather removed every stored source.
An empty edit never means "delete everything".

**Fix.** `loadSources` refuses an empty list and says why. It also now names the file when the JSON
is malformed; the old message was a bare character position.

**Test.** `tests/regressions.test.ts` — "refuses an empty source list…", "names the file…".

## F-15
**A model reply with no answer text was returned as a result.** *(high)*

**Cause.** `parseModelJson` checked that the reply was a JSON object and nothing more. A reply with
the `answer` field missing, empty, blank or a number was returned to the user as a successful, empty
answer — the "invalid response presented as a successful result" the brief rules out.

**Fix.** A reply without non-empty answer text is a `ModelFailure` of kind `invalid_response`, which
the API reports as 502 with no answer field.

**Test.** `tests/regressions.test.ts` — "treats well-formed JSON without answer text…";
`tests/http.test.ts` — "reports a model reply with no answer text as a failure".

## F-16
**Claims in another script were reported as verified.** *(high)*

**Symptom.** Asked `Xero 的 Grow 套餐多少钱`, the model answered in Chinese and wrote its claims in
Chinese; every claim was marked `supported`. A deliberately wrong claim — Grow `不含 GST` ("excludes
GST") and supports unlimited employees — was *also* marked `supported`.

**Cause.** The tokenizer drops non-Latin script, so that claim reduced to `[grow, 7.80, gst]`, which
overlaps the evidence perfectly. The verifier was reporting text it could not read as checked.

**Fix.** Two layers. The prompt now asks for claims in English, the language of the passages, while
the answer itself may follow the user's language. And the verifier no longer trusts the prompt: a
claim that is mostly non-Latin script is capped at `weak`, with the reason that only its figures were
checked. After the fix the same question gets a Chinese answer with English claims, all genuinely
verified.

**Test.** `tests/regressions.test.ts` — "does not report a claim in another script as supported",
plus guards that a wrong figure is still rejected and English claims are unaffected.

## F-17
**Source ids that break passage ids and URLs were accepted.** *(medium)*

Ids become passage ids (`<id>#<n>`) and a URL path segment (`/api/sources/<id>/passages`), yet `#`,
`/` and spaces were accepted. `loadSources` now requires letters, digits, `-` and `_`.

**Test.** `tests/regressions.test.ts` — "refuses source ids that would break passage ids or URL paths".

## F-18
**Client mistakes were reported as server errors.** *(low)*

Malformed JSON and a body over 32 KB both returned **500 `server_error`**, telling a caller the
application had failed when it had correctly refused bad input. The error handler in `src/app.ts`
now passes the body parser's 4xx status through as `invalid_json` (400) or `payload_too_large`
(413). An unknown source id on `/api/sources/<id>/passages` now returns 404 instead of an empty 200.
To make this testable, the API moved into `createApp()` in `src/app.ts`; `src/server.ts` only listens.

**Test.** `tests/http.test.ts`, which runs a real listening server around a fake fetcher and model.

## F-19
**Temp-file cleanup never matched the files it should remove.** *(low)*

`persist()` writes `store.json.<pid>.tmp`; `cleanTemp()` looked for `store.json.tmp`, which nothing
writes, so it never removed anything. Atomic rename still protected the store itself, but a crashed
write left debris behind forever.

**Test.** `tests/regressions.test.ts` — "removes the temp files a crashed write actually leaves behind".

---

## Held-out evaluation

The 30 questions in `questions.json` drove the fixes above, so passing them is partly true by
construction. `questions-held-out.json` holds 20 questions written afterwards in different phrasings
— lowercase, shouting, typos, mixed Chinese and English, context-free follow-ups, out-of-scope
support questions — and run **without tuning retrieval or prompts against them**.

| Run | Mechanical checks | Manual reading of the answers |
| --- | --- | --- |
| `07-held-out-first-run` | 20/20 | 17 good; 2 recall misses (K-01, K-02); 1 verification hole (F-16) |
| `09-held-out-after-claim-language-fix` | 20/20 | F-16 fixed; K-01 and K-02 unchanged, as expected |

Mechanical checks passing is not the same as a good answer: they verify the claims a model lists,
and cannot see prose it chose not to list. So every held-out answer was also read. Examples of what
that reading confirmed: *"How much is the Ultimate plan if I have 20 employees?"* declined to
extrapolate from Ultimate 10; *"How much does Xero cost in New Zealand?"* refused to present AUD or
USD prices as NZ prices; *"What's the phone number for Xero customer support?"* invented no number;
*"how much is the grwo plan pirce"* still reached the Grow plan through the price facet.

## K-01
**"Who runs Xero?" answers that the research names no one.** The store holds *"Steve Vamos was
appointed as CEO"* and *"Sukhinder Singh Cassidy, the CEO of Xero"*. The question tokenizes to `run,
xero`, and `run` matches *"pay runs"* and *"Run an efficient practice"* instead: a word-sense
collision plus a vocabulary gap (`runs` ≠ `CEO`). Notably, the model did not fill the gap from its
own knowledge of Xero's leadership; it said the supplied passages did not establish it.

## K-02
**"what plans does xero have" names no plan.** Plan names live in passage headings such as `Grow`
and `Early`, and nothing in the question matches them; `plan` matches marketing copy about plans
instead. The answer is honest (`partial`) but unhelpful.

**Why these are not fixed.** Both are the vocabulary-mismatch limitation stated in design decision 1,
now measured rather than assumed. Adding synonyms for "runs" or "plans" would make these two
questions pass while saying nothing about the next paraphrase, and would turn a held-out measurement
into a tuned one. The fix that would generalise is semantic retrieval alongside BM25.

---

## Defects in the test harness

Worth recording separately: three failures were the tests being wrong, not the application.

### H-01
The reuse check compared the passages the **model chose to cite**, which varies between runs, rather
than the passages **retrieval selected**, which does not. Both runners now compare the retrieved set
and the retrieval time each of those passages carries.

### H-02
The prompt-injection check searched the answer for the injected word. Quoting `HACKED` while
refusing to output it is correct behaviour; the check now fails only if the answer *is* that word.

### H-04
`npm run explore -- --offline` was documented and accepted, but still called the real model while
labelling every output **MOCKED** — mislabelled evidence, in exactly the place the brief asks for real
and mocked outputs to be clearly distinguished. The sweep has no meaningful offline form, so the flag
is now refused.

### H-03
Two regression tests asserted the wrong thing: one expected the per-source cap to shrink the result
set, when topping up to fill `topK` is deliberate; another omitted the source-context map the
behaviour under test depends on. A ground-truth pattern also required `ASX:XRO` with no space, which
markup stripping turns into `ASX : XRO`.
