# Privacy Policy

**Last updated:** 23 November 2026

Doomscroll is a Chrome extension that tracks which Instagram Reels you watch
and flags when the feed is serving you a repetitive stream of similar content.
It is not affiliated with, endorsed by, or made by Instagram, Meta, or Google.

## The short version

Everything stays on your computer. There is no server, no account, and no
analytics. Reel text and reviews are never sent to a server. The optional trained
model and its runtime are bundled with the extension; inference reads these
local extension files. The developer build downloads pinned public model files
from Hugging Face, but an installed extension does not download models or code.


## What is stored

Stored locally in your browser (IndexedDB and `chrome.storage.local`):

| Data                                                                                                                           | Why                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Reel identifier (shortcode, or creator handle + video filename when no shortcode resolves)                                     | To tell one reel from another                                                       |
| Caption text, hashtags, audio track name                                                                                       | The only signal available for categorising content                                  |
| Watch duration, start and end time                                                                                             | Watch-time stats and binge detection                                                |
| Session identifier (a random UUID)                                                                                             | To group a continuous stretch of scrolling                                          |
| Assigned category and confidence                                                                                               | The dashboard breakdown                                                             |
| Detection log entries                                                                                                          | So you can review what the detector would have flagged                              |
| Creator handle                                                                                                                 | Per-creator watch-time stats on the options page                                    |
| Interruption records (level, what prompted it, what you did about it, confirmed delivery and any request to end a break early) | So you can review intervention decisions and responses                              |
| Whether the last save failed                                                                                                   | So the dashboard can say "reels aren't being saved" instead of showing an empty day |
| Your settings                                                                                                                  | To remember your preferences                                                        |

Human topic/tone reviews, model identifiers, and uncertainty/fallback status are
stored with each reel and included in exports. Reviews are deleted with history
and are not automatically used for training.

**Creator handles are included.** They are stored alongside each reel for the
per-creator breakdown, and when a reel's shortcode cannot be resolved the
identifier itself falls back to `creator-handle|video-filename`. Either way the
handles of accounts whose reels you watched are present in stored data and in
exports.

## What is not stored

- No screenshots, images, video, or audio
- No direct messages — the extension does not run on `/direct/`
- No account credentials — it does not run on `/accounts/` either, and never
  reads form fields, cookies, or your Instagram login
- No browsing history outside instagram.com
- Nothing at all from any other website

## Permissions, and why each one is needed

| Permission                   | Reason                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `offscreen` | Run the bundled pretrained text model in a hidden extension document. No page capture, audio recording, or remote inference. |
| `storage`                    | Save your settings and viewing history locally                                                                                                                                                                                                                                                                  |
| `alarms`                     | Run daily maintenance (rolling up stats, deleting old data) — a Manifest V3 background worker is shut down when idle and cannot use timers for this                                                                                                                                                             |
| `notifications` _(optional)_ | Show a desktop break reminder when you enable interventions, or a single sample when you choose **Test desktop notification** in versions with that control. Automatic reminders require a viewing baseline. The sample uses fixed text and creates no viewing or intervention record. |
| `https://*.instagram.com/*`  | Read reel captions on the page. This is the only site the extension runs on                                                                                                                                                                                                                                     |

## How long data is kept

Raw per-reel history is deleted after **90 days**. Daily summaries are kept
longer, because comparing today against your own past is the whole point of
the detection, and summaries contain counts rather than captions.

Completed views may temporarily be queued in local storage to recover failed
message delivery. Pending copies expire after **24 hours** and are removed
when tracking is paused or history is deleted. A break with no recorded early
end does not establish that scrolling stopped.

## Your control

- **Export** — Settings → Export, as CSV: your reels, the detection log, and
  any interruptions, as separate files
- **Delete** — Settings → Delete history removes all tracked history
- **Uninstalling** the extension removes everything, including settings

## Sharing and limited use

Nothing is sold, shared, or transmitted. There is no backend and no third
party.

The data listed above is used only to show you your own Reels history and to
decide, on your device, whether the feed has become unusually repetitive.
It is not sold. It is not used for advertising, credit, lending, or any
purpose unrelated to that single feature. It is not transferred to anyone,
except for a CSV you choose to export onto your own computer.

## Changes

Material changes to this policy will be noted here with an updated date.

## Contact

Open an issue at https://github.com/sogoyalz/Doomscroll/issues
