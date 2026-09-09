# Test fixtures

`reelFeed.js` is a synthetic Instagram Reels DOM fixture, mirroring the
generalized structure recorded in [`docs/dom-notes.md`](../../docs/dom-notes.md).
Handles, captions, audio names, shortcodes, and media URLs are invented — the
**structure** is what is under test.

It covers the null cases seen in the wild, because these are what break
extraction in practice rather than the happy path:

| Reel | Case |
|---|---|
| 0 | Fully populated: caption, hashtags, audio, shortcode |
| 1 | No hashtags |
| 2 | Original audio — no `/reels/audio/` link at all |
| 3 | Captionless, and no shortcode (exercises the fallback identity) |
| 4 | Unhydrated placeholder — player chrome mounted, nothing inside |

`mountFeed()` also fakes the layout jsdom does not compute. jsdom reports
every rect and scroll dimension as zero, so without stubbing, the
active-reel geometry and scroll-container search cannot be tested at all.

## Updating this fixture

When Instagram changes its markup, re-record `docs/dom-notes.md` from the live
site first, then update this file to match. Editing the fixture to make a
failing test pass — without confirming the new structure is real — converts a
useful alarm into a silent regression.
