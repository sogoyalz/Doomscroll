# Architecture

## Message flow

```
instagram.com page
      │
      ▼
┌─────────────────────────────┐
│ content/content.ts          │  "the eyes"
│  ├─ reelDetector.ts         │  IntersectionObserver: is a <video> ≥65%
│  │                          │  visible for ≥1s going forward? -> onWatched(video, ms)
│  └─ domScraper.ts           │  isLikelyReel(), extractContextText()
└─────────────────────────────┘
      │  chrome.runtime.sendMessage({ type: REEL_WATCHED, record })
      ▼
┌─────────────────────────────┐
│ background/service-worker.ts│  "the brain" — never touches the page
│                             │  classifyText() -> appendRecord() -> storage
└─────────────────────────────┘
      │  chrome.storage.local
      ▼
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ popup/popup.ts              │      │ options/options.ts           │
│  reads storage, renders      │      │  LLM toggle, export, clear  │
│  totals + mood breakdown     │      │  hosts on-device ML model   │
└─────────────────────────────┘      └─────────────────────────────┘
```

## Classification pipeline

```
contextText
    │
    ▼
classification/classifier.ts   keyword/emoji scoring (always available)
    │  falls back if LLM/ML unavailable
    ├─ classification/llmClassifier.ts    Claude API (requires API key in settings)
    └─ classification/transformersClassifier.ts  on-device ONNX model (options page)
```

All three expose the same `classify(text): ClassifyResult` signature so the
background worker can swap engines without touching call sites.

## Shared modules

| File | Purpose |
|------|---------|
| `src/lib/types.ts` | All shared types + `MESSAGE_TYPES` constants |
| `src/lib/storage.ts` | `chrome.storage.local` wrapper, serialized `appendRecord` |
| `src/lib/stats.ts` | Pure aggregation functions (records → dashboard data) |

## Design decisions

- **Classification is isolated behind one function signature**
  (`classify(text) -> { mood, score, matched, wordHits, emojiHits }`) so the
  keyword heuristic can be replaced with an LLM or on-device model without
  changing the background worker or popup.
- **The content script never writes storage directly.** It sends a
  `REEL_WATCHED` message; the service worker owns all writes. This avoids
  races between concurrent tabs (`storage.appendRecord` serializes writes).
- **`lib/stats.ts` is pure** (records in, summary out, no `chrome.*` calls),
  so it's unit-testable without mocking extension APIs.
- **Watch time excludes tab-hidden time.** A `visibilitychange` listener
  pauses the timer when the tab is hidden and resumes it on return.
- **Scroll-up does not count.** A reel is only recorded when the video exits
  above the viewport (`boundingClientRect.top < 0`), meaning the user
  scrolled forward past it.
