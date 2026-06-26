# Doomscroll

A Chrome (MV3) extension that tracks which Instagram Reels you actually watch,
classifies their mood/topic from on-screen caption text, and shows a local
dashboard with counts, watch-time stats, and a mood breakdown.

## Problem

Reels are an infinite, low-friction feed — easy to lose track of how much
you watch and what kind of content keeps pulling you back in. This extension
answers two questions locally, with no server and no tracking: _how much am
I watching_, and _what mood/category dominates_.

## How it works

1. **Content script** (`src/content/`) watches `<video>` elements on
   instagram.com with an `IntersectionObserver`. A reel only counts once it's
   ≥65% visible for ≥1 second (`reelDetector.ts`). Crucially, it only records
   a view when you scroll **forward** (down) past a reel — scrolling back up
   does not count.
2. Once a watch is confirmed, `domScraper.ts` pulls nearby caption/hashtag
   text off the DOM, filtering out UI chrome (buttons, "Like", "Comment", etc).
3. That text is scored against keyword/emoji tables
   (`src/classification/rules.ts`) by `classifier.ts` to produce a mood label
   (happy, calm, sad, angry, funny, romantic, motivational, fitness,
   educational, music, food, gaming, or undetectable). The classifier is
   exposed as `classify(text)`, so it can be swapped for an LLM-backed
   implementation (`llmClassifier.ts`) via the options page without touching
   any call sites.
4. The content script messages the **background service worker**
   (`src/background/`), which appends the record to `chrome.storage.local`.
5. The **popup** (`src/popup/`) reads storage and renders totals, time-window
   counts, average watch time, and a hand-drawn canvas pie chart of mood
   distribution. CSV export and "clear data" are also available from the
   **options page** (`src/options/`).

See [`docs/architecture.md`](docs/architecture.md) for the message-flow
diagram.

## Load the extension

1. Install dependencies and build the bundles:
   ```sh
   npm install
   npm run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select this folder
   (`IG reel Tracker/`).
4. Visit instagram.com and scroll through some reels — open the extension
   popup to see live stats.

During development, run `npm run watch` to rebuild on file changes (reload
the extension in `chrome://extensions` after each rebuild).

## Tests

```sh
npm test    # Vitest unit tests for classifier, stats, and reelDetector
npm run lint
```

## Project layout

```
manifest.json
src/
  content/         # content scripts — only layer that touches instagram.com
  background/       # service worker — message router, lifecycle events
  classification/    # classify(text) -> mood; heuristic + optional LLM engine
  lib/               # shared utilities: storage, message constants, stats
  popup/             # quick-glance dashboard
  options/           # settings: LLM toggle, export, clear data
assets/icons/
tests/
docs/
```

## Privacy

All data stays in `chrome.storage.local` on your machine. Nothing is sent
anywhere unless you explicitly enable the optional LLM classifier and supply
your own API endpoint/key in Settings.
