# Release readiness: 1.1.0 candidate

This is a release candidate. Automated checks validate controlled inputs and
packaged browser behavior. They cannot certify the current live Instagram DOM,
classifier quality across people and languages, or behavior change.

## Automated release gates

Run `npm ci` with Node 22.12+ (or Node 24+) and then `npm run verify`.
Install the test browser first with `npx playwright install chromium`.

- Strict TypeScript, lint, unit and integration tests.
- Actual IndexedDB migration from schema 4 to schema 5.
- A 20-reel streak reaches the delayed intervention with the default 15-reel
  dominance window. Unreadable reels do not truncate the counted streak.
- Detection windows and streaks do not cross session boundaries.
- Duplicate and concurrent message delivery count a view exactly once.
- Pending views survive a delivery failure and are replayed without sending
  interruptions to a tab that may have changed. Pending copies expire after
  24 hours and are removed on pause or history deletion.
- A pause or deletion establishes a cutoff so delayed earlier views cannot
  reappear after tracking resumes.
- The actual ZIP is extracted into a clean profile and loads in Chromium; real content scripts extract and
  store synthetic reels; the block delay expires and permits dismissal.
- Accepting a break navigates away and returning shows the reminder. Export
  contains the recorded views and deletion removes persisted events.
- Privacy exclusions apply to SPA navigations into Direct and Accounts.
- Full-history private-file guard, Gitleaks, dependency audit, and packaging.

Browser integration tests use an isolated profile and synthetic HTML served at
a mocked Instagram URL. They never log into Instagram or use personal data.
No source-map, browser profile, test result, or private export belongs in a
release archive.

## Live acceptance gate — pending

A limited [live layout smoke check](live-check-2026-10-30.md) found and verified
fixes for zero-height wrappers and duplicate audio links. It does not replace
the acceptance session below.

Follow `docs/live-session-protocol.md` using a consenting tester's local browser.
Record the date, extension version, browser version, layout/locale, and sample
size. Keep captions, handles, screenshots, and exports private.

Required coverage: normal and fast scrolling; text and audio extraction;
container recycling; Reels and Explore entry; profile navigation; Direct and
Accounts navigation; backgrounding and returning; browser restart; pause and
resume; export and deletion; notification permission denied; each intervention
level; accepting a break; returning during and after a break.

For each session, reconcile an independently counted sample of completed views
with stored views. Investigate every unexplained identity swap, duplicated
view, lost completed view, interruption during a pause, or failed dismissal.
Audio must resolve on reels with visible readable attribution. Zero extracted
audio across such a sample is a failed gate, regardless of unit-test results.

## Beta acceptance gate — pending

Run a small opt-in beta for at least two weeks of normal desktop use across
several people. Review false alerts, missed patterns reported by testers,
extraction failures, save failures, alert dismissals, and voluntary break
responses. Collect only consented, minimized summaries outside the extension;
there is no telemetry backend. Set and record acceptance criteria before
collecting results, then record whether they passed.

An early single-person classifier evaluation is exploratory. Do not advertise
its overall accuracy as a general-user guarantee. Increase independent labels
for the charged categories and report per-category support, precision, and
recall. Do not use classifier-generated labels as ground truth.

## Public release gate — pending

- Complete the live and beta gates; attach a dated, sanitized result summary.
- Review privacy policy and store listing against the final build.
- Store screenshots: complete, using disclosed synthetic data in `store-assets/`.
- Build the final zip from a clean GitHub-based checkout after CI passes.
- Record commit SHA, version, archive SHA-256, supported environment, and rollback
  plan. A rollback containing code changes still needs a higher store version;
  do not downgrade a browser profile's IndexedDB schema.

Do not mark these manual gates passed merely because a build or test suite is green.
