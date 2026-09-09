# Doomscroll

A Chrome (MV3) extension that tracks which Instagram Reels you actually watch
and flags when the algorithm has locked onto one emotional register and is
feeding it back faster than you'd consciously notice.

Everything stays on your machine — no server, no account, no telemetry. The
extension makes no network requests at all; see the
[public privacy policy](https://sogoyalz.github.io/Doomscroll/PRIVACY).

Requires Chrome 111 or later (the shortcode bridge needs `"world": "MAIN"`
content scripts). Runs only on `https://instagram.com`, and never on
`/direct/` or `/accounts/`.

**Getting it running:** [Load the extension](#load-the-extension) ·
[Scripts](#scripts) · [Project layout](#project-layout)

**What it does and why:** [Problem](#problem) ·
[Results, measured](#results-measured) · [Build status](#build-status) ·
[Pattern detection](#pattern-detection) · [Interventions](#interventions) ·
[Classification](#classification) ·
[What the dashboard shows](#what-the-dashboard-shows)

**Owning it:** [A warning about the DOM layer](#a-warning-about-the-dom-layer) ·
[Known gaps](#known-gaps) · [`docs/INTERNALS.md`](docs/INTERNALS.md) for the
mechanics in full

## Problem

Screen-time counters are a solved problem. The part worth building is the
second half: detecting when you've fallen into a negative content loop, judged
against *your own* trailing baseline rather than a fixed threshold, so it
doesn't false-flag anyone whose normal diet just runs heavier in a category.

The system detects **repetition in a text-derived content category** — not
your emotional state. Getting stuck in an algorithmic loop can trigger it
without you feeling anything in particular. Every string the extension shows
you describes the feed, never you; there are tests that fail on second-person
emotional claims.

## Results, measured

Everything below comes from [`scripts/eval.mjs`](scripts/eval.mjs) run against
reels exported from a real feed, not from synthetic fixtures.

| | |
|---|---|
| Reels tracked over 3 days of real use | **2,986** |
| Hand-labelled reels in the benchmark | **701** |
| Overall classifier accuracy | **88%** |
| Readable reels the classifier could not name | 70% → **30%** |
| Emotional captions caught (5-caption probe) | 1 of 5 → **5 of 5** |
| Tests | **670** across 27 files |

**Getting an accuracy number that meant anything took a second attempt.** The
first run reported 100%. That was worthless: the labelling step pre-filled
each label with the classifier's own guess, so it was scoring the model
against itself — a flawless diagonal confusion matrix is the signature of that
mistake, not of a good classifier. It was thrown out and replaced with
[`tools/label.html`](tools/label.html), which never shows the guess, so labels
are formed independently of what the model thinks.

Three findings shaped the design more than any tuning:

- **The taxonomy was the problem, not the vocabulary.** ~70% of readable reels
  came back "neutral" because every category was an *emotional* register while
  a normal feed is mostly topical — comedy, food, cricket, music. Adding a
  topic tier is what moved the number; more synonyms would not have.
- **Overall coverage is the wrong metric.** A comedy reel left unlabelled is
  cosmetic; a *sad* reel left unlabelled is a miss the detector can never
  recover. Recall on emotionally charged content is the number that matters,
  and it is the harder one.
- **The label set, not the lexicon, is now the binding constraint.** Of the 532
  *readable* labelled reels, only 13% are charged: `breakup` and `joyful` have
  four examples each, `angry` and `motivational` five. At that support a
  per-class figure is noise — `breakup` currently reads 100% recall and 44%
  precision, which says only that four examples cannot settle the question.
  [`scripts/pick-to-label.mjs`](scripts/pick-to-label.mjs) exists to fix this.

## Build status

All eight phases are done, including the intervention ladder (7b), which was
held back until there was a detection log worth tuning against.

| Phase | Scope | Status |
|---|---|---|
| 1 | Shell + live DOM research | done |
| 2 | Detection / tracking | done |
| 3 | Storage (IndexedDB) | done |
| 4 | Aggregation | done |
| 5 | Classification (local rules) | done |
| 6 | Pattern detection (log-only) | done |
| 7a | Dashboard + settings + log review | done |
| 7b | Intervention ladder | done — **ships off** |
| 8 | Testing / resilience / packaging | done |

Interventions are built but **default to off**, and the switch stays disabled
until you have the week of history a baseline needs. Detection runs and logs
from day one either way.

## Pattern detection

Two conditions must hold together before anything is flagged:

1. One category holds more than `patternDominantThreshold` of the recent
   window (default 60% of the last 15 classified reels), and
2. that is more than `patternBaselineMultiplier` times **your own** trailing
   rate for that category (default 1.5×).

The second condition is the point. Dominance alone false-flags anyone whose
ordinary diet runs heavy in a category — exactly the people a tool like this
should not be lecturing. Comparing against your own baseline makes the signal
mean *"this is unusual for you"*.

**The baseline is recency-weighted.** Each day's contribution halves every 7
days across a 14-day lookback. A flat window had a cliff edge: the morning a
heavy day aged out, the baseline lurched, and an unchanged feed could go from
"within baseline" at 23:59 to flagged at 00:01.

**No fixed-threshold fallback during cold start.** With fewer than 7 days of
history, detection refuses to decide and logs why. Substituting a fixed
threshold for the missing baseline would reintroduce precisely the false
positives the baseline exists to prevent — during the week you are deciding
whether to trust the thing at all.

**Unclassified reels are excluded from the denominator**, so the same run of
sad reels doesn't cross or miss the threshold depending on how many text-free
dance clips happened to sit between them.

### Why there is no "N in a row" rule

A baseline-free streak trigger was built and removed. It fires constantly for
anyone whose ordinary diet leans one way, which is precisely the lecture the
baseline comparison exists to prevent, and the existing tests say so in as many
words. Scaling the required run length by your own rate works in principle but
has to be tuned below `0.5^15` to preserve those invariants — at which point
the constant is fitted to the test fixtures rather than to anything real. The
reasoning is recorded in [`src/shared/patterns.ts`](src/shared/patterns.ts);
run length is logged on every row so a future rule can be built on evidence.

### Logged but never acted on

Three fields ride along on every decision so a question can be answered from a
week of review rather than from intuition: scrolling pace, local hour, and a
**60-day baseline share** beside the one the decision used.

That last one comes from a real finding. Replaying a synthetic month containing
a deliberate slide into sad content, detection fires on the first day and then
goes quiet for the rest of it — including an unbroken 14-reel run at the end.
The old pooled baseline did the same, so this is a property of any *adaptive*
baseline rather than a regression. It is also the difference between someone
who has always watched sad content (leave them alone) and someone sliding into
it (the reason the tool exists), and a two-week baseline cannot tell those
apart by the end. Comparing the two horizons can.

### Reviewing the log before switching intervention on

Every evaluation is recorded, including near-misses, with all the inputs
behind it. The options page shows it as a table and exports it as CSV. Read a
week of real output before letting anything act:

| Mostly seeing | Means |
|---|---|
| `insufficient-charged-sample` | Almost always the top row: too few *emotional* reels in the window to judge dominance. Normal on a mostly-topical feed |
| `within-baseline` | The multiplier is too high for you |
| `not-dominant` | The window or threshold is too strict |
| `insufficient-window-sample` | Too little of your feed has readable text |
| `category-not-watched` | Check `watchedCategories` matches what you care about |

`wouldHaveActed` is the column that matters: it shows what you'd have been
interrupted for.

## Interventions

Off by default. The switch is disabled until detection has a baseline, because
a tool with nothing to compare against has nothing to say.

| Run length | What happens |
|---|---|
| 5 in a row | A notification |
| 10 | A full-screen prompt, pausing the reel behind it |
| 20 | The same prompt, with the dismiss button withheld for 10 seconds |

Nothing interrupts you during a break you already agreed to, and the reel
behind a prompt stops accruing watch time for as long as it is up — otherwise
the extension would be inflating the measurement of the very reel it
interrupted.

Interrupting is deliberately a **separate decision** from detecting, with its
own module and thresholds. Detection can hold true for a hundred consecutive
reels; interrupting a hundred times would be the tool becoming the problem it
exists to name. Each level fires once per session and then sits behind a
cooldown, and the cooldown survives into a *new* session on purpose — otherwise
closing the tab and reopening it buys a fresh interruption, making the cooldown
bypassable by exactly the behaviour being interrupted.

**The block level is a delay, never a lock.** Its dismiss button counts down
visibly rather than sitting inert, and "Take a break" is available throughout.
Locking someone out of an app on the strength of a keyword classifier would be
both a trust and a store-review liability, and the delay captures most of the
friction anyway — the point is to interrupt an automatic behaviour, not to win
an argument. There is a test named for that guarantee.

**"Take a break" takes one.** Accepting starts a timed break (15 minutes),
leaves the reels feed, and remembers. Come back to `/reels` inside the window
and a soft reminder says how long is left, with *Keep the break* and *End it,
I'm good* offered on equal terms — you already agreed to this, so the job is to
remind, not to argue.

**Effectiveness is recorded, not assumed.** Every interruption is written to
storage *before* it is shown, so one that was never delivered still leaves a
row — that is the failure most worth counting. Options shows a per-level tally
under *Did interrupting help?*.

The column that matters there is **breaks held**, the closest thing to a record
of what happened rather than which button was pressed. Until the break did
something, `accepted` and `bypassed` were two labels for the same event and the
table could only report which was nicer to press.

What it counts precisely: a break stops being held only when you *choose* to
end it early from the reminder. Returning to the feed and carrying on with the
break still counts as held, which is right — you bounced off. Closing the tab
on the reminder also counts as held, which is not right, and is the known gap
in this number. If most breaks are ended within a minute, the honest reading is
that the interruption costs attention and buys nothing — turn it off, or raise
the thresholds.

## Classification

Two tiers, 21 categories, plus a separate "no text" state:

- **7 charged**: `joyful`, `sad`, `breakup`, `anxious`, `angry`,
  `motivational`, `romantic`. Only these can drive detection.
- **13 topics**: `comedy`, `music`, `dance`, `food`, `fitness`, `sports`,
  `tech`, `fashion`, `travel`, `gaming`, `pets`, `art`, `entertainment`. Their
  whole job is keeping ordinary content out of `neutral`.

Local keyword rules over caption text, hashtags, and audio name — no network,
no model download.

| Outcome | Meaning |
|---|---|
| a category | Terms matched with enough confidence to name it |
| `neutral` | There was text, and nothing charged or topical was in it |
| unclassified | There was no text to read at all |

**Text is the only signal.** Dance clips, comedy skits, and pure-visual reels
carry little or none and come back unclassified — about 24% of a real feed. No
amount of lexicon tuning fixes that; closing the gap needs vision or audio
analysis, which is a different project. The `unclassified` bucket is kept
visible rather than folded into `neutral` so that ceiling stays honest.

**Hashtags are scored against the full vocabulary, and decoded first.** Two
gaps used to sit in the highest-weighted channel. Only each category's curated
hashtag list was consulted for tags, so `दर्द` in a caption read as sad while
`#दर्द` scored nothing at all — the channel with the most weight had the
smallest dictionary. And hashtags arrive percent-encoded from the href, so a
deliberately Hinglish- and Devanagari-heavy lexicon could never match them.
Both are fixed. Tags now also score through the general vocabulary at *caption*
weight, matched by whole token so `#sadhguru` stays neutral, with emoji
excluded because reach tags carry decorative hearts that mean nothing.

**Tuning is expected.** [`src/shared/lexicon.ts`](src/shared/lexicon.ts) is a
starter table and will over-trigger on ambiguous content until it is tuned
against a real feed. Edit the terms, bump `LEXICON_VERSION` (currently 4), and
reload — stored history is re-scored automatically, because events keep the
caption, hashtags, and audio name they were classified from. Bump it for
scoring changes too, not just table edits: stored labels are just as stale
either way.

## What the dashboard shows

The popup carries today's stats, the category mix, and a **30-day trend of the
emotionally charged share** of your feed. That chart exists to answer what the
detector structurally cannot — an adaptive baseline absorbs a gradual slide
within a week or two, but drawn against a fixed axis over a month the same
slide is plainly visible.

The options page adds:

- **What each day was made of** — one bar per day. The 13 topic categories pool
  into a single band, because 21 stacked colours is a texture rather than a
  chart; the split mirrors the taxonomy's own. Days with too few reels are
  dimmed rather than left to read as confidently as a full one.
- **Sessions** — each continuous stretch of scrolling, expandable into a strip
  of one cell per reel *in the order they arrived*. This is the only
  non-aggregating view, and the only place a run is visible: a session that was
  40% sad reads identically whether that arrived spread evenly or as twelve in
  a row, and the latter is what detection acts on.
- **Who you watch most** — creators by time spent, with each one's charged
  share. States plainly how many older reels predate author capture.
- **Extraction health** — see below.

## Load the extension

> **Load `dist/`, not the project root.** The root `manifest.json` is build
> input: it references `.ts` entry points that `@crxjs` rewrites at build
> time. Pointing Chrome at the root produces
> `Invalid script mime type: Could not load file 'src/content/index.ts'`.

```sh
npm install
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** → select the **`dist/`** folder.
3. Visit instagram.com and scroll some reels.

For development, `npm run dev` rebuilds `dist/` on change with HMR — leave it
running and keep the extension pointed at `dist/`.

Permissions: `storage` and `alarms`. `notifications` is **optional** and asked
for only when you switch interventions on — it powers the gentlest step, and
putting it on the install prompt would charge every user for a feature that
ships off and stays unusable until a week of history exists. Decline it and the
ladder simply starts at the full-screen prompt. Host access is limited to
instagram.com. Justifications are in
[`docs/store-listing.md`](docs/store-listing.md).

## Scripts

```sh
npm run dev        # vite dev server + HMR, writes dist/
npm run build      # production build into dist/
npm run package    # build, verify the manifest, zip dist/
npm test           # vitest (jsdom)
npm run typecheck  # tsc --noEmit
npm run lint
```

`npm run package` checks the things that fail silently: icons present in the
build, both content scripts emitted, the MAIN-world script still registered
(without it every reel loses its shortcode), and manifest/package versions in
step.

### Measuring classifier accuracy against your own reels

Export your reels first: Settings → Export reels → save as `reels.csv`.

**Find what the lexicon is missing** (drives the neutral rate down):

```sh
node scripts/eval.mjs misses reels.csv
```

Prints the most common words and hashtags among reels that came back neutral,
plus sample captions — i.e. exactly what to add to
[`src/shared/lexicon.ts`](src/shared/lexicon.ts).

**Measure real accuracy** — label reels by hand, then score:

```sh
# 1. Open tools/label.html in a browser, drop in reels.csv, tap a category
#    for each reel. It shows NO classifier guess, so there is no anchoring.
#    Download labeled.csv when done.
# 2. Score your honest labels against what the classifier predicts:
node scripts/eval.mjs eval labeled.csv
```

Prints overall accuracy, per-category precision/recall, the neutral rate, and
a confusion matrix. This is the arbiter for every lexicon change.

> Do **not** measure accuracy with `template` mode + unedited labels — it
> pre-fills the label with the classifier's own guess, so you would be scoring
> the classifier against itself (a meaningless 100%). Use `tools/label.html`,
> which never shows the guess. `template` exists only as a quick spot-check
> when you intend to correct the labels.

**Choose what to label next**, rather than labelling at random:

```sh
node scripts/pick-to-label.mjs reels.csv --exclude labeled.csv > next.csv
```

A random sample of this feed is ~40% neutral and ~13% charged, so labelling at
random buys charged examples at four cents on the dollar. This picks rows by
what a label would actually tell you — predicted-charged rows to test
precision, rows near the confidence boundary, rows containing vocabulary the
tuning report says is missing — with per-class quotas so the sheet cannot refill
with comedy, plus a plain neutral slice so the benchmark still resembles the
ordinary feed. `humanLabel` comes out blank on purpose.

### Judging a detector change

`eval.mjs` is the gate for classifier changes; this is the equivalent for the
detector. A threshold edit gets judged by what it does to real decisions across
a real month, not by whether the reasoning sounded right.

```sh
node scripts/replay-detection.mjs reels.csv                # what it decides now
node scripts/replay-detection.mjs reels.csv --against HEAD # and what changed
```

The reason histogram is the useful half. A month of `within-baseline` means the
multiplier is too high; a month of `insufficient-charged-sample` means the
window is too small for how much of your feed is readable.

## Project layout

```
manifest.json        # build input — @crxjs rewrites this into dist/
vite.config.ts
src/
  content/           # only layer that touches instagram.com
    main-world.ts    #   MAIN world — reads shortcode from React fiber props
    dom.ts           #   container discovery + active-reel geometry
    detector.ts      #   dwell clock
    extractor.ts     #   caption / hashtags / audio / author
    session.ts       #   session id + gap rule
    hud.ts           #   diagnostic panel for live validation sessions
    overlay.ts       #   the interruption itself
    navigate.ts      #   the one place the page is sent somewhere
  background/        # service worker — router, storage, detection, intervening
  shared/            # types, contracts, taxonomy, detection, insights, defaults
  popup/             # React dashboard + trend chart
  options/           # React settings, day bars, session drill-down
scripts/
  eval.mjs           # classifier accuracy gate
  replay-detection.mjs  # detector change gate
  pick-to-label.mjs  # what to label next
assets/icons/
tests/
docs/
```

[`docs/INTERNALS.md`](docs/INTERNALS.md) is the deep reference: every constant,
the scoring and baseline maths, how identity is resolved, how the thing fails,
and what it can and cannot determine. Beyond that,
[`docs/architecture.md`](docs/architecture.md) is the one-page map,
[`docs/dom-notes.md`](docs/dom-notes.md) the Instagram DOM research,
[`docs/live-session-protocol.md`](docs/live-session-protocol.md) the manual
checks automated tests cannot cover, and [`docs/PAPER.md`](docs/PAPER.md) the
written-up version with the evaluation — its §7 still stands, though it
describes the system as of the log-only staging phase.

## A warning about the DOM layer

Instagram has no API — this reads a rendered page, and the selectors are the
least stable part of the system. Two findings worth knowing:

- **The URL does not identify the reel you're watching.** It names only the
  reel the page was opened on. Real identity comes from React fiber props,
  which needs a `"world": "MAIN"` content script to reach, and is treated as
  best-effort with a fallback.
- **The document doesn't scroll.** Scrolling happens in a nested div, so
  `window`/`document` scroll listeners never fire.

Four layers guard against this, because they fail differently:

- **Fixture tests.** `tests/fixtures/reelFeed.js` is a sanitized snapshot of
  the real structure, including captionless, hashtag-less, original-audio and
  unhydrated-placeholder variants. One test strips every class name from the
  tree and asserts extraction still works, so any selector that starts relying
  on Meta's generated classes fails immediately.
- **Degrading instead of stopping.** When neither the fiber bridge nor the
  author link resolves, every reel collapses to the same placeholder identity.
  That used to make the recycling check treat the whole feed as one reel: the
  view never closed, and nothing was recorded — a silent stop, from the one
  code path that runs precisely when Instagram has moved. Caption, hashtags and
  audio now separate reels that cannot be named, so a selector break costs
  identity rather than all tracking.
- **Runtime drift detection.** Fixtures only prove the structure we know about
  still parses. In production the extension counts how often the creator name
  resolves, how often the reel ID comes from React fiber versus the derived
  fallback, and which audio selector matched — and the options page has an
  **Extraction health** card plus outright warnings when a channel goes dark.
  The MAIN-world bridge publishes its own liveness, which separates "React
  internals were renamed" from "the script never ran": two failures needing
  different fixes that were otherwise indistinguishable.

  These counters decay fractionally, and that detail is the whole alarm. Both
  integer schemes were tried and both were wrong: rounding has fixed points, so
  the alarm latched on forever after a selector was fixed, and flooring — the
  cure for that — loses exactly one per sample, so a counter could only hold
  its value if *every* reel failed. Under it a 90% author-miss rate measured
  0.000 and nothing fired below a literal 100% failure. The one channel sitting
  at 100% is audio, and its warning working is what kept the rest hidden.
- **A diagnostic panel.** Settings → *Show the diagnostic panel on Instagram*
  overlays what was read from each reel as you scroll. Automating a logged-in
  Instagram session was considered and rejected — it needs real credentials,
  trips bot detection, is against Instagram's terms, and freezes the DOM of the
  day it was written, so it would not catch the drift it exists to catch.
  [`docs/live-session-protocol.md`](docs/live-session-protocol.md) is the
  30-minute manual pass it supports.

None of it replaces re-checking `docs/dom-notes.md` against the live site
before trusting a build.

## Known gaps

- **Audio extraction has been dark.** A capture of 700+ reels resolved an audio
  name on none of them. Per-selector counters were added to tell which channel
  is at fault; the answer needs one instrumented live session.
- **The charged label set is too thin to train or gate on.** See *Results*.
- **An on-device ML classifier is designed but deliberately unbuilt.** It stays
  gated on two things: an expanded label set, and evidence from a real week of
  logs that keyword rules are missing genuine charged loops. Building it before
  either would violate the measured-not-asserted discipline the rest of the
  project runs on.
