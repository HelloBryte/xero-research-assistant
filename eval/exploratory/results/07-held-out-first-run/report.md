# Exploratory test run

**Model outputs:** REAL — replies come from the configured model endpoint
**Question bank:** `eval/exploratory/questions-held-out.json`
**Model:** `deepseek-flash` via `https://api.deepseek.com`, temperature 0
**Retrieval:** top 6, max 3 per source
**Run started:** 2026-09-16T14:14:14.342Z
**Research:** 58 passages from 5 sources

- `wikipedia-xero` — https://en.wikipedia.org/wiki/Xero_(company) — retrieved 2026-09-14T08:30:21.589Z — 6 passages
- `xero-about` — https://www.xero.com/au/about/ — retrieved 2026-09-14T08:34:17.583Z — 10 passages
- `xero-accounting-software-au` — https://www.xero.com/au/accounting-software/ — retrieved 2026-09-14T08:30:19.118Z — 20 passages
- `xero-pricing-au` — https://www.xero.com/au/pricing-plans/ — retrieved 2026-09-14T08:30:17.319Z — 9 passages
- `xero-pricing-us` — https://www.xero.com/us/pricing-plans/ — retrieved 2026-09-14T08:30:18.157Z — 13 passages

## Summary: 20/20 passed

| Category | What it probes | Passed |
| --- | --- | --- |
| pricing | Plan and price questions in phrasings not used during development. | 5/5 |
| product | Capability questions a small business owner would ask. | 4/4 |
| company | Company facts, including ones whose answer is time-sensitive. | 3/3 |
| out-of-scope | Reasonable questions the stored research simply does not cover. | 3/3 |
| follow-up | Questions that only make sense after a previous one. The application keeps no conversation state, by design. | 2/2 |
| noisy | Typos, shouting, mixed languages: how real people type. | 3/3 |

19 of 20 cases reached the model (60152 tokens in total); the rest were resolved by application logic before any model call.

## pricing

_Plan and price questions in phrasings not used during development._

### `ho-plans-lowercase` — PASS

**Question typed:** "what plans does xero have"

**What this probes:** No capitals, no punctuation. Should still list plan names and qualify them by region.

**Status:** partial

**Answer:**

> The passages establish that Xero offers several plans to suit different business sizes and needs, and that the Xero pricing page can be used to compare plans and start a 30-day free trial (E4). They also state that purchasing any Xero plan comes with the first month free (E3, E5), and that Xero Analytics, offering rich visual analytics, is included on every plan (E6). Xero also provides a tool that takes a little information about your business and points you to the right plan in under two minutes (E1, E2). However, the passages do not name or list the individual plans Xero offers, nor give any plan prices or the number of plans.

**Context stated:** E1–E5 are from Xero's AU pages (region AU, currency AUD) and E6 is from Xero's US pricing page (region US, currency USD); all were retrieved on 2026-09-14. The passage text does not itself state any currency figures for plans — the region/currency labels are the retrieval metadata. E2 contains a section heading 'Grow' but the passage body does not establish that this is a plan name.

**Reported as not established:** The names of the individual Xero plans / The number of plans Xero offers / The price of any Xero plan or any plan tier / What each plan includes or which features differentiate the plans / What the 'Grow' section heading in E2 refers to, or whether 'Grow' is a plan name

**Retrieval:** terms [plan, xero] → 6 of 58 passages (strong, coverage 1); E1=xero-pricing-au#6, E2=xero-pricing-au#5, E3=xero-pricing-au#7, E4=xero-accounting-software-au#12, E5=xero-accounting-software-au#14, E6=xero-pricing-us#8

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero offers several plans to suit different business sizes and needs. | xero-accounting-software-au#12 |
| supported | Xero's pricing page lets customers compare plans and start a 30-day free trial. | xero-accounting-software-au#12 |
| supported | Purchasing any Xero plan comes with the first month free. | xero-pricing-au#7, xero-accounting-software-au#14 |
| supported | Xero Analytics, described as rich, visual analytics, is included on every Xero plan. | xero-pricing-us#8 |
| supported | Xero offers a personalised recommendation tool that, after being told a little about your business, points you to the right plan in under two minutes. | xero-pricing-au#6, xero-pricing-au#5 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial
- pass — citations: 6 citation(s)
- pass — every claim verified against its citation: 5 supported, 0 weak, 0 unsupported, 0 uncited
- model: 2468 tokens, 5530ms

### `ho-ultimate-20` — PASS

**Question typed:** "How much is the Ultimate plan if I have 20 employees?"

**What this probes:** The stored pages price Ultimate 10 but not the 20-person tier. The answer must not extrapolate a price from Ultimate 10.

**Status:** partial

**Answer:**

> The passages do not quote a price for an "Ultimate" plan covering 20 employees. What they do establish is the Australian pricing for a plan named "Ultimate 10": $14.30 per month for the first 3 months, then $143 per month (E2, E4), and that this plan includes Payroll for 10 people (E2, E4). Xero's Australian pricing page adds that additional charges may apply if you go over the stated included number of people paid for Payroll, or included users for Expenses and Projects (E3). No passage states a per-person rate that is explicitly tied to Payroll on the Ultimate 10 plan, so the total monthly cost for 20 employees cannot be calculated from the evidence. The US pricing page's plan sections shown here are Early, Growing and Established, with no Ultimate plan listed (E1, E5).

**Context stated:** The Ultimate 10 figures come from Xero's Australian pricing pages (region AU, currency AUD as stated for the AU pricing page in E3; pricing included "for the first 3 months" per E4) retrieved 2026-09-14. E3 states AU prices include GST. The US pricing passage (E1, region US, currency USD, retrieved 2026-09-14) notes an upcoming price increase from October 1, 2026, and that its prices are in USD and exclude taxes. The E4 excerpt does not itself restate the currency; the AU region/currency comes from the page it was retrieved from, and E2 for the same plan is labelled region AU, currency AUD.

**Reported as not established:** The total cost of an Ultimate (or Ultimate 10) subscription for 20 employees, including any add-on or overage charges. / Whether the "$7 per additional user" figure shown in the Australian plan comparison table (E3) applies to Payroll people paid beyond the included 10, and whether it is the rate that would apply to ext… [213 characters in total] / Whether the Ultimate 10 plan can be purchased for 20 employees at all, or whether a different plan is required at that headcount. / Any pricing for an Ultimate plan in the US or in any region other than the one covered by the supplied Australian passages.

**Retrieval:** terms [ultimate, plan, 20, employee] → 6 of 58 passages (strong, coverage 1); E1=xero-pricing-us#3, E2=xero-accounting-software-au#18, E3=xero-pricing-au#3, E4=xero-pricing-au#1, E5=xero-pricing-us#1, E6=xero-pricing-au#2

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | The Xero plan named "Ultimate 10" is shown at $14.30 per month for the first 3 months and then $143 per month. | xero-accounting-software-au#18, xero-pricing-au#1 |
| supported | The Ultimate 10 plan includes Payroll for 10 people. | xero-accounting-software-au#18, xero-pricing-au#1 |
| supported | Xero's Australian pricing terms state that if you select a plan which includes Payroll, Expenses or Projects, additional charges may apply if you go over the stated included number of users (Expenses … [239 characters in total] | xero-pricing-au#3 |
| supported | Xero's Australian pricing terms state that prices are in AUD and include GST. | xero-pricing-au#3 |
| supported | The US pricing page passages supplied show plans named Early, Growing and Established, and no plan named Ultimate. | xero-pricing-us#3, xero-pricing-us#1 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=partial|insufficient|answered
- pass — every claim verified against its citation: 5 supported, 0 weak, 0 unsupported, 0 uncited
- model: 4460 tokens, 10254ms

### `ho-per-user` — PASS

**Question typed:** "xero grow plan is $78 - is that per user or per business?"

**What this probes:** Tests whether per-user versus flat pricing is established by the evidence, without assuming.

**Status:** partial

**Answer:**

> The passages show the Xero Grow plan at "$78 per month" (E1, E2), and on the AU accounting-software page it is presented as "$7.80 per month for the first 3 months" before that (E2; E1 shows the $7.80 and $78 figures without stating the 3-month period). However, neither passage states whether the $78 per month is charged per user or per business, so the billing basis of that figure cannot be established from the evidence. The surrounding details describe what Grow includes and the extra-user charges attached to certain features rather than the basis of the plan price: Grow includes Payroll for 2 people (E1, E2), a 60 day cashflow forecast (E1, E2), and claim expenses and mileage for 1 user with "$5 per additional user" (E1, E2 for the 1-user inclusion; E1 for the $5 per additional user). E1 also states that if you select a plan which includes Payroll, Expenses, or Projects, additional charges may apply if you go over the stated included number of users (Expenses and Projects) or people paid (Payroll), and that prices are in AUD and include GST, with subscriptions auto-renewing monthly until cancelled (E1).

**Context stated:** The passages are for region AU, currency AUD, retrieved 2026-09-14T08:30:17.319Z (E1, E4, E5) and 2026-09-14T08:30:19.118Z (E2, E3, E6). E1 states prices are in AUD and include GST. E1 lists other plans (Comprehensive at $107 per month, Ultimate 10 at $143 per month) which are not part of this question. No passage contained instruction-like text directed at the reader.

**Reported as not established:** Whether the Grow plan's $78 per month is charged per user or per business. / Whether the Grow plan price varies with the number of users on the subscription. / Any statement of the billing unit or seat model underlying the $78 per month figure.

**Retrieval:** terms [xero, grow, plan, 78, per, user, business] → 6 of 58 passages (strong, coverage 1); E1=xero-pricing-au#3, E2=xero-accounting-software-au#16, E3=xero-accounting-software-au#18, E4=xero-pricing-au#5, E5=xero-pricing-au#2, E6=xero-accounting-software-au#13

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | The Xero Grow plan is shown at $78 per month. | xero-pricing-au#3, xero-accounting-software-au#16 |
| weak | The Grow plan is shown at $7.80 per month for the first 3 months before the $78 per month price applies. | xero-accounting-software-au#16 |
| supported | The Grow plan includes Payroll for 2 people. | xero-pricing-au#3, xero-accounting-software-au#16 |
| supported | The Grow plan includes a 60 day cashflow forecast. | xero-pricing-au#3, xero-accounting-software-au#16 |
| supported | Grow includes claim expenses and mileage for 1 user. | xero-pricing-au#3, xero-accounting-software-au#16 |
| supported | For the Grow plan, expenses and mileage are $5 per additional user. | xero-pricing-au#3 |
| supported | Prices on the pricing plans page are in AUD and include GST, and Xero reserves the right to change pricing at any time. | xero-pricing-au#3 |
| supported | Xero subscriptions auto-renew monthly until they are cancelled. | xero-pricing-au#3 |
| supported | If you select a plan which includes Payroll, Expenses, or Projects, additional charges may apply if you go over the stated included number of users (Expenses and Projects) or people paid (Payroll). | xero-pricing-au#3 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial|insufficient
- pass — every claim verified against its citation: 8 supported, 1 weak, 0 unsupported, 0 uncited
- model: 4039 tokens, 9898ms

### `ho-discount-end` — PASS

**Question typed:** "When does the current discount end?"

**What this probes:** The offers state end dates per region; the answer should give them with their region.

**Status:** answered

**Answer:**

> The evidence gives two different discount end dates, one per region. For Australia, the offer is available until 11:59pm AEST on 30 September 2026, using code DC9032619AU, and is limited to customers in Australia purchasing their first organisation on xero.com (E1). For the United States, the offer is available until 30 September 2026 at 11:59pm UTC, using code DC90626308US, and is limited to customers in the United States purchasing their first organization on xero.com (E2). In both cases the discount is 90% off — for the first 3 months in Australia (E1) and for the first 6 months in the US (E2) — after which the regular price applies and the subscription auto-renews monthly until cancelled (E1, E2). Both passages also state that Xero can change or cancel the offer at any time (E1, E2).

**Context stated:** E1 is the Australian pricing-plans page (region AU, currency AUD), retrieved 2026-09-14T08:30:17.319Z. E2 is the US pricing-plans page (region US, currency USD), retrieved 2026-09-14T08:30:18.157Z. The end dates are stated exactly as above and apply to the promotional discount, not to the subscription, which auto-renews monthly until cancelled (E1, E2). No instruction-like content was found in the passages.

**Reported as not established:** Which of the two dated offers (or any other regional offer) counts as the 'current' discount at the time the user is asking. / Discount end dates for any region other than Australia and the United States. / Whether either offer was still running when the question was asked.

**Retrieval:** terms [current, discount, end] → 4 of 58 passages (strong, coverage 0.667); E1=xero-pricing-au#4, E2=xero-pricing-us#4, E3=xero-pricing-au#8, E4=xero-pricing-us#12

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | In the Australian pricing plans, the new-customer offer is available until 11:59pm AEST on 30 September 2026 and requires code DC9032619AU. | xero-pricing-au#4 |
| supported | The Australian offer is only available to customers in Australia purchasing their first organisation on xero.com. | xero-pricing-au#4 |
| supported | In Australia, new customers get 90% off for the first 3 months, after which Xero's regular price applies and the subscription auto-renews monthly until cancelled. | xero-pricing-au#4 |
| supported | In the United States pricing plans, the new-customer offer is available until 30 September 2026 at 11:59pm UTC and requires code DC90626308US. | xero-pricing-us#4 |
| supported | The US offer is only available to customers in the United States purchasing their first organization on xero.com. | xero-pricing-us#4 |
| supported | In the United States, new customers get 90% off for the first 6 months, after which Xero's regular price applies and the subscription auto-renews monthly until cancelled. | xero-pricing-us#4 |
| supported | Xero can change or cancel the offer at any time, in both the Australian and US pricing passages. | xero-pricing-au#4, xero-pricing-us#4 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial
- pass — citations: 2 citation(s)
- pass — every claim verified against its citation: 7 supported, 0 weak, 0 unsupported, 0 uncited
- pass — mentions required context: found "30 September"
- model: 3053 tokens, 5199ms

### `ho-nz-price` — PASS

**Question typed:** "How much does Xero cost in New Zealand?"

**What this probes:** No New Zealand pricing page is stored. Presenting an AUD or USD price as the NZ price would be wrong.

**Status:** insufficient

**Answer:**

> The supplied passages do not contain any Xero pricing for New Zealand, so the cost of Xero in New Zealand cannot be established from this evidence. The only pricing passages provided are for the United States in USD (E4, E5) and for Australia in AUD (E6), and under the rules those region-specific prices cannot be carried over to New Zealand.

**Context stated:** No New Zealand pricing passage was supplied. Pricing pages retrieved 2026-09-14: E4 and E5 are for the US region in USD; E6 is for the AU region in AUD (prices include GST). E5 also notes that Xero subscription prices are increasing from October 1, 2026, on that US page. Because prices, plans and availability are region- and time-specific, the US and AU figures cannot be used as an answer for New Zealand.

**Reported as not established:** The cost of any Xero subscription plan in New Zealand, in NZD or any other currency. / Which Xero plans are available in New Zealand and how they are billed. / Whether any New Zealand pricing corresponds to the US plan prices shown (E4, E5) or the Australian plan prices shown (E6).

**Retrieval:** terms [xero, cost, new, zealand] → 6 of 58 passages (strong, coverage 1); E1=wikipedia-xero#0, E2=wikipedia-xero#1, E3=wikipedia-xero#2, E4=xero-pricing-us#1, E5=xero-pricing-us#3, E6=xero-pricing-au#3

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=insufficient|partial
- pass — every claim verified against its citation: 0 supported, 0 weak, 0 unsupported, 0 uncited
- pass — states what it could not establish: 3 unknown(s)
- model: 3733 tokens, 5339ms

## product

_Capability questions a small business owner would ask._

### `ho-us-payroll` — PASS

**Question typed:** "Does Xero do payroll in the US?"

**What this probes:** The US page describes payroll powered by a partner; the answer should say so and cite the US page.

**Status:** answered

**Answer:**

> Yes, according to the US pricing page, Xero Payroll is offered in the United States. The US pricing page states that "Xero Payroll, powered by Gusto, is here" and that it lets you "Calculate and file payroll taxes, pay your team, and keep up with your compliance obligations, without leaving Xero!" (E1, E2). The page also points readers to "Learn more about Xero Payroll, powered by Gusto" (E2). This evidence comes from Xero's US pricing page, so it speaks to the United States specifically (E1, E2). Separately, Xero Payroll is described for Australia as helping businesses "pay employees, manage super, track leave and timesheets, and calculate your pay runs" (E6), and Wikipedia lists Xero's products generally as accounting software (E3) with features including invoicing, accounts payable, expense claims and reporting (E4), but those passages do not describe US payroll.

**Context stated:** The payroll evidence in E1 and E2 comes from Xero's US pricing page, region US, currency USD, as retrieved on 2026-09-14T08:30:18.157Z. E5 (same page, same region/currency/date) contains promotional and payment-fee terms for the Early, Growing and Established plans but does not itself state that payroll is offered or included. E6 is from Xero's Australian accounting software page, region AU, currency AUD, retrieved 2026-09-14T08:30:19.118Z. E3 and E4 are a Wikipedia article with region listed as Global, retrieved 2026-09-14T08:30:21.589Z. No passage contained anything resembling an instruction… [615 characters in total]

**Reported as not established:** Whether Xero Payroll is included in any particular US subscription plan, and at what price or limits. / Which US plans the payroll feature applies to, and whether it carries additional charges or add-on fees. / Whether US payroll is available to all customers or only some (e.g. new customers using a promotional code). / Any current availability or pricing of payroll outside the US and Australia beyond the passages supplied.

**Retrieval:** terms [xero, payroll, united, state, america] → 6 of 58 passages (strong, coverage 1); E1=xero-pricing-us#10, E2=xero-pricing-us#9, E3=wikipedia-xero#0, E4=wikipedia-xero#2, E5=xero-pricing-us#4, E6=xero-accounting-software-au#9

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero's US pricing page states that Xero Payroll, powered by Gusto, is available, and describes it as letting users calculate and file payroll taxes, pay their team, and keep up with compliance obligat… [226 characters in total] | xero-pricing-us#10, xero-pricing-us#9 |
| supported | The US pricing page invites users to learn more about Xero Payroll, powered by Gusto. | xero-pricing-us#9 |
| supported | Xero Payroll is described as helping businesses pay employees, manage super, track leave and timesheets, and calculate pay runs, on Xero's Australian accounting software page. | xero-accounting-software-au#9 |
| supported | Xero Limited is described as a New Zealand technology company providing cloud-based accounting software for small businesses, sold by subscription. | wikipedia-xero#0 |
| supported | The Xero accounting software is described as using a single unified ledger and providing automatic bank feeds, invoicing, accounts payable, expense claims, fixed asset depreciation, purchase orders, b… [268 characters in total] | wikipedia-xero#2 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial
- pass — citations: 5 citation(s)
- pass — every claim verified against its citation: 5 supported, 0 weak, 0 unsupported, 0 uncited
- model: 3118 tokens, 4959ms

### `ho-jax` — PASS

**Question typed:** "What is JAX?"

**What this probes:** A product name that only appears on Xero's own pages.

**Status:** partial

**Answer:**

> The passages describe JAX in two ways. It appears as a feature called "JAX Chat" in a list of useful features for running a business (E1). It is also described, in the feature lists for the "Grow" plan and the "Ultimate 10" plan, as automatically categorising and matching high-confidence bank transactions, giving you a reliable, up-to-date view of your finances (E2, E3). The passages do not explain what JAX is beyond these descriptions — for example, they do not say what the name stands for, what JAX Chat does, or how the feature is priced or made available.

**Context stated:** All three passages are Australian (region AU), in AUD, and were retrieved on 2026-09-14T08:30 (E1 and E2 at 08:30:19, E3 at 08:30:17). E1 is from the "Useful features to run your business" section of the Australian accounting software page; E2 is the "Grow" plan section of the same page; E3 is the "Ultimate 10" plan from the Australian pricing plans page. No instruction-like content was found in the passages.

**Reported as not established:** What the name "JAX" stands for or any formal definition of JAX. / What JAX Chat is or what it does. / Any capabilities of JAX beyond categorising and matching high-confidence bank transactions. / Whether JAX is available in regions or plans other than those covered by the supplied passages. / Any pricing specifically attributable to JAX as a separate item.

**Retrieval:** terms [jax] → 3 of 58 passages (strong, coverage 1); E1=xero-accounting-software-au#19, E2=xero-accounting-software-au#16, E3=xero-pricing-au#1

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | "JAX Chat" is listed among Xero's useful features to run your business. | xero-accounting-software-au#19 |
| supported | JAX automatically categorises and matches high-confidence bank transactions, giving a reliable, up-to-date view of your finances. | xero-accounting-software-au#16, xero-pricing-au#1 |
| weak | In the "Grow" plan feature list, JAX is shown as included. | xero-accounting-software-au#16 |
| supported | In the "Ultimate 10" plan feature list, JAX is shown as included. | xero-pricing-au#1 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial
- pass — citations: 3 citation(s)
- pass — every claim verified against its citation: 3 supported, 1 weak, 0 unsupported, 0 uncited
- model: 2039 tokens, 3649ms

### `ho-cancel` — PASS

**Question typed:** "Can I cancel my subscription whenever I want?"

**What this probes:** The offer terms describe monthly auto-renewal until cancelled; any cancellation policy beyond that is not established.

**Status:** partial

**Answer:**

> The evidence does not directly answer whether you can cancel your subscription whenever you want. What it does show is that Xero subscriptions auto-renew monthly until they are cancelled (E1, E2, E3, E4, E6), so cancellation is treated as the event that ends the ongoing subscription. The discounted new-customer offers described for Australia and the United States likewise state that after the discount period the regular price applies and the subscription auto-renews monthly until cancelled, as described in Xero's Terms of Use (E1, E2). The pricing pages also state that if you later decide to change to a less expensive plan you can do so 1 month after upgrading (E3, E4). None of the passages state whether cancellation may be requested at any time, what notice or notice period applies, or what the cancellation process is; those details are referred to the Terms of Use (E1, E2), which are not among the supplied passages.

**Context stated:** Passages E1 and E4 apply to Australia (region AU, currency AUD, retrieved 2026-09-14T08:30:17.319Z); E2, E3 and E6 apply to the United States (region US, currency USD, retrieved 2026-09-14T08:30:18.157Z). Prices, offers and dates in these passages are region- and time-specific and are as retrieved on those dates; E1's offer is stated to be available until 11:59pm AEST on 30 September 2026 and E2's until 30 September 2026 at 11:59pm UTC. The passages refer to Xero's Terms of Use but that document is not included. No passage contained anything resembling an instruction to the reader.

**Reported as not established:** Whether a Xero subscription can be cancelled at any time (no passage states this) / Any notice period or minimum term required for cancellation / The process or method for cancelling a subscription / Whether any refund is available on cancellation / What the referenced Terms of Use say about cancellation

**Retrieval:** terms [cancel, subscription, whenever, want] → 6 of 58 passages (strong, coverage 0.5); E1=xero-pricing-au#4, E2=xero-pricing-us#4, E3=xero-pricing-us#3, E4=xero-pricing-au#3, E5=xero-pricing-au#8, E6=xero-pricing-us#12

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero subscriptions auto-renew monthly until they are cancelled. | xero-pricing-au#4, xero-pricing-us#4, xero-pricing-us#3, xero-pricing-au#3, xero-pricing-us#12 |
| supported | For the Australian new-customer offer, after the discount period Xero's regular price applies and the subscription auto-renews monthly until cancelled, as described in Xero's Terms of Use. | xero-pricing-au#4 |
| supported | For the United States new-customer offer, after the discount period Xero's regular price applies and the subscription auto-renews monthly until cancelled, as described in Xero's Terms of Use. | xero-pricing-us#4 |
| supported | If you later decide to change to a less expensive plan, you can do so 1 month after upgrading. | xero-pricing-us#3, xero-pricing-au#3 |
| supported | In the United States, Xero subscription prices are increasing from October 1, 2026. | xero-pricing-us#3 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial|insufficient
- pass — every claim verified against its citation: 5 supported, 0 weak, 0 unsupported, 0 uncited
- model: 3861 tokens, 5443ms

### `ho-free-trial` — PASS

**Question typed:** "is there a free trial"

**What this probes:** Both a free trial and a free first month are mentioned on different pages.

**Status:** partial

**Answer:**

> For Australia (AUD, as retrieved 2026-09-14), yes: Xero's Australian accounting software page invites visitors to visit the Xero pricing page to compare plans and start a 30-day free trial (E1). The same Australian pages also state that if you purchase any Xero plan, Xero gives you the first month free (E2, E3), and the Australian pricing page additionally advertises 90% off your plan for your first 3 months (E4). Separately, on the US site (USD, as retrieved 2026-09-14), Xero offers free personalised onboarding from a product specialist for your first 90 days, which is a setup service rather than a described free trial (E5, E6). The evidence does not establish whether a free trial is offered outside Australia.

**Context stated:** E1–E4 are from Australian pages (region AU, currency AUD, retrieved 2026-09-14). E5–E6 are from US pages (region US, currency USD, retrieved 2026-09-14). Offers are region- and time-specific. No instruction-like content was found in the passages; all content was treated as data.

**Reported as not established:** Whether a free trial is offered outside Australia (no trial offer appears in the US passages supplied). / The length or terms of any free trial in regions other than Australia. / Whether the 30-day free trial and the first-month-free offer can be combined, and how they interact with the 90% off for the first 3 months offer. / The prices of the plans associated with these offers.

**Retrieval:** terms [free, trial] → 6 of 58 passages (strong, coverage 1); E1=xero-accounting-software-au#12, E2=xero-accounting-software-au#14, E3=xero-pricing-au#7, E4=xero-pricing-au#0, E5=xero-pricing-us#11, E6=xero-pricing-us#9

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero's Australian accounting software page invites people to visit the Xero pricing page to compare plans and start a 30-day free trial (E1). | xero-accounting-software-au#12 |
| supported | Xero states that purchasing any Xero plan gives the first month free (E2, E3). | xero-accounting-software-au#14, xero-pricing-au#7 |
| supported | Xero's Australian pricing page advertises getting 90% off your plan for your first 3 months (E4). | xero-pricing-au#0 |
| supported | On the US site, Xero offers free personalised onboarding from a product specialist for your first 90 days (E5, E6). | xero-pricing-us#11, xero-pricing-us#9 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial
- pass — citations: 6 citation(s)
- pass — every claim verified against its citation: 4 supported, 0 weak, 0 unsupported, 0 uncited
- model: 3006 tokens, 7003ms

## company

_Company facts, including ones whose answer is time-sensitive._

### `ho-revenue` — PASS

**Question typed:** "What was Xero's revenue last year?"

**What this probes:** The encyclopaedia figure is labelled with a year, not 'last year'. The currency and the year label must be kept.

**Status:** partial

**Answer:**

> The only revenue figure in the supplied passages is NZ$2.753 billion, shown in Xero's infobox against the year 2026 (E1). The passages do not identify how Xero's financial year is defined, nor do they give revenue for any earlier year, so they do not establish whether this figure is "last year's" revenue as asked. Xero is described as a New Zealand technology company providing cloud-based accounting software, sold by subscription (E1).

**Context stated:** The revenue figure comes from E1, retrieved 2026-09-14 and tagged region Global, and is quoted exactly as NZ$2.753 billion with the year shown as 2026. The E1 infobox also labels this line as an increase, but no prior-year value is supplied, so no growth can be quantified. No passage contains instructions directed at the reader; passages E3 and E5 contain customer testimonials and FAQ text from Xero's Australian site (region AU, currency AUD, retrieved 2026-09-14), and E6 is US payroll content (region US, currency USD, retrieved 2026-09-14), none of which contain revenue figures.

**Reported as not established:** Whether the NZ$2.753 billion figure corresponds to "last year" as the user means it, since the passages do not state the retrieval-relative meaning of the year label or define Xero's financial year. / Revenue for any year other than the one labelled 2026, and therefore any year-on-year comparison. / Xero's revenue in any currency other than NZ$.

**Retrieval:** terms [xero, revenue, last, year] → 6 of 58 passages (strong, coverage 0.75); E1=wikipedia-xero#0, E2=wikipedia-xero#5, E3=xero-accounting-software-au#0, E4=wikipedia-xero#1, E5=xero-accounting-software-au#13, E6=xero-pricing-us#10

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero's revenue is reported as NZ$2.753 billion for 2026. | wikipedia-xero#0 |
| supported | Xero is a New Zealand technology company that provides cloud-based accounting software for small businesses, sold by subscription. | wikipedia-xero#0 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial
- pass — citations: 1 citation(s)
- pass — every claim verified against its citation: 2 supported, 0 weak, 0 unsupported, 0 uncited
- pass — mentions required context: found "NZ$"
- model: 2831 tokens, 4266ms

### `ho-ceo` — PASS

**Question typed:** "Who runs Xero?"

**What this probes:** The evidence names a CEO in a dated historical passage. It must not be presented as the current CEO without that date.

**Status:** insufficient

**Answer:**

> The supplied passages do not establish who runs Xero. They describe product capabilities and plan availability — for example collaborating, automating tasks and accessing client records (E1), Single Touch Payroll compliance for sending reports directly to the ATO (E2), Xero Payroll helping pay employees, manage super, track leave and timesheets, and calculate pay runs (E3), plans for self-employed people and larger businesses (E4), Xero Payroll powered by Gusto in the US pricing context (E5), and Xero's small business platform (E6) — but none of them name any owner, founder, executive, board or parent company of Xero.

**Context stated:** The evidence passages are region- and date-specific: E2, E3 and E4 are for the AU region in AUD as retrieved on 2026-09-14; E5 is for the US region in USD as retrieved on 2026-09-14; E1 and E6 are labelled Global as retrieved on 2026-09-14. None of the passages address corporate ownership or leadership. No instruction-like content was found in the passages.

**Reported as not established:** Who owns or runs Xero (founders, executives, board, parent company or any other governing body) / Whether any individual or organisation is named as responsible for Xero

**Retrieval:** terms [run, xero] → 6 of 58 passages (strong, coverage 1); E1=xero-about#8, E2=xero-accounting-software-au#2, E3=xero-accounting-software-au#9, E4=xero-accounting-software-au#1, E5=xero-pricing-us#10, E6=xero-about#6

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=answered|partial|insufficient
- pass — every claim verified against its citation: 0 supported, 0 weak, 0 unsupported, 0 uncited
- model: 1649 tokens, 2508ms

### `ho-public` — PASS

**Question typed:** "Is Xero a public company?"

**What this probes:** A yes/no question answered by the infobox.

**Status:** answered

**Answer:**

> Yes. Xero Limited is described as a public company, listed with the type "Public" and traded on the ASX under the ticker XRO, and it is a component of the S&P/ASX 200 (E1). The same passage identifies it as a New Zealand technology company providing cloud-based accounting software for small businesses (E1).

**Context stated:** Evidence is the English Wikipedia article on Xero (E1-E3, region stated as Global, retrieved 2026-09-14) and the Xero Australia about page (E4-E6, region stated as Global, retrieved 2026-09-14). The listing details in E1 do not specify a share price or market capitalisation, and no other exchange listings are given. No passage contained anything resembling an instruction to me.

**Retrieval:** terms [xero, public, company] → 6 of 58 passages (strong, coverage 1); E1=wikipedia-xero#0, E2=wikipedia-xero#2, E3=wikipedia-xero#4, E4=xero-about#6, E5=xero-about#8, E6=xero-about#9

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero Limited is a public company (listed with type "Public"). | wikipedia-xero#0 |
| supported | Xero is traded as ASX: XRO and is an S&P/ASX 200 component. | wikipedia-xero#0 |
| supported | Xero Limited has ISIN NZXROE0001S2. | wikipedia-xero#0 |
| supported | Xero Limited is a New Zealand technology company that provides cloud-based accounting software for small businesses. | wikipedia-xero#0 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial
- pass — citations: 1 citation(s)
- pass — every claim verified against its citation: 4 supported, 0 weak, 0 unsupported, 0 uncited
- model: 2316 tokens, 2370ms

## out-of-scope

_Reasonable questions the stored research simply does not cover._

### `ho-password` — PASS

**Question typed:** "How do I reset my Xero password?"

**What this probes:** A support question the research does not cover. Must not produce general how-to steps from model knowledge.

**Status:** insufficient

**Answer:**

> The supplied passages do not contain any information about resetting a Xero password. They cover Xero's accounting features for small businesses (E1, E6), payroll powered by Gusto and Xero Coach onboarding (E2), a general description of Xero's small business platform (E3), billing and data-security FAQs (E4), and a first-month-free offer on Xero plans (E5). None of them describes a password reset process, a forgotten-password link, or account recovery steps, so the question cannot be answered from this evidence.

**Context stated:** The passages are region- and currency-specific: E1 and E6 are Australia (AUD) pages retrieved 2026-09-14T08:30:19.118Z; E2 and E4 are United States (USD) pages retrieved 2026-09-14T08:30:18.157Z; E5 is an Australia (AUD) page retrieved 2026-09-14T08:30:17.319Z; E3 is a Global page retrieved 2026-09-14T08:34:17.583Z. No passage contained anything resembling an instruction addressed to the reader; the closest are ordinary marketing prompts such as 'Learn more about Xero coaches' (E2).

**Reported as not established:** How to reset a Xero password / Whether a self-service password reset or account recovery feature exists / Any steps, links or contact channels for recovering access to a Xero account

**Retrieval:** terms [reset, xero, password] → 6 of 58 passages (weak, coverage 0.333); E1=xero-accounting-software-au#13, E2=xero-pricing-us#10, E3=xero-about#6, E4=xero-pricing-us#12, E5=xero-pricing-au#7, E6=xero-accounting-software-au#12

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=insufficient|partial
- pass — every claim verified against its citation: 0 supported, 0 weak, 0 unsupported, 0 uncited
- pass — states what it could not establish: 3 unknown(s)
- model: 2174 tokens, 2785ms

### `ho-myob` — PASS

**Question typed:** "Is Xero better than MYOB?"

**What this probes:** A subjective comparison with no MYOB evidence stored.

**Status:** insufficient

**Answer:**

> The supplied passages do not establish whether Xero is better than MYOB. No passage compares the two products on features, pricing, usability or performance, and none states any quality, ranking or preference judgement between them. The only link drawn between the two companies is historical: Xero raised capital from investors including MYOB co-founder Craig Winkler during its early international expansion (E3). The remaining passages describe Xero itself — for example, that Xero helps small businesses, accountants and bookkeepers automate, collaborate and grow (E2), and that Xero has business plans with options for sole proprietors and larger businesses with staff, and lets users manage invoices, track expenses, connect bank accounts and prepare BAS returns (E4) — but say nothing about MYOB, so no comparison can be made from them.

**Context stated:** E4 applies to the AU region and AUD currency and was retrieved 2026-09-14T08:30:19.118Z; E2 and E6 are labelled region "Global" and E3 region "Global". Passages E1, E2 and E6 share the same retrieval date 2026-09-14T08:34:17.583Z; E3 was retrieved 2026-09-14T08:30:21.589Z and E5 (US, USD) 2026-09-14T08:30:18.157Z. E5 concerns Xero Payroll powered by Gusto and a Xero Coach offer free for the first 90 days in the US and does not mention MYOB. No passage contained anything resembling an instruction to the reader.

**Reported as not established:** Whether Xero is better than MYOB, or how the two compare on any dimension (features, pricing, usability, support, market position). / Any description of MYOB's products, pricing or capabilities. / Any customer satisfaction, review, rating or independent comparison data for either Xero or MYOB. / Xero's pricing plan amounts or tiers (no figures are given in the supplied passages).

**Retrieval:** terms [xero, better, myob] → 6 of 58 passages (strong, coverage 1); E1=xero-about#4, E2=xero-about#3, E3=wikipedia-xero#1, E4=xero-accounting-software-au#13, E5=xero-pricing-us#10, E6=xero-about#6

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | During its early international expansion, Xero raised capital from investors including MYOB co-founder Craig Winkler, Peter Thiel's Valar Ventures, Matrix Capital Management and Accel Partners. | wikipedia-xero#1 |
| supported | Xero helps small businesses, accountants and bookkeepers automate, collaborate and grow, powered by AI and a community of trusted global partners. | xero-about#3 |
| supported | Xero has business plans with options for sole proprietors and larger businesses with staff, and with Xero users can manage invoices, track expenses, connect business bank accounts and prepare accurate… [213 characters in total] | xero-accounting-software-au#13 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=insufficient|partial
- pass — every claim verified against its citation: 3 supported, 0 weak, 0 unsupported, 0 uncited
- pass — states what it could not establish: 4 unknown(s)
- model: 2465 tokens, 5156ms

### `ho-phone` — PASS

**Question typed:** "What's the phone number for Xero customer support?"

**What this probes:** Contact details are not in the evidence. A plausible-looking number would be a fabrication.

**Status:** insufficient

**Answer:**

> The supplied passages do not contain a phone number for Xero customer support. The only support-related statement is that customers can get "round the clock peace of mind with support from Xero experts" (E1), but no telephone number, contact channel or support hours detail is given. E4 contains customer testimonials praising Xero's support as quick to respond, but again no phone number.

**Context stated:** E1, E2 and E4 are from the Australian page (region AU, currency AUD) retrieved 2026-09-14; E3 and E5 are from Xero's About page (region listed as Global) retrieved 2026-09-14; E6 is from Wikipedia (region Global) retrieved 2026-09-14. None of the passages mention a phone number. Passage E5 ends with the stray word "hold", which appears to be leftover page content rather than text about Xero's support.

**Reported as not established:** The telephone number, if any, for Xero customer support. / Which support channels Xero offers (phone, chat, email) and their contact details. / Any region-specific support contact information.

**Retrieval:** terms [phone, number, xero, customer, support] → 6 of 58 passages (strong, coverage 1); E1=xero-accounting-software-au#4, E2=xero-accounting-software-au#6, E3=xero-about#7, E4=xero-accounting-software-au#0, E5=xero-about#1, E6=wikipedia-xero#0

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero states that customers can get round-the-clock peace of mind with support from Xero experts (as described on its Australian accounting software page). | xero-accounting-software-au#4 |
| supported | Customer testimonials on Xero's Australian accounting software page describe Xero's support as amazing, helpful and quick to respond. | xero-accounting-software-au#0 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=insufficient|partial
- pass — every claim verified against its citation: 2 supported, 0 weak, 0 unsupported, 0 uncited
- model: 2058 tokens, 2331ms

## follow-up

_Questions that only make sense after a previous one. The application keeps no conversation state, by design._

### `ho-followup-us` — PASS

**Question typed:** "What about in the US?"

**What this probes:** Only meaningful after an earlier question. With no conversation state, the answer should either cover US evidence generally or say what is ambiguous, without inventing the missing context.

**Status:** partial

**Answer:**

> Reading the question as being about Xero in the United States, the passages establish the following. Xero has offices in the United States, alongside New Zealand, Australia, the United Kingdom, Canada, South Africa and Singapore (E1). Xero's US pricing page (region US, currency USD, retrieved 14 September 2026) advertises 90% off a plan for the first 6 months when you buy by 30 September 2026 (E4), and states that new customers get 90% off for the first 6 months, after which Xero's regular price applies and auto-renews monthly until cancelled (E2). The offer is available until 30 September 2026 at 11:59pm UTC and is only available to customers in the United States purchasing their first organization on xero.com using code DC90626308US (E2). The discount applies to base Early, Growing and Established plan subscriptions and does not apply to any additional charges for add-ons, usage and payment fees unless otherwise specified, and Xero can change or cancel the offer at any time (E2). The Established plan is listed at $9 per month for the first 6 months, then $90 per month (E5). On payments, standard ACH payments are included in the Xero Early, Growing and Established plans, with fees… [2213 characters in total]

**Context stated:** The US passages are drawn from xero.com/us/pricing-plans, region US, currency USD, retrieved 2026-09-14, and prices are region- and time-specific (offer ends 30 September 2026 at 11:59pm UTC). E1 and E3 are from the Wikipedia article on Xero (Global region, retrieved 2026-09-14). Some US plan features are listed only as 'Included' on the page without further detail. No instruction-like content was found in the passages.

**Reported as not established:** The question 'What about in the US?' is not specific; the passages do not establish every US-related fact, only pricing/offer and product details from the US pricing pages plus Xero's US office presen… [229 characters in total] / US prices for the Early and Growing plans are not given in the passages; only the Established plan figures ($9 for the first 6 months, then $90 per month) appear. / The passages do not state US subscriber numbers, US revenue, or how US pricing compares with other regions. / The passages do not state whether the Xero Payroll (powered by Gusto) add-on or Xero Coach offer carries a price after the free period.

**Retrieval:** terms [united, state, america] → 6 of 58 passages (strong, coverage 1); E1=wikipedia-xero#0, E2=xero-pricing-us#4, E3=wikipedia-xero#2, E4=xero-pricing-us#0, E5=xero-pricing-us#1, E6=xero-pricing-us#10

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero has offices in the United States, as well as in New Zealand, Australia, the United Kingdom, Canada, South Africa and Singapore. | wikipedia-xero#0 |
| supported | Xero's US pricing page states that buyers get 90% off a plan for the first 6 months when they buy by 30 September 2026. | xero-pricing-us#0 |
| supported | New customers get 90% off for the first 6 months, after which Xero's regular price applies and auto-renews monthly until cancelled as described in Xero's Terms of Use. | xero-pricing-us#4 |
| supported | The 90% offer is available until 30 September 2026 at 11:59pm UTC. | xero-pricing-us#4 |
| supported | The offer is only available to customers in the United States purchasing their first organization on xero.com using code DC90626308US. | xero-pricing-us#4 |
| supported | The discount applies to base Early, Growing and Established plan subscriptions and does not apply to any additional charges for add-ons, usage and payment fees, unless otherwise specified. | xero-pricing-us#4 |
| supported | Xero can change or cancel this offer at any time, and the offer cannot be used with, or exchanged for, any other offer. | xero-pricing-us#4 |
| supported | The Established plan is priced at $9 per month for the first 6 months, then $90 per month. | xero-pricing-us#1 |
| supported | Standard ACH payments are included in the Xero Early, Growing and Established plans, with fees applying for other payment methods; included payments apply to standard ACH payments in USD and exclude s… [252 characters in total] | xero-pricing-us#4 |
| supported | Any payment fees are in addition to the Xero monthly subscription amount, are not eligible for subscription discounts and offers, and exclude applicable taxes. | xero-pricing-us#4 |
| supported | Invoice limits for the Early plan apply to both approving and sending invoices, and transactions initiated by app partners may automatically contribute to the invoice limit. | xero-pricing-us#4 |
| supported | Xero Payroll, powered by Gusto, is listed on the US pricing page as an optional add-on. | xero-pricing-us#1 |
| supported | Xero Payroll, powered by Gusto, lets users calculate and file payroll taxes, pay their team and keep up with compliance obligations without leaving Xero. | xero-pricing-us#10 |
| supported | A Xero Coach product specialist sets customers up, helps connect their banks and gets their dashboard ready, free for the first 90 days. | xero-pricing-us#10 |
| supported | In June 2025, Xero announced an agreement to acquire Melio, a New York-based payments provider, for $2.5 billion. | wikipedia-xero#2 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=partial, allowed=answered|partial|insufficient
- pass — every claim verified against its citation: 15 supported, 0 weak, 0 unsupported, 0 uncited
- model: 5010 tokens, 11231ms

### `ho-followup-pronoun` — PASS

**Question typed:** "And how much is it there?"

**What this probes:** Every word is a stopword, so nothing is searchable. Should be refused before any model call, with the could-not-search reason.

**Status:** insufficient

**Answer:**

> The question could not be searched: after removing punctuation and common words it left no searchable term. Retrieval is word-based and indexes English page text, so a question written in another script, or made only of emoji or common words, cannot be matched against the stored research. This says nothing about what the research contains. Please rephrase in English using specific words such as a plan name, a feature or a figure.

**Reported as not established:** And how much is it there?

**Retrieval:** terms [] → 0 of 58 passages (none, coverage 0); none

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=insufficient, allowed=insufficient
- pass — no model call was spent: model called = false
- model: not called

## noisy

_Typos, shouting, mixed languages: how real people type._

### `ho-shouting` — PASS

**Question typed:** "XERO PRICING!!!!"

**What this probes:** Capitals and punctuation must not affect retrieval.

**Status:** answered

**Answer:**

> The passages give plan prices for two regions only, both retrieved on 2026-09-14. On the US pricing page (USD, region US), the Early plan is listed at $2.50 per month, then $25 per month (E1), and the Established plan at $9 per month for the first 6 months, then $90 per month (E4). The same US page states that Xero subscription prices are increasing from October 1, 2026 (E1), that all prices are listed in USD and do not include applicable taxes (E1), and that the Early plan includes sending quotes and 20 invoices, 5 bills, bank transaction reconciliation, basic graphs and a 30 day cash flow forecast (E1). On the Australian pricing page (AUD, region AU), the Grow plan is listed at $7.80 per month, then $78 per month (E2), the Comprehensive plan at $10.70 per month, then $107 per month (E6), and the Ultimate 10 plan at $14.30 per month for the first 3 months, then $143 per month (E5). The Australian page states that prices are in AUD and include GST (E2). Australian plan inclusions shown include payroll for 2 people, a 60 day cashflow forecast and expenses and mileage claims for 1 user on Grow (E2); payroll for 5 people, a 90 day cashflow forecast and expenses and mileage claims for … [1708 characters in total]

**Context stated:** All figures are as retrieved on 2026-09-14. E1 and E4 are US pages (region US, currency USD); E2, E5 and E6 are Australian pages (region AU, currency AUD, GST-inclusive); E3 is an Australian page. US quotes exclude applicable taxes. E1 and E2 are fragmented comparison-table text, so several line items (for example the $36 a month + $6 per employee/contractor optional add-on, and the $5/$7 per additional user and $0.35 per additional bill payment charges) cannot be reliably assigned to a specific plan. No instruction-like content was found in the passages.

**Reported as not established:** Pricing for any region other than the US and Australia. / The duration of the introductory $2.50 per month Early price (US page) and the $7.80 per month Grow price (Australian page); the passages state the introductory rate but not its length. / Which plans the optional $36 a month + $6 per employee/contractor line item on the US page attaches to, and which plans the Australian per-user charges ($5, $7 per additional user) and $0.35 per addit… [259 characters in total] / Prices for payroll, expenses or projects beyond the included headcounts, and any fees for payment methods other than free ACH in the US. / Whether the October 1, 2026 price increase applies outside the US pricing page.

**Retrieval:** terms [xero, pricing] → 6 of 58 passages (strong, coverage 1); E1=xero-pricing-us#3, E2=xero-pricing-au#3, E3=xero-accounting-software-au#12, E4=xero-pricing-us#1, E5=xero-pricing-au#1, E6=xero-pricing-au#2

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | On the US pricing page, the Early plan is listed at $2.50 per month, then $25 per month. | xero-pricing-us#3 |
| supported | The Early plan includes sending quotes and 20 invoices, 5 bills, reconciling bank transactions, basic graphs for performance and a 30 day cash flow forecast. | xero-pricing-us#3 |
| supported | On the US pricing page, the Established plan is listed at $9 per month for the first 6 months, then $90 per month. | xero-pricing-us#1 |
| supported | Xero subscription prices are increasing from October 1, 2026, according to the US pricing page. | xero-pricing-us#3 |
| supported | US prices are listed in USD and do not include applicable taxes. | xero-pricing-us#3 |
| supported | On the Australian pricing page, the Grow plan is listed at $7.80 per month, then $78 per month. | xero-pricing-au#3 |
| supported | The Grow plan includes smart document capture with basic extraction, payroll for 2 people, a 60 day cashflow forecast, and expense and mileage claims for 1 user. | xero-pricing-au#3 |
| supported | On the Australian pricing page, the Comprehensive plan is listed at $10.70 per month, then $107 per month. | xero-pricing-au#2 |
| supported | The Comprehensive plan includes payroll for 5 people, a 90 day cashflow forecast, and expense and mileage claims for 5 users. | xero-pricing-au#2 |
| supported | On the Australian pricing page, the Ultimate 10 plan is listed at $14.30 per month for the first 3 months, then $143 per month. | xero-pricing-au#1 |
| supported | The Ultimate 10 plan includes payroll for 10 people, a 180 day cashflow forecast, expense and mileage claims for 10 users, and project tracking for 10 users. | xero-pricing-au#1 |
| supported | Australian prices are in AUD and include GST. | xero-pricing-au#3 |
| supported | Xero subscriptions auto-renew monthly until they are cancelled. | xero-pricing-us#3, xero-pricing-au#3 |
| supported | A customer who later decides to change to a less expensive plan can do so 1 month after upgrading. | xero-pricing-us#3, xero-pricing-au#3 |
| supported | Xero offers several plans to suit different business sizes and needs, with a 30-day free trial. | xero-accounting-software-au#12 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial
- pass — citations: 6 citation(s)
- pass — every claim verified against its citation: 15 supported, 0 weak, 0 unsupported, 0 uncited
- model: 5572 tokens, 13041ms

### `ho-typos` — PASS

**Question typed:** "how much is the grwo plan pirce"

**What this probes:** Misspelt key words. A lexical index cannot match 'grwo'. The expected outcome is an honest partial or insufficient answer, not a guess.

**Status:** answered

**Answer:**

> The evidence gives two different prices for the Grow/Growing plan, depending on region. In Australia (AUD), the Grow plan is listed at $7.80 per month, then $78 per month (E1); that passage also notes prices are in AUD and include GST, and that the plan includes features such as payroll for 2 people and a 60 day cashflow forecast (E1). In the United States (USD), the Growing plan is listed at $5.50 per month, then $55 per month (E6). Because these are two separate regional price lists retrieved on 2026-09-14, the price depends on which region and currency applies to you.

**Context stated:** Region and currency are material here: the Grow plan appears at $7.80 then $78 per month in the AU/AUD list retrieved 2026-09-14 (E1), and the Growing plan at $5.50 then $55 per month in the US/USD list retrieved 2026-09-14 (E6). Both are as retrieved on those dates, and the US passage (E2) notes a price increase from October 1, 2026. Passage E6 itself does not restate the currency, but it is drawn from the same US pricing page retrieved on the same date as E2, which states prices are in USD.

**Reported as not established:** Which region's plan the user is asking about, since the question did not specify a country or currency. / Any prices for the Grow/Growing plan in regions other than Australia and the United States.

**Retrieval:** terms [grwo, plan, pirce] → 6 of 58 passages (weak, coverage 0.333); E1=xero-pricing-au#3, E2=xero-pricing-us#3, E3=xero-pricing-au#1, E4=xero-pricing-au#2, E5=xero-pricing-us#1, E6=xero-pricing-us#2

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | In the Australia (AUD) price list, the Grow plan is listed at $7.80 per month, then $78 per month. | xero-pricing-au#3 |
| supported | The Australian Grow entry states prices are in AUD and include GST, and that Xero reserves the right to change pricing at any time. | xero-pricing-au#3 |
| supported | The Australian Grow plan includes payroll for 2 people and a 60 day cashflow forecast. | xero-pricing-au#3 |
| supported | In the United States (USD) price list, the Growing plan is listed at $5.50 per month, then $55 per month. | xero-pricing-us#2 |
| supported | The US price list states that Xero subscription prices are increasing from October 1, 2026, and that all prices are listed in USD and do not include applicable taxes. | xero-pricing-us#3 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial|insufficient
- pass — every claim verified against its citation: 5 supported, 0 weak, 0 unsupported, 0 uncited
- model: 2946 tokens, 3988ms

### `ho-mixed-language` — PASS

**Question typed:** "Xero 的 Grow 套餐多少钱"

**What this probes:** The English words survive tokenisation, so this should still retrieve the Grow plan and answer.

**Status:** answered

**Answer:**

> 根据检索到的 Xero 澳大利亚定价页面（Grow 部分），Grow 套餐显示的价格为每月 $7.80，随后为每月 $78（E6）。该页面注明价格以 AUD 计价并包含 GST，且 Xero 保留随时更改价格的权利，订阅按月自动续订直至取消（E6）。同一网站的促销说明还提到，新客户前 3 个月可享 90% 折扣，之后适用 Xero 的常规价格并按月自动续订直至取消；此优惠仅适用于在 xero.com 上购买其首个组织的澳大利亚客户，有效期至 2026 年 9 月 30 日 AEST 晚上 11:59，使用代码 DC9032619AU（E5）。该折扣适用于基础 Ignite、Grow、Comprehensive、Ultimate 或 Ultra 套餐订阅（E5）。

**Context stated:** 价格来自 Xero 澳大利亚网站（region=AU，currency=AUD），检索日期为 2026-09-14；价格和优惠仅适用于该地区及该时间点，且 Xero 声明可随时更改价格或取消优惠。证据 E1、E2、E3、E4 未包含 Grow 套餐价格信息。

**Reported as not established:** 其他地区（澳大利亚以外）的 Grow 套餐价格，因为提供的证据仅针对澳大利亚区域和 AUD 货币 / 证据未明确说明 $7.80 是否即为前 3 个月 90% 折扣后的金额，也未给出折扣期结束后具体的常规月费数额 / Grow 套餐中各功能（如发票限额、附加用户费用）的具体定价细节在所提供的证据中未完整列出

**Retrieval:** terms [xero, grow] → 6 of 58 passages (strong, coverage 1); E1=xero-accounting-software-au#10, E2=xero-about#3, E3=xero-pricing-au#5, E4=xero-about#2, E5=xero-pricing-au#4, E6=xero-pricing-au#3

| Verdict | Claim | Cites |
| --- | --- | --- |
| supported | Xero 澳大利亚定价页面的 Grow 部分列出的价格为每月 $7.80，随后为每月 $78（E6） | xero-pricing-au#3 |
| supported | 该页面上的价格以 AUD 计价并包含 GST，Xero 保留随时更改价格的权利（E6） | xero-pricing-au#3 |
| supported | Xero 订阅按月自动续订，直至被取消（E6） | xero-pricing-au#3 |
| supported | 新客户前 3 个月可享 90% 折扣，之后适用 Xero 的常规价格并按月自动续订直至取消（E5） | xero-pricing-au#4 |
| supported | 该优惠仅适用于在 xero.com 上购买其首个组织的澳大利亚客户，有效期至 2026 年 9 月 30 日 AEST 晚上 11:59，使用代码 DC9032619AU（E5） | xero-pricing-au#4 |
| supported | 该折扣适用于基础 Ignite、Grow、Comprehensive、Ultimate 或 Ultra 套餐订阅，不适用于附加组件、用量和支付费用的额外收费，除非另有说明（E5） | xero-pricing-au#4 |
| supported | 该优惠不能与其他任何优惠同时使用或兑换，Xero 可随时更改或取消该优惠（E5） | xero-pricing-au#4 |

**Checks:**

- pass — no source fetched while answering: 0 fetch(es)
- pass — status: status=answered, allowed=answered|partial
- pass — citations: 2 citation(s)
- pass — every claim verified against its citation: 7 supported, 0 weak, 0 unsupported, 0 uncited
- model: 3354 tokens, 7226ms

