# Internals

How the extension actually works, end to end: where every number comes from,
what each decision is made of, and what the system can and cannot know.

This is the mechanical reference. [`architecture.md`](architecture.md) is the
one-page map, [`PAPER.md`](PAPER.md) is the written-up version with results,
and [`dom-notes.md`](dom-notes.md) is the raw research the scraper stands on.

Contents:

1. [What it claims, and what it does not](#1-what-it-claims-and-what-it-does-not)
2. [Four worlds](#2-four-worlds)
3. [Getting the data](#3-getting-the-data)
4. [Timing a view](#4-timing-a-view)
5. [The message layer](#5-the-message-layer)
6. [Storage](#6-storage)
7. [Classification](#7-classification)
8. [Pattern detection](#8-pattern-detection)
9. [Interventions](#9-interventions)
10. [Derived views](#10-derived-views)
11. [How it fails](#11-how-it-fails)
12. [What it can and cannot determine](#12-what-it-can-and-cannot-determine)
13. [Changing things safely](#13-changing-things-safely)

---

## 1. What it claims, and what it does not

The system detects **repetition in a text-derived content category**, measured
against the user's own trailing rate.

It does not detect mood. It cannot: the only inputs are caption text, hashtags,
and an audio track name. Someone perfectly content can trip the detector by
falling into an algorithmic loop, and someone having a terrible week can
deliberately seek out sad content and be entirely fine. Every string shown to
the user therefore describes the feed, never the viewer — there are tests in
`tests/overlay.test.js` and `tests/background-intervene.test.js` that fail on
second-person emotional claims.

Everything runs locally. There is no network call anywhere in the source.

---

## 2. Four worlds

Four separate JavaScript contexts, which is why the message layer exists at
all. They cannot share memory.

| World | File | Can reach | Cannot reach |
|---|---|---|---|
| MAIN | `content/main-world.ts` | React fiber props on Instagram's DOM | `chrome.storage`, IndexedDB, the isolated world's variables |
| Isolated | `content/*.ts` | The DOM, `chrome.*` APIs | React internals |
| Service worker | `background/*.ts` | IndexedDB, alarms, notifications | The page, entirely |
| UI | `popup/`, `options/` | `chrome.*`, messages | The page |

The split is forced by Chrome, and it shapes the design:

- Only MAIN can read `__reactFiber$…` props, but only the isolated world can
  call `chrome.runtime.sendMessage`. So MAIN writes what it finds into a DOM
  attribute and the isolated world reads it back off the element. The DOM is
  the only channel between them.
- Only the worker can write to IndexedDB, so the content script never stores
  anything. It reports; the worker decides.
- The worker is killed after ~30 idle seconds. Nothing may live in module
  scope across events, which is why cooldowns and the dirty-day queue sit in
  `chrome.storage` rather than in variables.

---

## 3. Getting the data

### 3.1 Finding reels on the page

`content/dom.ts` anchors every selector on semantic attributes — `aria-label`,
`role`, `dir`, `href` prefixes — and never on Meta's generated class names,
which change per deploy. One test strips every class from the fixture tree and
asserts extraction still works, so any selector that starts depending on them
fails immediately.

```
VIDEO_PLAYER_SELECTOR = 'div[aria-label="Video player"]'
AUTHOR_LINK_SELECTOR  = 'a[aria-label$=" reels"]'
```

`findReelContainers()` finds each player, then walks up at most
`MAX_ANCESTOR_WALK = 12` ancestors to the element that holds one player plus
its author link — that is the "reel container". The walk stops early if an
ancestor contains more than one player, which would mean it has gone too far
and grabbed the feed.

### 3.2 Which reel is "the" reel

There is no state on the page saying which reel is active. `video.paused` and
`video.currentTime` are useless — every mounted video reads paused at 0
(`dom-notes.md` §5).

So it is decided geometrically. `activeReelContainer()` returns the container
whose bounding rect straddles `innerHeight / 2`, falling back to whichever
covers the most vertical space. An `IntersectionObserver` with
`rootMargin: '-50% 0px -50% 0px'` — a zero-height band at the viewport's
centre — is used only as a cheap *change trigger*; the authoritative pick is
always recomputed geometrically, because a zero-height root makes
`intersectionRatio` meaningless for ranking.

### 3.3 Identity: the hard part

A reel needs a stable identity, for two independent reasons: to tell rows apart
in storage, and to notice when a recycled container now holds a different reel.

**The URL does not work.** Landing on `/reels/` redirects once to
`/reels/<shortcode>/` and then never updates as you scroll. A "reels watched"
counter built on URL changes reports about 1 per page load (`dom-notes.md` §6).

Identity is resolved in three tiers:

1. **React fiber shortcode.** `main-world.ts` caches the `__reactFiber$…`
   property key, then walks up to 30 `.return` hops looking for
   `memoizedProps.media.code`. Found, it writes the value to
   `data-doomscroll-shortcode` on the container, plus
   `data-doomscroll-shortcode-src` recording that it came from the fiber. The
   isolated world reads the attribute.
2. **Derived key.** `authorHandle | video-basename`, from the author link and
   the `<video>` element's `currentSrc`.
3. **`unknown|`** — the `UNIDENTIFIED_IDENTITY` placeholder, when neither works.

Tier 3 used to be catastrophic and is now merely degraded; see
[§11](#11-how-it-fails).

### 3.4 Reading the content

`content/extractor.ts` pulls four things:

| Field | Source | Notes |
|---|---|---|
| `captionText` | the caption node | Often renders a beat *after* the reel becomes active |
| `hashtags` | `a[href^="/explore/tags/"]` | Percent-decoded — they arrive URL-encoded, which silently broke Devanagari matching until fixed |
| `audioName` | audio anchors, then an SVG-icon fallback | Recorded 100% dark across 700+ reels; the per-selector counters exist to find out why |
| `authorHandle` | `aria-label` on the author link, then an href pattern | The drift canary — present on every real reel |

Two mechanisms handle the fact that the DOM is not static:

- **Snapshots.** Text is captured *while the reel is on screen* and stored in a
  `WeakMap` keyed by container element. The feed is virtualised, so by the time
  a view finishes the container may already hold the next reel's content —
  reading at completion would attribute the wrong caption.
- **Late-render backfill.** `reconcileActiveReel()` re-reads on every heartbeat.
  If it is still the same reel and the snapshot is missing fields,
  `fillMissingFields()` fills them in. If it is a *different* reel, the
  container was recycled: the open view is closed and a new one started.

Both hinge on `isSameReel()`, which is the most delicate function in the
codebase — see [§11](#11-how-it-fails).

### 3.5 The loops that drive it

| Trigger | Rate | Does |
|---|---|---|
| `scroll` on the feed's scroll container | rAF-coalesced | `syncActiveReel()` |
| `MutationObserver` on the feed subtree | rAF-coalesced | `syncActiveReel()` |
| Heartbeat | `HEARTBEAT_MS = 1000` | rebind targets, sync, reconcile, break check, dwell-clock check |
| `visibilitychange` | on change | dwell-clock check |
| `pagehide` | once | flush the open view |

Scroll and mutation both fire far faster than the DOM meaningfully changes, and
a sync reads layout, so they are coalesced into one animation frame.

**The document does not scroll.** `window.scrollY` stays 0; scrolling happens
in a nested div. `findScrollContainer()` locates it by looking for
`scrollHeight > clientHeight + MIN_SCROLL_OVERSHOOT (200)` and
`clientHeight > MIN_SCROLL_VIEWPORT (300)`. That scan walks every div and reads
layout on each, so it is guarded twice: skipped entirely when no reels are on
the page, and rate-limited to `SCROLL_RESCAN_MS = 5000` when it comes up empty.
Without those guards it re-scans every second forever on any non-feed page,
which is most of Instagram.

---

## 4. Timing a view

`content/detector.ts` is a pure state machine — no DOM, no clock of its own,
driven entirely by explicit `setActive` / `pause` / `resume` / `flush` calls.
That is what makes it unit-testable.

A view accumulates **visible** time only:

- `accumulatedMs` — banked from completed runs
- `runStartedAt` — start of the current run, or `null` while paused

`watchDurationMs = min(max(accumulated + currentRun, 0), MAX_DWELL_MS)`.

| Constant | Value | Meaning |
|---|---|---|
| `MIN_DWELL_MS` | 250 ms | Below this the view is dropped, not recorded — a flick past is not a watch |
| `MAX_DWELL_MS` | 10 min | Clamp, so a tab left open on one reel cannot report hours |
| `MAX_HIDDEN_MS` | 2 min | Paused longer than this and the view is finalised at `pausedAt` rather than stretched across the gap |

The clock is paused whenever **either** the page is hidden or an overlay is on
screen:

```
if (document.hidden || isOverlayShowing()) tracker.pause(now);
else tracker.resume(now);
```

One predicate over both reasons, deliberately. With paired pause/resume calls
at each site, whichever resumed first would cancel the other — returning from a
background tab would restart the clock with an intervention prompt still up.
The overlay half matters because a prompt pauses the video and then sits there;
without it the extension would inflate the watch time of the reel it just
interrupted.

**Sessions** (`content/session.ts`) are gap-based: a stretch of scrolling with
no gap longer than `sessionGapThresholdMs` (default 2 min). The id lives in
`chrome.storage.local` so it survives SPA navigation and is shared across tabs
— a per-tab counter would split one session the moment a reel opened in a new
tab. Concurrent tabs can race and briefly mint two ids; that splits a session
rather than corrupting anything, and is not worth a lock.

---

## 5. The message layer

`shared/messages.ts` is the entire API surface — there is no HTTP backend. Every
route is typed both ways:

```ts
type ExtensionMessage = { type: 'REEL_VIEW_LOGGED'; payload: NewReelEvent } | …
interface MessageResponses { REEL_VIEW_LOGGED: { queued: boolean }; … }
```

`shared/client.ts` wraps `sendMessage` and unwraps the `{ok, data}` envelope, so
callers get a typed result or a thrown error. Handler failures come back as
`ok: false` rather than a rejected promise, so a caller that forgets to catch
does not produce an unhandled rejection in the page.

All handlers sit behind one `onMessage` listener in `background/index.ts`.
Unknown types return `false` immediately, releasing the channel — returning
`true` would leave the sender hanging until the port closed.

**`INTERVENE` is the only message that travels worker → page.** Everything else
reports outward. It is delivered with `chrome.tabs.sendMessage` to the tab the
reel came from, using `sender.tab.id` rather than a tab id in the payload, so a
sender cannot aim an interruption at a tab it does not own.

### The write path, and why its order matters

```ts
async REEL_VIEW_LOGGED(payload, sender) {
  const settings = await getSettings();
  if (!settings.trackingEnabled) return { queued: false };

  await recordReelView(payload, classifyReel(payload, settings.classificationMode));

  await markDayDirty(payload.startedAt);      // ← bookkeeping FIRST
  await scheduleAggregateFlush();

  try {                                        // ← analysis, isolated
    const detection = await runDetection(payload.sessionId, settings);
    await maybeIntervene(detection, settings, payload.sessionId, sender.tab?.id);
  } catch (err) {
    console.error('Doomscroll: detection failed for a recorded reel', err);
  }

  return { queued: true };
}
```

The ordering is load-bearing. `markDayDirty` is what gets the day rolled up, and
the rollups are what the detector's baseline is computed from. With the analysis
running first and unguarded — as it originally did — a detection failure left
the reel stored but its day never queued, **starving the very thing that
failed**, silently and self-reinforcingly. The `catch` exists for the same
reason: the reel is recorded either way, and an uncaught throw here was being
swallowed by the content script's catch, losing the view entirely.

The `trackingEnabled` check is enforced *here* and not only in the content
script. Pausing tears down observers per tab via a storage event, but an
in-flight message, or a reel completing in a throttled background tab during
that race, would still be written. The write path is the one place the
guarantee can be absolute.

---

## 6. Storage

### IndexedDB — `doomscroll`, version 4

| Store | Key | Indexes | Holds |
|---|---|---|---|
| `reelEvents` | `id` (uuid) | `by-startedAt`, `by-session` | One finished view |
| `sessions` | `id` | `by-startedAt` | Rolling totals per session |
| `dailyAggregates` | `YYYY-MM-DD` | — | Per-day rollup, local-time buckets |
| `detectionLog` | `id` | `by-at` | Every detection decision, fired or not |
| `interventionLog` | `id` | `by-at` | Every interruption and its outcome |

The upgrade handler is guarded **per store** rather than switched on
`oldVersion`, so upgrading from any earlier version creates whatever is missing.

`recordReelView()` writes the event and the session rollup in **one
transaction** — a session's `reelCount` and `totalDurationMs` are derived from
its events, so a partial write would leave them disagreeing permanently.

Bulk writes chunk at `WRITE_CHUNK = 500`. A lexicon bump rewrites the entire
history; at ~1000 reels/day one transaction per event is tens of thousands of
round trips, which an MV3 worker is terminated partway through.

A failing database is recorded rather than left silent. "Nothing tracked yet"
is what the popup says when you have not scrolled, when tracking is paused, and
when every write has been failing for a week — and only the third loses
anything. `shared/storage-health.ts` notes the last failure and both dashboards
read it. The cost sits entirely on the failure path: the success path reads
storage once per worker lifetime, to find a failure a previous worker may have
left behind, and writes only when there is one to clear.

Settings are clamped in `mergeSettings`, not at the inputs. `min`/`max` on
`<input type="number">` constrain the spinner and nothing else — a typed value
is stored unchanged and an emptied field reads as 0 — and clearing a field to
retype it is the ordinary way to edit a number. A window size of 0 stopped
detection permanently and said nothing; a negative one was worse, because
`slice(0, -n)` kept firing against the wrong reels. The merge is the one
function every write passes through, including settings written by an older
build, so the guard belongs there. `SETTING_BOUNDS` in `defaults.ts` owns the
ranges and the options inputs render from it, and its window floor is
`MIN_WINDOW_SAMPLE` — below that, detection provably cannot fire, so offering
it would be offering a setting that does nothing.

### chrome.storage.local

| Key | Holds | Survives CLEAR_DATA |
|---|---|---|
| `doomscroll:settings` | User settings | **Yes** — clearing history is not asking to be re-onboarded |
| `doomscroll:session` | Current session id | Yes |
| `doomscroll:dirtyDays` | Days awaiting rollup | No |
| `doomscroll:break` | Active break | No |
| `doomscroll:interventionState` | Cooldowns, per-session firing | Yes |
| `doomscroll:extractionHealth` | Rolling extraction counters | Yes |
| `doomscroll:storageFailure` | The last failed write, if any | Yes |
| `doomscroll:lexiconVersion` | Last-seen classifier fingerprint | Yes |

The two that are cleared are transient state that would otherwise outlive the
history it refers to: a break would keep interrupting someone who just asked
for everything to be forgotten, and the dirty-day queue would roll the deleted
days up as **empty aggregates** on the next alarm, putting them back on the
charts.

### Aggregation

Aggregates are **materialized, not computed on read.** Raw events are pruned at
`RETENTION_DAYS = 90` and the aggregates outlive them, so a day never rolled up
is lost forever once its events age out. The prune alarm flushes pending
rollups *before* deleting anything, for exactly that reason.

The flush is a **throttle, not a debounce**: `scheduleAggregateFlush()` checks
whether `AGGREGATE_ALARM` already exists and only creates it if not, so a burst
of reels produces one flush after `AGGREGATE_DELAY_MINUTES = 1` rather than one
that keeps receding while you keep scrolling.

The queue is cleared *before* the days are recomputed, so a day marked dirty
during a flush is not wiped by a write that finishes after it. That ordering
has a cost — a throw partway through would lose every day not yet reached, and
lose it permanently, since the queue is already empty — so whatever is left is
put back on failure. A day that never becomes an aggregate is a hole in the
baseline detection is computed from.

Today's aggregate is recomputed on demand in `GET_STATS`, because the throttled
alarm means it would otherwise be stale for a session you are still in.

---

## 7. Classification

`shared/classifier.ts` — pure keyword scoring, no network, no model.

### The taxonomy is two-tier, and that is the whole trick

| Tier | Members | Role |
|---|---|---|
| Charged | joyful, sad, breakup, anxious, angry, motivational, romantic | The only ones that can drive detection |
| Topic | comedy, music, dance, food, fitness, sports, tech, fashion, travel, gaming, pets, art, entertainment | Keep ordinary content out of `neutral` |
| `neutral` | — | Had text, matched nothing |
| `unclassified` | — | Had **no text at all**; never stored as a category |

Before the topic tier existed, ~70% of readable reels came back neutral — not
because the vocabulary was thin, but because every category was an *emotional*
register while a real feed is mostly topical. Adding topics is what moved the
number from 70% to 30%. More synonyms would not have.

`neutral` and `unclassified` are kept distinct throughout. Collapsing them
would let a day of unreadable reels masquerade as a genuinely calm one, and
would poison the baseline.

### Scoring

Each category accumulates a score from matches in caption, hashtags, and audio:

| Signal | Weight |
|---|---|
| Hashtag match | 3 |
| Phrase match | 2 |
| Word match | 1 |
| Emoji match | 1 |
| *Audio-sourced* match | × 0.5 |

Hashtags are scored twice over: against each category's curated tag list at
weight 3, **and** against the general vocabulary at caption weight. That second
pass was missing originally, so `दर्द` in a caption read as sad while `#दर्द`
scored nothing at all — the highest-weighted channel had the smallest
dictionary. Tags are matched by whole token so `#sadhguru` stays neutral, and
emoji are excluded from the tag pass because reach tags carry decorative hearts
that mean nothing.

### Confidence

```
strength   = min(1, top / SATURATION_SCORE)      // SATURATION_SCORE = 3
separation = (top - second) / top
confidence = strength × (0.5 + 0.5 × separation)
```

`SATURATION_SCORE = 3` is chosen so one unambiguous caption word clears the
floor on its own — "so anxious right now" should read as anxious — while a
single audio-only hit at half weight does not.

Below `MIN_CONFIDENCE = 0.25` the result falls back to `neutral`, **except**
when the winner is charged *and* the signal was authored (caption or hashtag,
not audio alone). That is the charged-recall policy: a missed comedy reel is
cosmetic, a missed sad reel is a miss the detector can never recover.

Ties break by a fixed order in `lexicon.ts` (breakup, angry, anxious, sad,
romantic, motivational, joyful, then topics) — behaviour, not presentation.

### Re-labelling without data loss

Events retain the caption, hashtags and audio name they were classified from.
Bump `LEXICON_VERSION` and `reclassifyIfLexiconChanged()` re-scores the entire
history on next load and rebuilds the aggregates. Bump it for **scoring**
changes too, not just table edits — stored labels are equally stale either way.

---

## 8. Pattern detection

`shared/patterns.ts` is pure; `background/detect.ts` supplies it with data and
writes the log. Detection runs after every reel and, by default, does nothing
but record what it would have done.

### Two conditions, and the second is the point

1. **Dominance** — one category holds more than `patternDominantThreshold`
   (default 0.6) of the recent window (`patternWindowSize`, default 15).
2. **Baseline** — that share is more than `patternBaselineMultiplier` (default
   1.5×) the user's **own** trailing rate for that category.

Dominance alone false-flags anyone whose ordinary diet runs heavy in a category
— exactly the people a tool like this should not be lecturing. The baseline
comparison is what makes the signal mean *"this is unusual for you."*

### The charged-only denominator

Dominance is measured among **charged reels only**, not all classified reels.
Most of a real feed is topical, so counting comedy and food in the denominator
meant a genuine breakup loop of 5-in-15 read as 33% — far below any threshold —
and the detector was effectively disabled on any normal feed. The question worth
asking is "among the emotional reels, is one register dominating?"

### The baseline is recency-weighted

Each day's contribution is multiplied by `0.5 ^ (ageInDays / 7)` across a
14-day lookback. Still **pooled** by volume, so a heavy day outweighs a quiet
one — decay multiplies that property rather than replacing it.

A flat 7-day window had a cliff edge: the morning a heavy day aged out of range
the baseline lurched, and an unchanged feed could go from "within baseline" at
23:59 to flagged at 00:01.

One subtlety: the returned **shares** are decayed, but the returned **sample
count is raw**. They answer different questions — the shares are "what does this
diet look like lately", where recency matters, and the count is "is there enough
history to say anything at all", where it does not. Decaying the guard would
make `MIN_BASELINE_SAMPLE` mean different things depending on when reels landed.

### Guards

| Guard | Value | Refuses when |
|---|---|---|
| `MIN_BASELINE_DAYS` | 7 | Fewer than 7 days of aggregates exist |
| `MIN_WINDOW_SAMPLE` | 8 | Too few classified reels in the window |
| `MIN_BASELINE_SAMPLE` | 20 | Too few charged reels across the baseline |
| `MIN_CHARGED_SAMPLE` | 5 | Too few charged reels in the window |

On a real feed `insufficient-charged-sample` is by far the most common outcome
— roughly half of all checks in a replay over a month — because most of a feed
is topical. That is the guard working, not a fault, but it means the log's top
row is usually this one.

**There is no cold-start fallback, deliberately.** Below 7 days detection
refuses to decide and logs `insufficient-history`. Substituting a fixed
threshold would reintroduce precisely the false positives the baseline exists to
prevent, during the week the user is deciding whether to trust the thing at all.

### Why there is no "N in a row" rule

A baseline-free streak trigger was built and removed. It fires constantly for
anyone whose ordinary diet leans one way — the exact lecture the baseline
prevents — and the existing tests said so in as many words. Scaling the required
run length by the user's own rate works in principle but must be tuned below
`0.5^15` to preserve those invariants, at which point the constant is fitted to
the test fixtures rather than to anything real. Run length is logged on every
row so a future rule can be built on evidence instead.

### Logged, never acted on

Three fields ride along on every decision:

- `pacePerSec` — reels per second across the window
- `hourOfDay` — local hour
- `baselineShareLong` — the same category's share over **60 days**

The last comes from a real finding. Replaying a synthetic month containing a
deliberate slide into sad content, detection fires on day one and then goes
quiet for the rest of it — including an unbroken 14-reel run at the end. The old
pooled baseline behaved identically, so this is a property of any *adaptive*
baseline, not a regression. But it is also the difference between someone who
has always watched sad content (leave them alone) and someone sliding into it
(the reason the tool exists), and a two-week baseline cannot tell those apart by
the end. Comparing two horizons can.

### The log collapses runs

Detection runs on every reel — a dozen checks a minute at real scrolling pace.
An unbroken run of the same outcome collapses into one row carrying
`occurrences` and the most recent numbers. Only the *qualitative* outcome is
compared (detected, category, reason, trigger); share and ratio drift by a point
with every reel and comparing them would defeat the collapsing entirely.

---

## 9. Interventions

Off by default, and the switch stays disabled until detection has a baseline.
Interrupting is a **separate decision** from detecting, with its own module
(`shared/intervene.ts`, pure) and its own thresholds.

| Run length | Level | Cooldown |
|---|---|---|
| 5 | Notification | 10 min |
| 10 | Full-screen prompt | 20 min |
| 20 | Prompt with a 10s delay | `blockCooldownMs`, default 30 min |

Escalation goes **straight to the level a run has earned** rather than climbing
one interruption at a time — someone twenty reels deep has already scrolled past
the point the gentler nudge was for.

Suppression order in `decideIntervention()`:

1. `disabled` — off, or detection did not fire
2. `on-a-break` — a break is running; outranks everything else
3. `no-level-earned`
4. `already-fired-this-session`
5. `cooling-down`

Cooldowns **survive into a new session** on purpose. Otherwise closing the tab
and reopening it buys a fresh interruption, making the cooldown bypassable by
exactly the behaviour being interrupted.

The cheap half of the decision is exported as `couldIntervene()` so the worker
can skip reading state it will not use — detection runs on every reel and almost
none can produce an interruption.

### The block level is a delay, never a lock

Its dismiss button is withheld for 10 seconds and **counts down visibly** — a
disabled button with no explanation reads as broken, and the point is friction,
not confusion. "Take a break" is available throughout. Locking someone out on
the strength of a keyword classifier would be both a trust and a store-review
liability, and the delay captures most of the benefit anyway.

### Taking a break

Accepting starts a 15-minute break and **navigates away from the reels feed** —
navigation is the substantive half, since only leaving actually ends the scroll.
Returning to `/reels` inside the window brings up a soft reminder with both exits
offered equally.

Two details worth knowing:

- A **5-second grace period** before the reminder can appear. The state is
  written before the page navigates, so for a beat the tab is still on the feed
  with a live break; without the grace the reminder flashes onto the page the
  user just chose to leave.
- The navigation happens **whether or not the reports succeed**. Gating it
  behind them would put the substantive half of the feature behind the failure
  of the bookkeeping about it.

### Measuring whether it helped

Every interruption is written to `interventionLog` **before** it is shown, so one
that was never delivered still leaves a row — that is the failure most worth
counting. Outcomes correlate by the record's own id, carried out to the overlay
and echoed back; resolving "the most recent pending one" would mis-attribute a
dismissal to a stale row from a tab closed earlier.

`breaks held` is the closest thing to an observed signal. Precisely: a break
stops counting as held only when the user **chooses** to end it early. Bouncing
off the reminder and carrying on still counts as held — that is the break
working. Closing the tab on the reminder also counts as held, which it should
not; fixing that needs a signal from a page that is going away, which is exactly
when a message is least likely to arrive. That gap is documented rather than
papered over.

---

## 10. Derived views

`shared/insights.ts` is pure and read-only. Nothing here feeds detection — these
answer "what has my feed been doing", which is a looser question than "is it
doing something unusual right now", because a chart is read by a person who can
see the sample size.

- **`chargedShareByDay`** — charged as a share of *classified* reels per day.
  Days with nothing classified are kept at zero rather than dropped; a gap in
  the line reads as "did not scroll" rather than "little could be read".
- **`planTrend`** — decides what the trend chart may assert. Days under
  `THIN_DAY_SAMPLE = 5` classified reels are excluded from the line: with one
  classified reel a "share" is 0% or 100%, and plotted it becomes a spike taller
  than any real movement. `MIN_TREND_POINTS = 3` and the returned `drawable`
  flag are owned here so the chart and the popup section around it cannot
  disagree.
- **`stackByDay`** — per-day composition. The 13 topic categories pool into one
  band: 21 stacked colours is a texture, not a chart. Denominator is the day's
  *total* reels including unreadable ones, since the no-text portion is a real
  part of what was watched.
- **`runsOf` / `longestChargedRun`** — contiguous runs, with unclassified reels
  extending rather than breaking a run, matching `currentStreak` in
  `patterns.ts`. A drill-down that disagreed with the log it exists to check
  would be worse than none.
- **`authorBreakdown`** — creators by watch time, with `unattributed` returned
  rather than hidden, because author handles were only stored from a certain
  version on.

The axis is fixed at half-scale, opening to full only when a believable day
exceeds it. An axis fitted continuously to the data makes a flat, healthy month
look as dramatic as a real climb.

---

## 11. How it fails

Instagram has no API. The scraper is the ongoing cost of the project, and the
design assumption is that it *will* break. Three layers respond to that.

### Fixture tests

`tests/fixtures/reelFeed.js` is sanitised real markup including captionless,
hashtag-less, original-audio, and un-hydrated variants. One test strips all
class names and asserts extraction still works.

### Runtime health

`shared/health.ts` keeps a rolling window of the last `SAMPLE_SIZE = 50`
extractions, ignoring the first `MIN_SAMPLES = 10` where one placeholder skews
the ratio:

| Signal | Threshold | Means |
|---|---|---|
| `missingAuthor / samples` | > 0.5 | Layout probably moved — the author is on every real reel |
| `fallbackIdentity / samples` | > 0.5 | Fiber bridge degraded; identities will not survive CDN rotation |
| `missingAudio / samples` | > 0.9 | Audio channel dark |

The MAIN-world bridge publishes its own liveness separately, which distinguishes
"React internals were renamed" from "the script never ran" — two failures
needing different fixes that were otherwise indistinguishable.

The counters decay **fractionally**, and that detail is load-bearing. Both
integer schemes were tried and both were wrong in opposite directions:
`Math.round` has fixed points, so a count of 25 in a 50-sample window decays to
24.5 and rounds back to 25, latching the alarm forever after a selector was
fixed. `Math.floor` cured the latching and broke something worse —
`floor(n × 49/50)` loses exactly one for every n from 1 to 50, so a counter
could only hold its value if *every single* sample incremented it. Under it,
a 90% author-miss rate measured 0.000 and no warning in this table could fire
below a literal 100% failure. The one channel that happened to sit at 100%
(audio) is what kept that hidden. Plain exponential decay has neither problem:
the ratio converges on the true rate.

### Degrading instead of stopping

This one is worth reading carefully, because it was a real silent failure.

When neither the fiber shortcode nor the author nor the video src resolves,
identity collapses to `unknown|` for **every** reel. `isSameReel()` treats an
unidentified side as the same reel — correct for an un-hydrated shell becoming a
real reel, which is the same reel arriving. But with *everything* unidentified,
the whole feed compared as one reel: the recycling check saw no change, one view
stayed open across the entire session, and **nothing was ever recorded** — from
the one code path that runs precisely when Instagram has already moved.

The symptom is the popup reading "Nothing tracked yet" while the drift banner
says the layout may have changed. Those are one failure, not two.

Readable text now separates the cases. A shell has none; a rendered reel usually
still has a caption when the author link and the bridge are gone. When both
sides carry text and it differs, they are different reels that merely cannot be
named. A selector break now costs identity rather than all tracking.

If tracking ever stops again, check in this order:

```bash
document.querySelectorAll('div[aria-label="Video player"]').length
document.querySelectorAll('a[aria-label$=" reels"]').length
document.querySelectorAll('[data-doomscroll-shortcode]').length
document.querySelector('video')?.currentSrc
```

Zero on the middle two together is the collapse above. Note also that a
single-reel permalink (`/reel/<code>/`) is a different layout from the feed
(`/reels/`), which the selectors were researched against.

### Known benign races

Documented in code rather than locked: concurrent tabs can split a session id,
and the dirty-days read-modify-write can drop a day under heavy concurrency
(recovered by the next write to that day).

---

## 12. What it can and cannot determine

**Can:**

- Which reels you watched, for how long, in what order, grouped into sessions
- What emotional or topical register each reel's *text* carries, at ~88%
  accuracy on a 701-reel hand-labelled benchmark
- Whether one charged register is dominating your recent window relative to
  your own trailing rate
- The longest unbroken run of one register in a session
- How your charged share is trending over 30 days, and which register is driving
  the change
- Which creators you spend the most time on, and their charged share
- Whether interrupting you changed anything

**Cannot:**

- Know how you feel. Text is a proxy for content, not for state.
- Read anything visual or auditory. ~24% of a real feed carries no text at all
  and is `unclassified` — a structural floor no lexicon tuning can move.
- Distinguish a genuine slide into charged content from a stable heavy diet
  using the two-week baseline alone. That is why the 60-day share is logged.
- Survive a full identity collapse with reliable per-reel identity — it keeps
  counting, but the reels are anonymous.
- Prove a per-class accuracy figure for the rarer charged categories. Of 532
  readable labelled reels only 13% are charged, with four examples each for
  `breakup` and `joyful`. `scripts/pick-to-label.mjs` exists to fix that.

---

## 13. Changing things safely

Two merge gates, both runnable offline against your own exported data:

```bash
node scripts/eval.mjs eval labeled.csv                     # classifier
node scripts/replay-detection.mjs reels.csv --against HEAD # detector
```

`eval.mjs` bundles the real `classifier.ts` through esbuild, so it scores the
shipped code, not a copy. `replay-detection.mjs` replays every decision across
real history and diffs against the detector as it existed at any git ref — a
threshold edit gets judged by what it does to real decisions, not by whether the
reasoning sounded right.

> Never measure accuracy with `template` mode and unedited labels. It pre-fills
> the classifier's own guess, so you score the model against itself and get a
> meaningless 100% with a flawless diagonal confusion matrix. Use
> `tools/label.html`, which never shows the guess.

Rules of thumb the codebase already follows:

- **Decision logic goes in `shared/`, pure.** Storage, messaging and DOM stay in
  their layers. Every threshold worth arguing about is unit-tested without a
  browser.
- **A rule with two callers gets one owner.** `bandKeyFor`, `MIN_TREND_POINTS`
  and `couldIntervene` are all extractions made after the two copies drifted.
- **Bookkeeping before analysis.** Anything that later reads history back must
  not be able to skip the write that records it.
- **Log the reason, not just the verdict.** Suppression reasons and
  not-detected reasons are the half that tells you which threshold to move.
- **A declared state with no producer is a bug.** `MOOD_ALERT` and an `ignored`
  outcome were both deleted for this.

The manual checks automation cannot cover are in
[`live-session-protocol.md`](live-session-protocol.md). Run it before a release
and after any Instagram change you have reason to suspect.
