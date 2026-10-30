# Doomscroll

A local Chrome extension that tracks Instagram Reels watch time and flags an
unusually repetitive pattern in the text-derived categories of your feed.
It describes content, not your mood. No account, server, or telemetry.

**Status: 1.1.0 release candidate.** Automated checks cover application logic
and the packaged extension against synthetic browser fixtures. Live Instagram
acceptance testing and a multi-user beta remain release gates. See
[release readiness](docs/release-readiness.md).

## Run it

Requires Chrome 111+ and Node 22.12+ or Node 24+ for development.

```sh
npm ci
npm run build
```

In `chrome://extensions`, enable Developer mode and load **`dist/`**, not the
repository root. Rebuild and reload the extension after source changes, then
refresh any open Instagram tabs so they use the updated content scripts.

Use the clean checkout based on GitHub's current history. A legacy clone can
contain private files in deleted commits even when its current files look
clean. Enable the local push guard:

```sh
git config core.hooksPath .githooks
```

## What it does

- Records completed views, visible watch time, categories, and sessions.
- Shows daily totals, category mix, trends, creators, and session details.
- Classifies caption text, hashtags, and audio attribution with local rules:
  seven charged categories, thirteen topics, and neutral. Text-free reels
  remain unclassified.
- Compares a session's recent category mix with a recency-weighted personal
  baseline over the previous fourteen days. At least seven baseline days and
  minimum samples are required. Today is excluded from the baseline.
- Optionally offers a notification, an overlay, and an overlay with a
  ten-second dismiss delay. Interventions ship off. They require both an
  unusual pattern and the configured classified-reel streak (defaults 5/10/20),
  with per-session limits and cooldowns. Unreadable reels do not extend or
  break a classified streak. Streak counting is independent of window size.
- Accepting a break leaves the feed and stores a fifteen-minute reminder.

## Privacy and reliability

History stays in IndexedDB; settings and small operational records stay in
Chrome local storage. Raw events and logs are pruned after ninety days; daily
summaries remain until deleted. Completed views are queued locally before
message delivery. Pending copies expire after twenty-four hours and are
removed on pause or deletion. Replays are deduplicated and never interrupt
an unrelated tab. If both local storage and messaging fail, or a page closes
before a view can be queued, that view can still be lost.

Tracking can be paused; history can be exported or deleted. Direct and Accounts
are excluded on fresh loads and SPA navigation. There is no observation of
mobile Instagram or other devices. Read the [privacy policy](PRIVACY.md) and
[private-data safeguards](docs/security.md). Exported history is sensitive;
keep it outside this repository.

Intervention history records decisions and responses. “No early end recorded”
is absence of an early-ending report, not proof of a successful break.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run verify
npm audit
npm run security:check
```

`npm run verify` also builds, packages, and runs real Chromium integration tests
using synthetic HTML and temporary profiles. CI runs these checks and scans
history for secrets/private exports. The zip contains only the built extension.

The integration suite exercises the complete storage/classification/detection/
intervention path, all default intervention levels, idempotent retries, session
isolation, replay/deletion, and schema upgrades. Browser fixtures test actual
content scripts, local extension messaging, UI controls, and dismissal behavior.
Fixtures cannot prove Instagram's current selectors still match.

## Limits

Instagram DOM and React internals can change without notice. Extraction health
helps diagnose failures, but an instrumented live session is required before
release. Audio extraction previously failed across a real sample; do not assume
synthetic fixture success resolves that until live attribution is verified.

Text-only rules cannot understand visual content, sarcasm, or every language.
An early single-person evaluation had small samples for several charged
categories; it does not establish accuracy for other people. The adaptive
baseline can absorb a sustained shift. No evidence currently establishes that
these interventions reduce scrolling or improve well-being.

Do not add a new classifier or more dashboards until these limits have been
measured against the [live protocol](docs/live-session-protocol.md) and beta gates.
