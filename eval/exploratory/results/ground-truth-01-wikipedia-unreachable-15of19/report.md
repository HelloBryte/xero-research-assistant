# Ground-truth check against the live pages

**Run:** 2026-09-14T10:02:51.741Z

Each URL is fetched directly and tag-stripped by this script, not by src/extract.ts, so the check is independent of the extraction code it is checking.

| Verdict | Meaning |
| --- | --- |
| confirmed | the fact is on the live page and in the stored research |
| stored-only | the stored copy has it but the live page no longer does: the page changed since retrieval |
| live-only | the page has it but extraction dropped it: an extraction gap |
| missing | neither: the fact pattern needs revisiting |

## Pages fetched

| Source | URL | HTTP | Stored copy retrieved |
| --- | --- | --- | --- |
| xero-pricing-au | https://www.xero.com/au/pricing-plans/ | 200 | 2026-09-14T08:30:17.319Z |
| xero-pricing-us | https://www.xero.com/us/pricing-plans/ | 200 | 2026-09-14T08:30:18.157Z |
| xero-about | https://www.xero.com/about/ | 200 | 2026-09-14T08:34:17.583Z |
| wikipedia-xero | https://en.wikipedia.org/wiki/Xero_(company) | fetch failed | 2026-09-14T08:30:21.589Z |
| xero-accounting-software-au | https://www.xero.com/au/accounting-software/ | 200 | 2026-09-14T08:30:19.118Z |

## Result: 15/19 confirmed (4 stored-only, 0 live-only, 0 missing)

| Verdict | Source | Fact quoted by an answer |
| --- | --- | --- |
| confirmed | xero-pricing-au | Grow is listed at $7.80 per month for the first 3 months |
| confirmed | xero-pricing-au | Grow reverts to $78 per month |
| confirmed | xero-pricing-au | Comprehensive reverts to $107 per month |
| confirmed | xero-pricing-au | Ultimate 10 reverts to $143 per month |
| confirmed | xero-pricing-au | prices are in AUD and include GST |
| confirmed | xero-pricing-au | the new-customer offer is 90% off for the first 3 months |
| confirmed | xero-pricing-au | Grow includes payroll for 2 people |
| confirmed | xero-pricing-us | Early reverts to $25 per month |
| confirmed | xero-pricing-us | Growing reverts to $55 per month |
| confirmed | xero-pricing-us | Established reverts to $90 per month |
| confirmed | xero-pricing-us | US prices are listed in USD |
| confirmed | xero-pricing-us | the US offer runs for the first 6 months |
| confirmed | xero-about | Xero serves 5 million customers |
| confirmed | xero-about | in 180+ countries |
| stored-only | wikipedia-xero | founded on 6 July 2006 |
| stored-only | wikipedia-xero | founded in Wellington, New Zealand |
| stored-only | wikipedia-xero | founded by Rod Drury and Hamish Edwards |
| stored-only | wikipedia-xero | listed on the ASX as XRO |
| confirmed | xero-accounting-software-au | Xero is ATO-certified for Single Touch Payroll |

