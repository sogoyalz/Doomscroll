# Privacy Policy

**Last updated:** 8 August 2026

Doomscroll is a Chrome extension that tracks which Instagram Reels you watch
and flags when the feed is serving you a repetitive stream of similar content.

## The short version

Everything stays on your computer. There is no server, no account, and no
analytics. The extension makes no network requests of any kind — you can
verify this yourself: there is not a single `fetch`, `XMLHttpRequest`,
`WebSocket`, or `sendBeacon` call in the source.

## What is stored

Stored locally in your browser (IndexedDB and `chrome.storage.local`):

| Data | Why |
|---|---|
| Reel identifier (shortcode, or creator handle + video filename when no shortcode resolves) | To tell one reel from another |
| Caption text, hashtags, audio track name | The only signal available for categorising content |
| Watch duration, start and end time | Watch-time stats and binge detection |
| Session identifier (a random UUID) | To group a continuous stretch of scrolling |
| Assigned category and confidence | The dashboard breakdown |
| Detection log entries | So you can review what the detector would have flagged |
| Creator handle | Per-creator watch-time stats on the options page |
| Interruption records (level, what prompted it, what you did about it, and whether a break you took held) | So you can see whether interrupting you actually helped |
| Whether the last save failed | So the dashboard can say "reels aren't being saved" instead of showing an empty day |
| Your settings | To remember your preferences |

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

| Permission | Reason |
|---|---|
| `storage` | Save your settings and viewing history locally |
| `alarms` | Run daily maintenance (rolling up stats, deleting old data) — a Manifest V3 background worker is shut down when idle and cannot use timers for this |
| `notifications` *(optional)* | Show the gentlest break reminder. Requested only when you switch interventions on, never at install. Off by default, and unavailable until the extension has a week of your own history. Notifications are raised locally by the extension itself — nothing is pushed from a server, because there is no server |
| `https://*.instagram.com/*` | Read reel captions on the page. This is the only site the extension runs on |

## How long data is kept

Raw per-reel history is deleted after **90 days**. Daily summaries are kept
longer, because comparing today against your own past is the whole point of
the detection, and summaries contain counts rather than captions.

## Your control

- **Export** — Settings → Export, as CSV: your reels, the detection log, and
  any interruptions, as separate files
- **Delete** — Settings → Delete history removes all tracked history
- **Uninstalling** the extension removes everything, including settings

## Sharing

Nothing is shared, sold, or transmitted. There is nobody to share it with:
no backend exists.

## Changes

Material changes to this policy will be noted here with an updated date.

## Contact

Open an issue at https://github.com/sogoyalz/Doomscroll/issues
