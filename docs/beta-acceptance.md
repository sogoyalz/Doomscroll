# Opt-in beta acceptance criteria

These criteria are specified before collecting multi-user beta results. They
are operational release checks, not evidence of reduced scrolling or a health
benefit. Status: **not run**.

## Cohort and privacy

Use at least five consenting adult desktop users for two weeks. Interventions
stay off unless a participant explicitly enables them after a valid baseline
exists. Participants use their normal feeds; do not ask anyone to seek upsetting
content to trigger an alert. Collect no account credentials, message contents,
captions, creator handles, reel IDs, screenshots of feeds, or raw viewing exports.
Participants retain their local histories and may stop or delete them at any time.

Share only the extension/browser version, locale/layout, aggregate observation
counts, failure category, and whether a gate passed. Keep the participant key
anonymous and outside Git. Do not commit any raw participant files here.

## Operational pass criteria

| Check                 | Evidence required                                            | Pass criterion                                                                     |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Capture               | Independently count at least 50 qualifying views per user    | At least 95% reconciled; explain every mismatch before release                     |
| Identity              | Compare visible reel transitions with diagnostic rows        | Zero observed attribution swaps or unexplained duplicates                          |
| Extraction            | At least 20 visibly attributed examples per supported layout | At least 90% resolve author/audio when those fields are visibly present            |
| Privacy               | Pause/resume, Direct, Accounts, delete, restart              | Zero observation/recording violations or resurrected deleted views                 |
| Delivery              | Backgrounding, restart, recovery, repeated acknowledgement   | No double-counted views; failures visible and pending copies recover or expire     |
| Intervention controls | Opted-in users with valid baselines                          | No intervention while off/on a break; no failed dismissal or navigation            |
| Usability             | Record relevant/helpful versus irrelevant reports locally    | Review every unwanted interruption; unresolved repeated false alerts fail the gate |

Any unexplained privacy violation, broken dismissal, data corruption, or identity
swap blocks release regardless of average percentages. Fix the defect and rerun
its affected scenarios. Record unsupported layouts/locales explicitly rather
than averaging them away.

## Classifier and product claims

Ask willing participants to label examples independently without seeing the
classifier's prediction. Keep raw examples local. Report per-category sample
support and precision/recall only as exploratory results; small categories do
not establish general accuracy. No beta pass should be described as proof that
breaks reduced scrolling. That claim needs a separately designed effectiveness
study and must not be inferred from “accepted” or “no early end recorded”.

## Result record

Record dates, candidate commit/archive SHA-256, number of consenting testers,
browser/layout coverage, each gate's denominator and result, every unresolved
defect, and the final reviewer decision in a sanitized summary. Do not replace
“not run” with “passed” until this evidence exists.
