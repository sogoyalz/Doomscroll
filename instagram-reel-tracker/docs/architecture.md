# Architecture

## Message flow

```
instagram.com page
      │
      ▼
┌─────────────────────────────┐
│ content/content.js          │  "the eyes"
│  ├─ reelDetector.js         │  IntersectionObserver: is a <video> ≥65%
│  │                          │  visible for ≥1s? -> onWatched(video, ms)
│  └─ domScraper.js           │  isLikelyReel(), extractContextText()
└─────────────────────────────┘
      │  classify(contextText)
      ▼
┌─────────────────────────────┐
│ classification/classifier.js│  keyword/emoji scoring -> { mood, score, ... }
│   (rules.js: keyword tables)│  swap for llmClassifier.js behind same API
└─────────────────────────────┘
      │  chrome.runtime.sendMessage({ type: REEL_WATCHED, record })
      ▼
┌─────────────────────────────┐
│ background/service-worker.js│  "the brain" — never touches the page
│  └─ messageHandlers.js      │  routes REEL_WATCHED -> storage.appendRecord()
└─────────────────────────────┘
      │  chrome.storage.local
      ▼
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ popup/popup.js               │      │ options/options.js          │
│  reads storage, renders      │      │  LLM toggle, export, clear  │
│  totals + canvas pie chart   │      │                             │
└─────────────────────────────┘      └─────────────────────────────┘
```

## Design decisions

- **Classification is isolated behind one function signature**
  (`classify(text) -> { mood, score, matched, wordHits, emojiHits }`) so the
  v1 keyword heuristic (`classifier.js` + `rules.js`) can be replaced with an
  LLM call (`llmClassifier.js`) without changing `content.js` or the popup.
- **The content script never writes to storage directly.** It only sends a
  `REEL_WATCHED` message; the service worker owns all writes. This keeps the
  page-facing code free of storage logic and avoids races between multiple
  tabs writing concurrently (`storage.appendRecord` does a single
  get-then-set per message).
- **`lib/stats.js` is pure** (records in, summary out, no `chrome.*` calls),
  so it's unit-testable without mocking the extension APIs and is shared
  between the popup's live view and any future export/reporting feature.
- **Dwell detection guards against tab-stuck-visible durations** by clamping
  watched time to 10 minutes — a reel left open in a backgrounded/minimized
  tab shouldn't skew average watch time.
