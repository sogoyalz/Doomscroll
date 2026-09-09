# Doomscroll: On-Device Detection of Algorithmic Content Loops in Short-Form Video Feeds

**Sourav Goyal**
August 2026

---

> **Status note.** This paper describes the system as of the log-only staging
> phase. The intervention ladder described as future work in §9 has since been
> built and ships disabled by default, the baseline is now recency-weighted
> rather than a flat window, and the dashboard has gained trend, per-day
> composition and session views. For the current mechanics see
> [`INTERNALS.md`](INTERNALS.md); the evaluation in §7 still stands.

## Abstract

Short-form video feeds such as Instagram Reels optimise for engagement, which
can surface long, self-reinforcing runs of a single emotional register — a
pattern a viewer rarely notices in the moment. We present **Doomscroll**, a
Manifest V3 Chrome extension that measures Reels consumption and detects when
the feed has locked onto a charged content category, entirely on the user's own
machine with no server, account, or network traffic.

The system contributes three things beyond a conventional screen-time counter.
First, a resilient content-extraction layer that recovers per-reel identity from
React fiber state — necessary because the page URL does not track the active
reel — and detects its own decay when the host site changes. Second, a **two-tier
classification taxonomy** that separates *charged* emotional categories, which
drive detection, from *topic* categories, whose only job is to keep ordinary
content out of an over-broad "neutral" bucket; classification is a transparent,
multilingual keyword model rather than a black box. Third, an **anomaly detector
that compares the current window against the user's own trailing baseline**,
measured over the charged slice of the feed only, with explicit cold-start
handling and a log-only staging phase before any intervention is permitted.

We evaluate the classifier against 701 reels drawn from a real feed using a
purpose-built harness that avoids a subtle self-measurement trap. Text-derived
classification reduced the unreadable-content rate among reels with text from
roughly 70% to 30%, and lifted recall on emotionally charged captions from 1-of-5
to 5-of-5 on a held probe set. We report the point at which keyword rules
plateau, and argue that for this application *charged recall*, not overall
coverage, is the metric that matters. The system ships with interventions
disabled by default and treats every displayed statement as a claim about the
content shown, never about the viewer.

---

## 1. Introduction

Recommender-driven feeds are engineered to maximise watch time. A known failure
mode for the user is the *content loop*: the algorithm detects engagement with a
particular emotional register — sadness, heartbreak, anxiety, outrage — and
begins serving more of it, faster than the viewer consciously registers. Unlike
raw screen time, which the user can at least estimate, a content loop is close to
invisible from the inside.

Existing digital-wellbeing tools almost universally measure *quantity* (time,
opens, unlocks). The quantity problem is well understood and largely solved. The
harder and more useful problem is *quality*: detecting when the feed has narrowed
onto one emotional register relative to what is normal for that specific person.
This paper describes a working system for the quality problem, built and measured
against a real feed, and is deliberately explicit about where it succeeds, where
it plateaus, and where it cannot go without a fundamentally different signal.

**Contributions.**

1. A content-extraction layer robust to a feed with no public API, including the
   finding that reel identity must be recovered from framework internal state
   rather than the URL, and a runtime self-check that detects selector decay
   before it silently corrupts data (§4).
2. A two-tier, closed-ended taxonomy and a transparent multilingual keyword
   classifier that distinguishes "text present but no charged signal" from "no
   text at all" — a distinction that turns out to be load-bearing for the
   detector (§5).
3. A per-user, baseline-relative anomaly detector that measures dominance over
   the charged slice of the feed only, with a principled cold-start policy and a
   mandatory log-only observation phase (§6).
4. An evaluation methodology, and honest measured results, that surface a common
   self-measurement pitfall and the practical ceiling of keyword classification
   on a real multilingual feed (§7–8).

---

## 2. Background and Design Constraints

The system runs as a Chrome Manifest V3 (MV3) extension. MV3 imposes constraints
that shape the entire architecture:

- **The background context is ephemeral.** MV3 service workers are terminated
  after roughly 30 seconds of inactivity. No state may be held in memory across
  events; anything periodic must be driven by the `chrome.alarms` API and backed
  by persistent storage.
- **There is no host API.** Instagram exposes no public interface for the feed.
  The extension reads a rendered page, which makes the DOM the least stable part
  of the system and its selectors the primary long-term maintenance cost.
- **Isolation worlds.** Content scripts execute in an isolated JavaScript world
  and cannot read expando properties that the page's own scripts attach to DOM
  nodes — a constraint that directly affects reel identification (§4).

A guiding principle throughout is **local-only operation**: no data leaves the
device. This is both a privacy stance and a simplification — there is no backend
to secure, and the threat model reduces to what a hostile page can do to a
content script.

The build uses Vite with the CRXJS plugin; the UI is React; persistent reel
history lives in IndexedDB (via `idb`), and small settings live in
`chrome.storage.local`. The codebase is TypeScript throughout, with a unit-test
suite of 617 tests covering the pure logic layers.

---

## 3. System Architecture

Data flows in one direction, from the page to storage to the dashboard:

```
instagram.com
   │  content script (isolated world) + MAIN-world fiber bridge
   ▼
detect which reel is on screen → time it → extract its text
   │  chrome.runtime.sendMessage(REEL_VIEW_LOGGED)
   ▼
service worker: classify → persist (IndexedDB) → aggregate → detect (log-only)
   │  chrome.storage / IndexedDB
   ▼
React popup (dashboard) + options page (tuning, detection log, export)
```

Three design rules recur:

- **The content script only observes.** It reports what it saw; the service
  worker owns every write, so concurrent tabs cannot corrupt shared counters.
- **The pure logic is separated from the platform.** Classification, aggregation,
  and detection are pure functions with no `chrome.*` calls, which is what makes
  them unit-testable without mocking the browser.
- **Everything periodic is alarm-driven and storage-backed**, because the
  background worker cannot be assumed to survive.

---

## 4. Content Extraction

### 4.1 The active-reel and identity problem

Two findings, established by live inspection, drive this layer.

**The URL does not identify the active reel.** Landing on `/reels/` redirects
once to `/reels/<shortcode>/` for the first reel and then never updates —
not on scroll, not when using the site's own next-reel control. A "reels
scrolled" counter built on URL changes therefore reports approximately one per
page load. The real shortcode lives in the page's client-side framework state
(`memoizedProps.media.code` on a React fiber node). Because a content script in
the isolated world cannot read these page-set properties, the system registers a
**second content script in the MAIN world** whose sole job is to walk the fiber
tree, recover the shortcode, and republish it onto the DOM as a `data-*`
attribute the isolated world can read. This is the single most fragile
dependency in the system and is treated as best-effort, with a fallback identity
derived from the author handle and the video source filename.

**The active reel is geometric.** The reel a user is watching is the container
straddling the viewport's vertical midpoint. Per-video autoplay state is useless
for this — every mounted `<video>` reports `paused: true, currentTime: 0`
regardless of what is on screen.

### 4.2 Dwell timing

Watch time is computed by a pure state machine driven by an injected clock, so
its rules are testable without stubbing browser observers. It excludes time spent
with the tab hidden, clamps implausibly long durations, and — because the feed is
virtualised — snapshots a reel's caption text *at the moment it becomes active*,
since by the time it scrolls away the container may already hold the next reel's
content. A subtle correctness issue handled here is container recycling: the
framework reuses a DOM node for a new reel in place, which the tracker detects by
comparing reel identity on a heartbeat and closing the previous view.

### 4.3 Surviving selector decay

Because the host site ships UI changes on its own schedule, extraction is
guarded two ways. Offline, a sanitised DOM fixture pins the structure the code
knows about; one test strips every generated class name and asserts extraction
still works, so any selector that begins depending on the site's volatile atomic
class names fails immediately. Online, the extension tracks whether the author
handle — a field present on every real reel — resolves; a sustained failure rate
is strong evidence the markup moved, and the options page surfaces a warning
rather than silently recording empty reels for a week.

---

## 5. Classification

### 5.1 A two-tier taxonomy

The initial design used a single set of emotional categories. Measured against a
real feed, roughly 70% of reels with readable text classified as "neutral." This
was not primarily a vocabulary gap: a normal feed is mostly *topical* — comedy,
food, sports, music — content that carries text but no *emotional* vocabulary.
"Neutral" was the classifier correctly reporting the absence of an emotional
signal against a taxonomy that could not name most of the feed.

The taxonomy is therefore **two explicit tiers**, closed-ended so the detector's
share arithmetic remains meaningful:

| Tier | Categories | Role |
|---|---|---|
| **Charged** | joyful, sad, breakup, anxious, angry, motivational, romantic | Emotional registers; the only categories the detector acts on. |
| **Topic** | comedy, music, dance, food, fitness, sports, tech, fashion, travel, gaming, pets, art, entertainment | Name the non-emotional majority of the feed so it does not pool into "neutral". |

Two further outcomes are deliberately distinguished: **`neutral`** means the
classifier read text and found nothing charged; **`unclassified`** means there
was no text to read at all. Collapsing the two would let a day of text-free clips
pass as genuinely calm, and would poison the trailing baseline the detector
depends on.

### 5.2 The rules engine

Classification is a transparent keyword model, chosen over an opaque one so that
every verdict is inspectable and every change is a diff in a lexicon file. It
scores caption text, hashtags, and audio-track name against per-category tables
of words, phrases, hashtags, and emoji. Signals are weighted by how deliberate
they are: a hashtag is an authorial label (weight 3), a caption phrase is written
prose (2), a caption word is weakest (1), and audio counts at half weight because
the user did not choose the song's title. Confidence combines how strong the
winning score is with its margin over the runner-up, so a reel matching two
categories equally is reported as ambiguous rather than as a confident call. On
an exact tie, a documented order resolves the winner and — critically — places
charged categories above topic ones, so an emotionally charged reel that is also
on a topic (a heartbreak *song*, a gym *motivation* clip) is counted for what the
detector cares about.

### 5.3 Multilingual support

The target feed is substantially Hindi and Hinglish. The lexicon carries
romanised and Devanagari terms for the charged categories, and the tokenizer was
corrected to retain Unicode combining marks (`\p{M}`): in Devanagari and several
other scripts the vowel signs are marks rather than letters, and splitting on
them had been shattering every non-Latin word into unmatchable single characters
— a bug that would have made the classifier silently blind to an entire language.

### 5.4 Tuning without data loss

Because stored reel events retain the caption, hashtags, and audio name they were
classified from, the lexicon can be revised and the entire history re-labelled on
reload by bumping a version constant. Tuning is thus an iterative loop against
real data rather than a destructive reset.

---

## 6. Pattern Detection

### 6.1 Baseline-relative dominance over the charged slice

A flag requires two conditions to hold together. First, one category must
**dominate** the recent window. Second, that must exceed a multiple of the user's
**own trailing rate** for that category. The second condition is the entire
point: a fixed global threshold ("60% sad content is a problem") false-flags
anyone whose ordinary diet simply runs heavier in a category — exactly the
population a wellness tool should not patronise. Comparing against the person's
own baseline makes the signal mean *"this is unusual for you."*

Dominance is measured over the **charged reels only**. This corrects a
consequential flaw: when topics and neutral counted toward the denominator, a
genuine five-in-fifteen breakup run on a feed that is mostly comedy and food read
as 33% and never crossed threshold — the detector was effectively disabled on any
normal feed. Excluding topics and neutral from the denominator, exactly as
text-free reels are already excluded, asks the question actually worth answering:
*among the emotional reels, is one register dominating?* A minimum charged-sample
floor prevents a "100% breakup" verdict built from two reels.

### 6.2 Cold start, without a fallback

The baseline does not exist in the first week of use. The system does **not**
substitute a fixed threshold during that gap, because doing so would reintroduce
precisely the false positives the baseline exists to prevent — during the very
week the user is deciding whether to trust the tool. Below a minimum history, the
detector refuses to decide and records why. Interventions ship disabled by
default and become available only once enough history exists.

### 6.3 Log-only staging

Detection runs on every reel but, in the shipped configuration, only writes a log
entry — it never notifies, overlays, or blocks. Every evaluation is recorded with
the inputs behind it, near-misses included, and consecutive identical outcomes are
collapsed into a single counted row so that a session's worth of checks stays
reviewable. This log is the artifact by which the detector's thresholds are meant
to be validated against a real week of one person's scrolling *before* any
intervention is enabled — a deliberate staging decision, not an unfinished
feature.

---

## 7. Evaluation

### 7.1 Methodology, and a pitfall

Classifier quality is measured against reels labelled by hand. A first,
naive workflow pre-filled each label with the classifier's own prediction and
asked the human only to correct the mistakes. Run without careful correction,
this produces a perfect score — because the labels *are* the predictions. A
confusion matrix that is a flawless diagonal across hundreds of samples and
twenty categories is the signature of this self-agreement, not of a good
classifier. We flag it explicitly because it is an easy and tempting way to
manufacture a meaningless accuracy figure.

The corrected methodology uses a labelling tool that shows the reel's text but
**never the classifier's guess**, removing the anchoring bias, and a command-line
harness that bundles and runs the exact shipped classifier over the labelled
file, reporting overall accuracy, per-category precision and recall, the neutral
rate, and a confusion matrix. A companion mode reports, for reels that classified
as neutral, the most frequent words and hashtags the lexicon does not yet
recognise — turning "why is so much neutral" from a guess into a ranked, tunable
list.

### 7.2 Results

Measured over 701 reels from a real feed:

| Metric | Value | Note |
|---|---|---|
| No text at all (`unclassified`) | ~24% | Structural floor; no caption, hashtags, or audio. |
| Neutral among readable, initial | ~70% | Single-tier emotional taxonomy. |
| Neutral among readable, after two-tier + data-driven tuning | ~30% | Topic tier + entertainment + multilingual terms + charged-recall policy. |
| Charged recall on a held probe set | 1-of-5 → 5-of-5 | Natural-language/idiomatic terms, then favouring charged recall over per-reel precision. |

Two observations matter more than the headline numbers.

**Keyword rules plateau.** The residual ~30% is not a vocabulary gap that more
terms would close. It resolves into three structural pieces: a small number of
foreign-language viral clips reposted many times; reels that are genuinely
content-free (emoji, mentions, or discovery hashtags only), which are unreadable
in the same sense as the no-text bucket; and descriptive prose that carries no
keyword but that a human reads instantly. Pushing past the plateau with more
keywords amounts to overfitting to one feed's specific viral posts.

**Charged recall is the metric that matters.** Because the tool exists to catch
negative-content loops, a sad reel mis-read as neutral is a miss the detector can
never recover, whereas a comedy reel left neutral is cosmetic. The finding that
natural-language emotional captions — *"why does it always hurt like this,"
"feeling so empty," "bas ab bahut hua"* — were leaking to neutral is thus more
important than the overall neutral rate, and improving their recall is the change
that most improves the product. Emotional expression is far more varied and
idiomatic than topic vocabulary, which makes charged recall both the harder and
the more consequential problem.

---

## 8. Limitations

- **Text is the only signal.** Reels that are purely visual or musical carry no
  caption, hashtag, or audio name and cannot be classified from text. On the
  measured feed this is roughly a quarter of all reels — a hard floor that no
  lexicon or model over text can move. Closing it requires vision or audio
  analysis, a substantially larger and different system.
- **Keyword recall has a ceiling**, reached on the measured feed at ~30% neutral
  among readable. Descriptive and idiomatic emotional language, and non-English
  content beyond the enumerated terms, are where a learned model would help.
- **The DOM layer is a maintenance liability.** With no host API, extraction
  depends on selectors that the host site can change without notice. The system
  mitigates this with fixtures and runtime drift detection, but cannot eliminate
  it.
- **Not yet validated live end-to-end.** The pure logic is unit-tested and the
  classifier is measured against real exported reels, but the full capture path
  and the detector's thresholds have not been validated against a sustained real
  session — which is precisely what the log-only staging phase is designed to
  produce.

---

## 9. Future Work

One change already followed directly from the evaluation and has been applied: a
**charged-recall policy** so that a reel carrying a genuine, authored charged
signal is not dropped to neutral merely because it is weak or ties between two
charged categories. This is safe because the detection layer already enforces
precision through its dominance-plus-baseline requirement, so favouring recall at
the per-reel label level cannot by itself cause a false alarm; audio-only matches
are excluded, since a song title routinely mismatches its content. It lifted
charged recall on the probe set to 5-of-5 and reduced neutral-among-readable to
~30%.

The remaining direction is an optional **on-device
learned classifier** (multilingual zero-shot inference), gated on evidence rather
than added speculatively: it is justified only if a real week of log-only data
shows the keyword classifier missing genuine charged loops, since its primary
advantage — semantic reading of descriptive and foreign-language text — benefits
mostly topical content that does not affect the core loop. Beyond the text
signal, vision or audio analysis is the only path past the structural
no-text floor.

---

## 10. Privacy and Ethics

The system is built to be defensible on the terms it sets for itself.

- **Local only.** No account, no server, no analytics, and no network requests
  of any kind. Reel history lives in the browser and is deleted after 90 days;
  daily summaries, which hold counts rather than captions, are kept longer.
- **The user controls the data.** Tracking can be paused in one click; history
  can be exported or deleted at any time. Exports defend against spreadsheet
  formula injection, since captions are attacker-controlled text.
- **Claims about content, never about the person.** The system detects
  repetition in a text-derived content *category*; it is not a read of the
  viewer's emotional state. Someone perfectly fine can trip it by falling into an
  algorithmic loop, and someone having a hard week may want the content it would
  flag. Every user-facing statement is therefore worded as a claim about what the
  feed showed, and any intervention is designed to be dismissible with a single
  deliberate action.
- **Interventions are off by default** and, by construction, cannot act until a
  personal baseline exists and the user has enabled them.

---

## 11. Conclusion

Doomscroll demonstrates that the interesting half of a "digital wellbeing" tool
— detecting a personalised content-anomaly rather than counting minutes — can be
built to run entirely on-device, transparently, and honestly. The engineering
contributions are a resilient extraction layer for a feed with no API, a two-tier
taxonomy that separates the emotional signal from topical noise, and a detector
that measures each person against their own baseline over the slice of the feed
that actually matters. The evaluation is deliberate about its own integrity: it
names the self-measurement trap that manufactures fake accuracy, reports where
transparent keyword classification plateaus, and argues that for this problem the
right metric is recall on charged content rather than overall coverage. What
remains — a learned classifier for idiomatic and multilingual emotional language,
and validation against sustained real use — is scoped as evidence-gated future
work rather than as speculative addition, which is itself the discipline the
project set out to keep.

---

*Reference implementation and evaluation tooling: `github.com/sogoyalz/Doomscroll`.*
