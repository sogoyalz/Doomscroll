# Controlled beta tester guide

This candidate is for consenting adults using desktop Chrome 116 or newer.
Use a current secure Chrome release. Participation is optional; stop at any
time. No account credentials or viewing exports should be sent to the developer.

## Install and prepare

1. Obtain the reviewed release ZIP and its SHA-256 from the project owner.
   Verify the checksum, extract the archive, and load the extracted folder
   using Chrome's **Load unpacked** control. Keep only one Doomscroll copy enabled.
2. Confirm version 1.1.0. Tracking is initially enabled; interruptions are off.
   Open Settings and read the privacy policy. Pause tracking if you do not want
   the extension to observe your feed. History remains on your computer.
3. Enable the diagnostic panel only during a capture check. Its rows contain
   viewing identifiers and creator handles; do not share screenshots of it.

## First capture check

Use a single Instagram tab and stay within one local calendar day. Note the
popup's initial daily count privately. Watch ten reels normally, allowing at
least one second before each transition. After the tenth transition, stop
scrolling and wait for save replies. Note the popup's final count. Compare the
increase with ten and with the panel's confirmed-save increase. Record counts
only. Repeat enough sessions to reach at least 50 independently counted views.

The current reel is not a completed view until a transition finalizes it.
Very fast views below 250ms are intentionally excluded. The panel counts only
the current page lifetime; the popup includes all saved views for the day.
An unconfirmed view may still be recovered later; report the mismatch without
assuming it was lost or retrying it yourself.

## Two weeks of normal use

- Check pause/resume, background/return, a browser restart, and entry from Reels
  and Explore. Confirm pause prevents new recorded views.
- Check that navigation into Direct and Accounts produces no recorded views.
  Do not share message contents or account settings.
- Verify extraction only against fields visibly present. Privately count at
  least 20 readable author/audio examples per layout; report aggregate totals.
- Review any unwanted interruptions. Leave interruptions off unless you choose
  to enable them after the baseline requirements are satisfied. Do not seek
  upsetting content or modify your browsing to trigger an alert.
- Export or deletion checks use your own local files. Deletion is permanent;
  perform it only if you want that history removed. Never send the export.

If tracking continues while paused, deleted history returns, a reel is assigned
another reel's identity, or dismissal fails, stop the affected test and report
the failure category. Keep private evidence locally.

## Report only minimized results

Use the blank [results template](beta-results-template.md). Share version,
browser version, locale/layout, dates, aggregate denominators and counts,
failure category, and pass/fail/untested. Omit captions, handles, reel IDs,
account names, screenshots, raw exports, cookies, credentials, and messages.
The owner keeps participant identities outside Git. See the predeclared
[acceptance criteria](beta-acceptance.md) before collecting results.
