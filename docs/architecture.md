# Architecture

Chrome MV3 extension on Vite + `@crxjs/vite-plugin`, React for the UI,
IndexedDB (via `idb`) for reel history.

Build phases: (1) shell + DOM research, (2) detection/tracking, (3) storage,
(4) aggregation, (5) classification, (6) pattern detection, (7) intervention
+ UI, (8) testing/resilience/packaging. All eight are built. The intervention
ladder ships **off**, and its switch stays disabled until enough history exists
for a baseline.

This file is the map. [`INTERNALS.md`](INTERNALS.md) is the territory — every
constant, the scoring and baseline maths, the failure modes, and what the
system can and cannot determine.

## Guarding the DOM layer

The scraper is the least stable part of the system and the ongoing cost of
owning it. Two independent guards, because they fail differently:

- **Fixture tests** (`tests/fixtures/reelFeed.js`) pin the structure we know
  about, including every null case observed live. One test strips all class
  names and asserts extraction still works, which fails loudly if any selector
  starts depending on Meta's per-deploy generated classes.
- **Runtime drift detection** (`shared/health.ts`) watches whether the author
  handle resolves. It is the one field documented as present on every real
  reel, so captions, hashtags, and audio going missing is normal while the
  author going missing is evidence the markup moved. Options warns on it.

Fixtures cannot catch production drift and drift detection cannot catch a
regression before release, so both are needed.

## Reel capture flow

```
instagram.com
      │
      ├─ content/main-world.ts        MAIN world — the only place React fiber
      │                               props are reachable. Resolves each
      │                               container's shortcode and republishes it
      │                               as data-doomscroll-shortcode.
      ▼
┌───────────────────────────────────────────────┐
│ content/index.ts         isolated world       │
│  ├─ dom.ts          find containers; active   │
│  │                  reel = straddles the      │
│  │                  viewport midpoint         │
│  ├─ detector.ts     dwell clock; excludes     │
│  │                  hidden time AND time      │
│  │                  spent under an overlay    │
│  ├─ extractor.ts    caption / hashtags /      │
│  │                  audio / author / identity │
│  ├─ session.ts      session id + gap rule     │
│  ├─ overlay.ts      prompt / soft block /     │
│  │                  break reminder            │
│  ├─ navigate.ts     the one place the page    │
│  │                  is sent somewhere         │
│  └─ hud.ts          live diagnostic panel     │
└───────────────────────────────────────────────┘
      │  ▲
      │  │  chrome.tabs.sendMessage INTERVENE
      │  │  (the only worker → page message)
      │  │
      │  └──────────────────────────────────────┐
      │                                         │
      │  chrome.runtime.sendMessage             │
      │  REEL_VIEW_LOGGED (NewReelEvent)        │
      ▼                                         │
┌───────────────────────────────────────────────┴─┐
│ background/index.ts      never touches the page  │
│  ├─ typed message router                         │
│  ├─ db.ts          IndexedDB: reelEvents,        │
│  │                 sessions, dailyAggregates,    │
│  │                 detectionLog, interventionLog │
│  ├─ classify.ts    engine dispatcher             │
│  ├─ reclassify.ts  re-label on lexicon bump      │
│  ├─ detect.ts      pattern detection; always     │
│  │                 logs, acts only if enabled    │
│  ├─ intervene.ts   the ladder, cooldowns, breaks │
│  ├─ aggregator.ts  daily rollups, dirty-day      │
│  │                 flush on a throttled alarm    │
│  └─ alarms         daily retention prune         │
└──────────────────────────────────────────────────┘
      │  read back through the typed shared/client.ts
      ▼
┌───────────────────────────────────────────────┐
│ popup/    today's stats, category mix,        │
│           30-day charged-share trend          │
│ options/  tuning, detection log, day bars,    │
│           sessions, creators, interruption    │
│           effectiveness, extraction health    │
└───────────────────────────────────────────────┘
```

## UI copy

The dashboard describes the **content the feed served**, never the person
watching. "Breakup content was 70% of what you were shown" is a claim about
Instagram and is supportable. "You seem heartbroken" is a claim about the
user, and nothing here can support it — someone perfectly fine can trip the
detector by falling into an algorithmic loop.

Unclassified reels are surfaced rather than hidden: the popup labels them
"no text" and says so explicitly when they are the majority, because that is
the honest reason a day may look uneventful.

## Storage

| Store | Key | Holds |
|---|---|---|
| `reelEvents` | `id` | One finished view. Indexed by `startedAt` and `sessionId`. |
| `sessions` | `id` | Rolling totals, updated in the same transaction as the event. |
| `dailyAggregates` | `YYYY-MM-DD` | Per-day rollups. Local-time buckets. |
| `detectionLog` | `id` | Every pattern-detection decision, fired or not. |
| `interventionLog` | `id` | Every interruption, and what the user did about it. |

Settings live in `chrome.storage.local`, not IndexedDB: they are one small
object, they fire change events the UI can subscribe to, and they survive
`CLEAR_DATA`, which only wipes tracked history.

Raw reel history is pruned after 90 days by a daily alarm. Daily aggregates
are kept — they are small, and the trailing baseline pattern detection
compares against is more useful the further back it reaches.

## Aggregation

Aggregates are **materialized, not computed on read**: raw events are pruned
at 90 days and the aggregates outlive them, so a day never rolled up is lost
once its events age out. The prune alarm flushes pending rollups before
deleting anything.

Recomputing on every reel would mean a write per scroll, so days are marked
dirty and flushed on a throttled alarm — throttled rather than debounced, so a
burst of reels produces one flush a minute later rather than one that keeps
receding while you keep scrolling. The dirty set lives in
`chrome.storage.local`, not module scope — MV3 kills the worker after ~30s
idle, so in-memory state is gone by the time the alarm fires. `GET_STATS`
recomputes today on demand, so the dashboard is never stale mid-session.

Unclassified reels are counted under their own key, never folded into
`neutral`. Neutral means the classifier looked and found nothing charged;
unclassified means nothing has looked yet. Collapsing them would let a day of
unreadable reels pass as a genuinely calm one and would poison the baseline.

## Classification

Local keyword rules over caption text, hashtags, and audio name. Runs on the
write path — the engine is pure and synchronous, so there is no reason to
store an unlabelled event and revisit it.

Weighting reflects how deliberate each signal is: a hashtag is an authorial
label (×3), a caption phrase is written prose (×2), a caption word is weakest
(×1), and audio counts at half weight because the user did not choose the
song's title. Confidence combines how strong the winning score is with how far
clear of the runner-up it sits, so a reel matching two categories equally is
reported as ambiguous rather than as a confident read of either.

Ties are broken by `TIE_BREAK_ORDER` in `lexicon.ts`, most specific first.
**That order is behaviour, not presentation** — reordering it changes
classification outcomes.

Events retain the caption, hashtags, and audio name they were scored from, so
the lexicon can be tuned without discarding history: bump `LEXICON_VERSION`
and stored events are re-scored and their aggregates rebuilt on next load.

`local-ml` and `cloud-llm` modes exist in the settings type but fall back to
the rules engine. Each is its own accuracy and privacy surface and is out of
v1 scope.

## Pattern detection

Runs after every classified reel and always writes a log entry, whether or not
anything is allowed to act on it. That separation is what made a log-only
staging period possible, and it is kept now that the ladder exists: detection
observes, `intervene.ts` decides separately whether to speak, and it does
nothing at all unless `interventionEnabled` is on — which it is not by default.

A flag requires both dominance in the recent window *and* a multiple of the
user's own trailing rate for that category. Dominance alone would false-flag
anyone whose ordinary diet runs heavy in a category, which is the failure mode
the baseline exists to prevent.

Three deliberate constraints:

- **The baseline excludes today.** The session being judged must not raise the
  bar it is judged against.
- **No cold-start fallback.** Under `MIN_BASELINE_DAYS` the detector refuses
  and records `insufficient-history`. A fixed threshold in the gap would
  reintroduce exactly the false positives the baseline prevents.
- **Unclassified reels leave the denominator.** Otherwise an identical run of
  sad reels would cross or miss the threshold depending on how much text-free
  content sat between them.

Streaks are not broken by unclassified reels: a text-free clip mid-run is not
evidence the run ended, and counting it as a break would make streak length
depend on how readable the feed happens to be.

Every evaluation is logged with its inputs, near-misses included, because a
week of `reason` values is how the thresholds get checked against one real
person's scrolling before anything is allowed to act on them.

## Shared modules

| File | Purpose |
|------|---------|
| `src/shared/types.ts` | `ReelEvent`, `Session`, `DailyAggregate`, `UserSettings` |
| `src/shared/messages.ts` | Typed `chrome.runtime` message routes — the extension's whole API surface |
| `src/shared/taxonomy.ts` | Two-tier taxonomy: charged + topic categories |
| `src/shared/defaults.ts` | `DEFAULT_SETTINGS` |

## Design decisions

- **The URL cannot identify a reel.** `location.pathname` does not change
  while scrolling; it names only the reel the page was opened on. Reel
  identity comes from React fiber props, which requires the MAIN-world
  bridge. See [`dom-notes.md`](dom-notes.md) §6 — this is the single most
  fragile dependency in the extension and is treated as best-effort, with an
  `author|video-basename` fallback.
- **Active reel is geometric.** The container straddling the viewport
  midpoint. `video.paused` / `video.currentTime` are useless here — every
  mounted video reads `paused: true, currentTime: 0` regardless of what is on
  screen.
- **Caption text is snapshotted on activation**, not at completion. The feed
  is virtualized, so a finished reel's container may already hold the next
  reel's content.
- **The document does not scroll.** Scrolling happens in a nested div, so
  scroll listeners bind there, and `MutationObserver` is scoped to it rather
  than `document.body`.
- **The dwell tracker is a pure state machine** driven by an injected clock,
  so watch-time rules are unit-testable without stubbing browser observers.
- **Never select on Meta's generated class names** (`x1lliihq`, …). Every
  selector is anchored on `aria-label`, `dir`, `role`, or an `href` prefix.
- **The taxonomy is closed-ended and two-tier.** *Charged* categories (sad,
  breakup, anxious, angry, joyful, motivational, romantic) are emotional
  registers and are the only ones detection acts on. *Topic* categories
  (comedy, food, sports, music…) exist to name the rest of the feed so
  ordinary content does not fall into `neutral` — without them a normal reels
  feed is ~70% neutral. Detection measures dominance among **charged reels
  only** (`chargedShares` in `patterns.ts`); topics and neutral leave that
  denominator the same way `unclassified` always has, so a real breakup loop
  is not hidden by a feed that is mostly comedy.
- **Classifier accuracy is measured, not asserted.** `scripts/eval.mjs` runs
  the real `classify()` over a hand-labeled CSV and reports accuracy, per-
  category precision/recall, the neutral rate, and a confusion matrix. Every
  lexicon change is judged by its effect on that benchmark. Bump
  `LEXICON_VERSION` after editing the lexicon and stored history re-labels
  itself on reload.
- **Intervention ships off by default.** A trailing baseline does not exist in
  week one, and substituting a fixed threshold would reintroduce the false
  positives the baseline is there to prevent.
