# Live session protocol

Everything in this project is tested against DOM shapes we already know about.
The shapes we do not know about are the ones that break, and no fixture can
contain them. This is the procedure for finding them: one instrumented session
against the real feed, with a checklist that turns "it seemed to work" into a
set of claims that either hold or do not.

Run it before a release, and after any Instagram change you have reason to
suspect. Thirty minutes.

## Why not an automated end-to-end test

Driving a logged-in Instagram session from Playwright was considered and
rejected. It needs real credentials in CI, it trips bot detection, 2FA breaks
it, and it is against Instagram's terms. More to the point it would not catch
the failure it exists to catch: a recorded or scripted session freezes the DOM
of the day it was written, which is exactly the thing that goes stale.

What automation does buy is regression cover on shapes already seen, and that
is what `tests/fixtures/reelFeed.js` is for. Step 6 below feeds it.

## Before you start

1. Build and load the unpacked extension from `dist/` (not the repo root — the
   manifest references `.ts` entries that only exist after a build).

   ```bash
   npm run build
   ```

2. In the extension's Settings, turn on **Show the diagnostic panel on
   Instagram**. Leave tracking on.
3. Open Settings → note the current **Extraction health** numbers, or clear
   data first if you want a clean read.
4. Open instagram.com/reels/ and confirm the panel appears top-right.

## The session

Scroll normally for about 30 minutes. Do not curate what you watch — an
artificially varied session hides exactly the "the feed locked onto one thing"
behaviour the detector is built for. Somewhere in the run, do each of these
once:

| # | Action | What it exercises |
|---|---|---|
| 1 | Scroll ~50 reels at a normal pace | The dwell tracker and the midpoint pick |
| 2 | Let one reel play through 3+ loops | `MAX_DWELL_MS` clamping |
| 3 | Flick past 5 reels fast without watching | `MIN_DWELL_MS` dropping short views |
| 4 | Switch to another tab for ~30s, come back | `visibilitychange` pause/resume |
| 5 | Switch to another tab for 3+ minutes | `MAX_HIDDEN_MS` finalizing the view |
| 6 | Navigate to a profile, then back to Reels | Scroll-container rebinding |
| 7 | Open a reel from Explore rather than the feed | A second feed layout |
| 8 | Let the machine sleep briefly, wake it | Clock jumps in the dwell tracker |
| 9 | Pause tracking from the popup, scroll, resume | `discard()`, not `flush()` |

Watch the panel as you go. The things worth stopping for:

- **`bridge: no-fiber`** — React internals moved. Nothing else in the session
  matters until this is fixed; identity is degraded for every reel.
- **`fallback` on most rows** — same failure, softer signature.
- **`caption 0c` on reels that visibly have captions** — the caption selector
  moved.
- **`audio: —` on every row** — the known-dark channel. If some rows now show a
  channel name, note which: that is the answer this instrumentation was added
  to get.
- **The same identity twice in a row** — a container was recycled without being
  noticed, and one reel's watch time is being banked against another's.

## Afterwards

1. **Panel count vs. stored count.** The panel's `reels:` total should match
   the popup's reel count for today, allowing for reels watched before the
   session. A large shortfall means views are being dropped between the content
   script and the worker.
2. **Extraction health.** Settings → Extraction health. Expect creator name and
   reel ID above 90%. Text will be lower — roughly a quarter of reels carry no
   text at all, which is a property of the feed, not a fault. Note which audio
   channel, if any, is matching.
3. **Export and eyeball.** Settings → Export data. In `doomscroll-reels.csv`:
   - Row count is close to the panel's total.
   - No duplicate `reelShortcode` within a few minutes of each other.
   - `startedAt`/`endedAt` are plausible; no zero or negative durations.
   - `sessionId` changes only where you actually stopped for two minutes.
   - `authorHandle` is populated.
4. **Detection log.** Settings → detection log. Entries should exist even
   though nothing fired; `insufficient-history` is the expected reason until
   seven days of history exist.
5. **Console.** One `content script loaded` line per Instagram tab and a
   non-zero `found N reel container(s)`. Zero containers on a reels page is the
   single most diagnostic line in the extension.
6. **Capture a fixture if anything moved.** Right-click a reel → Inspect, find
   the container, Copy → Copy outerHTML, and add a sanitized variant to
   `tests/fixtures/reelFeed.js`. Strip generated class names and any personal
   handles. This is how a one-off live finding becomes permanent cover.

## Checking the interruptions, separately

Only once you have actually reviewed a week of the detection log and decided
the thresholds are sane. This is a different session from the one above, and it
deliberately runs with the thresholds turned down — otherwise verifying the
block level means scrolling twenty consecutive sad reels on purpose.

1. Settings → turn on **Allow Doomscroll to interrupt me**. If the toggle is
   disabled, the cold-start rule has not been satisfied yet; that is the gate
   working, not a bug.
2. Temporarily lower `notifyAfterStreak` / `overlayAfterStreak` /
   `blockAfterStreak` so each is reachable in a minute or two of scrolling.
3. Scroll until each level fires once, and check:
   - The notification appears, and its wording describes the feed rather than
     you. Anything resembling "you seem sad" is a bug, not a phrasing quibble.
   - The overlay pauses the reel behind it.
   - **The block level's dismiss button becomes available after ten seconds.**
     If it ever does not, stop and fix it before anything ships — a prompt that
     cannot be dismissed is the one failure mode this design must not have.
   - Each level fires once per session, not once per reel.
4. Dismiss one with **Take a break**. The page should leave the reels feed for
   the Instagram home page — if it does not, the button is back to naming an
   outcome it does not produce. Navigate back to `/reels/` and confirm the
   break reminder appears with the remaining time, then use **End it, I'm
   good** and check the break shows as broken early.
5. Dismiss another with **Keep scrolling**, then check Settings → *Did
   interrupting help?*. Both should be recorded, nothing should sit at "no
   answer" except interruptions you genuinely left alone, and **breaks held**
   should show one of yours as broken.
6. Take a break and simply leave Instagram for the full window. It should show
   as held, and returning after the window should not count against it.
7. Close the tab while an overlay is up. That row should stay at "no answer" —
   the record is written before the overlay is shown precisely so a delivery
   that never landed is still counted.
8. Put the thresholds back.

## Recording the result

Note the date, the Instagram build if you can see it, the health numbers, and
anything from step 6, at the bottom of `docs/dom-notes.md`. That file carries a
"re-verify before store submission" warning for exactly this reason, and it is
only useful if the verifications are dated.
