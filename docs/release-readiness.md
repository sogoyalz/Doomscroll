# Release readiness: 1.1.2 candidate

This is a release candidate. Automated checks validate controlled inputs and
packaged browser behavior. They cannot certify the current live Instagram DOM,
classifier quality across people and languages, or behavior change.

## November 24 repair and package recheck

The local 1.1.2 candidate is 73,874,166 bytes. Two independent builds produced SHA-256 `3d67a53dbc75c194df3432def654b9e03f8d0c2c0d8464a28a47f3981c5c7417`. The ZIP passed an integrity check. This digest identifies a working-tree build based on `011a9f8`.

| Check | Result |
| --- | --- |
| Static and unit checks | TypeScript and ESLint passed, including release scripts. All 903 tests passed across 40 suites. |
| Packaged browser checks on macOS | All 20 tests passed on Chrome for Testing 116.0.5845.96 and all 20 passed on Chromium 156.0.8078.4. Both ran the bundled model offline. |
| Timer on an unseeded budget | Current Chromium displayed the in-page reminder after a real minute of focused viewing and accepted a five-minute snooze. |
| Privacy and durability | Regression tests paused or deleted history with classification outstanding, rejected old diagnostics, retried a failed timer write, and preserved aggregate work after a partial failure. |
| Capture and review | Tests cover a hidden tab closing without resuming, capture-day minutes across midnight, migration of prior history, blind first-pass labels and CSV export through Settings. |
| Archive and dependency checks | One packaged WASM binary, canonical Instagram host access, zero known vulnerabilities reported by npm audit, and passing Git history and working-tree sensitive-data checks. |
| Fictional holdout | Rules classified 42 of 48 examples correctly. Rules plus model classified 46. Both classified one of two anxious examples correctly. |

In a disposable profile with 45,000 synthetic views, 12 popup navigations with a warm worker took 54–296 ms to render the headline. Median was 108 ms. The Settings export completed in 1.11 seconds and produced 10,035,917 bytes. The measurements cover this machine and fixture. Low-end frame timing, peak memory and cold-worker percentiles remain open.

**Public launch remains on hold.** The signed-in Instagram layout matrix, independent labels from multiple people, unwanted-prompt rates, native OS notification visibility and assistive-technology trials still require live acceptance. Keep the earlier review as the record of the defects before repair. Its ZIP digest belongs to the previous build.

## Automated release gates

Run `npm ci` with Node 22.12+ (or Node 24+) and then `npm run verify`.
Install the test browser first with `npx playwright install chromium`.

- Strict TypeScript, lint, unit and integration tests.
- Actual IndexedDB migration from schema 4 to schema 6.
- A 20-reel streak reaches the delayed intervention with the default 15-reel
  dominance window. Unreadable reels do not truncate the counted streak.
- Detection windows and streaks do not cross session boundaries.
- Duplicate and concurrent message delivery count a view exactly once.
- Pending views survive a delivery failure and are replayed without sending
  interruptions to a tab that may have changed. Pending copies expire after
  24 hours and are removed on pause or history deletion.
- A full browser shutdown/relaunch recovers queued views exactly once, restores
  missing maintenance alarms, and rejects pre-deletion views after another restart.
- A pause or deletion establishes a cutoff so delayed earlier views cannot
  reappear after tracking resumes.
- The actual ZIP is extracted into a clean profile and loads in Chromium; real content scripts extract and
  store synthetic reels; the block delay expires and permits dismissal.
- Accepting a break navigates away and returning shows the reminder. Export
  contains the recorded views and deletion removes persisted events.
- Privacy exclusions apply to SPA navigations into Direct and Accounts.
- Full-history private-file guard, Gitleaks, dependency audit, and packaging.
- CI independently builds the release twice and compares archive bytes. ZIP
  ordering, timestamps, permissions, and host metadata are normalized.

Browser integration tests use an isolated profile and synthetic HTML served at
a mocked Instagram URL. They never log into Instagram or use personal data.
No source-map, browser profile, test result, or private export belongs in a
release archive.

### Desktop reminder checks for the next release

1. On a fresh install, use **Settings → Interventions → Test desktop notification**.
   The sample should work with permission before a viewing baseline exists. Declining
   permission should leave automatic reminders, history and cooldowns alone.
2. With a valid baseline and reminders enabled, verify that a qualifying run reaches
   Chrome's notification list once. The packaged browser test exercises this path
   with a previously granted optional permission and synthetic reels.
3. During the live beta, confirm the native permission prompt and whether a banner
   or Notification Center entry appears on the tester's desktop. Record the OS,
   Chrome version and Focus or Do Not Disturb setting if Chrome accepts a notification
   but the tester cannot see it. Browser API acceptance alone cannot verify visibility.

## Live acceptance gate — partially verified

The installed candidate now passes a [ten-view live capture smoke sample](live-capture-2026-10-30.md), with ten fiber-derived IDs and an exact capture-counter increase. A follow-up
ten-view sample also received ten successful worker save acknowledgements with
zero skips or unconfirmed deliveries. Independent popup-count reconciliation was skipped at the project owner’s
request on 30 October 2026 and remains unverified. The remaining live matrix
below is still pending.

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
with stored views. The diagnostic panel now separates captured views from
worker-confirmed saves, deliberate discards, and unconfirmed delivery. Packaged
browser tests reconcile these acknowledgements with IndexedDB; this does not
replace the pending live check. Investigate every unexplained identity swap, duplicated
view, lost completed view, interruption during a pause, or failed dismissal.
Audio must resolve on reels with visible readable attribution. Zero extracted
audio across such a sample is a failed gate, regardless of unit-test results.

## Beta acceptance gate — pending

The predeclared [beta acceptance criteria](beta-acceptance.md) specify the
cohort, privacy rules, operational thresholds, and result record. No multi-user
results have been collected yet.

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
