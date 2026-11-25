# Chrome Web Store submission

Everything the listing form asks for, written out. Copy from here rather than
improvising in the form — the permission justifications in particular are
reviewed against what the manifest actually declares, and a mismatch is the
most common cause of rejection.

## Single purpose

> Doomscroll tracks which Instagram Reels the user watches and shows them when
> the feed has locked onto one kind of content.

Reviewers reject listings whose stated purpose is broader than the code. This
one is narrow and matches: one site, one behaviour, no secondary features.

## Permission justifications

Each must match `manifest.json` exactly. Copy verbatim into the form.

| Permission                  | Justification                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `offscreen` | Runs the bundled pretrained text model in a hidden extension document. All inference is local; no screen or audio capture. |
| `storage`                   | Saves the user's settings and their local viewing history. No data leaves the device.                                                                                                                                                                                                                              |
| `alarms`                    | Runs daily maintenance — rolling up statistics and deleting history older than 90 days. A Manifest V3 service worker is terminated when idle and cannot use `setTimeout` for scheduled work, so alarms are the only mechanism available.                                                                           |
| `notifications` (optional) | Shows local desktop reminders when the user enables interventions and their viewing history supports a detection, or when they reach a Reels time limit they chose. The time limit works from the first session. In versions with a notification test, the user can also request one sample from Settings. |
| `https://www.instagram.com/*` | Reads the caption, hashtags, and audio name of the reel currently on screen in order to categorise it. This is the only site the extension runs on, and it is excluded from `/direct/` and `/accounts/`.                                                                                                           |

**Remote code:** none. Everything executes from the packaged bundle; the
extension sends no reel data externally. Model weights and WASM execute from the package.

**Data usage disclosures.** Select the following for this build. Google asks
developers to disclose data handled on the device as well. [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

| Dashboard field | What Doomscroll handles locally |
| --- | --- |
| Personally identifiable information | The creator's Instagram handle, including in some fallback reel identifiers. |
| Web history | The sequence of Instagram Reels viewed, identified by reel ID and timestamp. |
| User activity | Time spent on each reel, viewing sessions and responses to break reminders. |
| Website content | Reel captions, hashtags and audio attribution read from the page. |

Certify the three limited-use statements for this build. Data stays on the
device and is used only for the extension's stated purpose.

## Listing copy

Paste this into the form. Do not add superlatives, health claims, or a claim
that the extension is official.

**Name:** Doomscroll

The name does not include "Instagram", "Google", or "Chrome". That is
deliberate. Store names that imply the product is made by the site it runs on
are rejected.

**Short description** (132 characters maximum):

> Tracks your Instagram Reels watch time and tells you when the feed keeps repeating one kind of content. Stays on your device.

**Detailed description:**

> Doomscroll records which Instagram Reels you watch and how long each one stays on screen. It groups them into 21 text-based categories and shows the mix.
>
> Choose a Reels time limit to get a break reminder from your first session. The timer counts active viewing and offers a five-minute snooze.
>
> You can choose which types of emotionally charged content to watch for. When one repeats unusually often compared with your own recent history, Doomscroll can suggest a break. It needs about a week of history for that comparison. Break reminders are off until you turn them on.
>
> Nothing is sent anywhere. There is no account, no server, and no analytics. Tracking is disabled on Instagram direct messages and account settings, and it does not read your login or cookies.
>
> You can pause tracking, export your history as CSV, or delete it. Daily maintenance removes raw history older than 90 local days. Daily summaries remain until you delete your history.
>
> The categories describe the reel's text, not your mood. A reel with no usable text signal is left uncategorised.
>
> Doomscroll is not affiliated with, endorsed by, or made by Instagram, Meta, or Google.

**Suggested category:** Lifestyle → Well-being
**Language:** English

**Privacy policy URL**, entered exactly:

`https://sogoyalz.github.io/Doomscroll/PRIVACY`

## What to do when you submit

1. Sign in to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   First-time publishers register and pay Google's one-time fee. Enable
   2-Step Verification on the publisher account. For a new listing, select
   **New item**. Build the upload with `npm run package`. Upload `doomscroll-1.1.2.zip` only.
   Do not upload the repository folder or `dist/` by hand.
2. Paste the single purpose, the permission justifications, and the listing
   copy from this file.
3. Under **Privacy practices**, enter the policy URL, select the four data
   categories above, and complete the limited-use certifications.
4. Attach `store-assets/dashboard-demo.png` and `store-assets/settings-demo.png`.
   Both are 1280×800. Both use synthetic demonstration data. If the form has a
   caption field, say so.
5. Attach `store-assets/doomscroll-store-icon.png` where the form asks for the store icon.
6. The privacy policy URL above was reachable on 23 November 2026. Confirm
   it still opens before submission.
7. For the beta, choose **Distribution → Private** and add consenting
   testers' Google Account email addresses under the publisher account's
   trusted tester settings. Save the draft and select **Submit for review**
   when ready. Google reviews private items too. After private publication,
   share the item link with those testers. [Distribution settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
8. When the live and beta checks in the release plan pass, change visibility
   to **Public** and submit the change through the dashboard.
   After approval, every later package upload needs a higher version in both
   `manifest.json` and `package.json`.

**Reviewer test instructions** (paste into the Test instructions tab)

> In desktop Chrome, use an Instagram account with access to Reels. Open the Doomscroll popup and note today's reel count. Visit Instagram Reels, leave each reel visible for at least one second, and advance three times. Reopen the popup and compare the count and watch time. Open Settings to see the local history. Pause tracking in the popup and repeat to confirm the count stays fixed. A fresh installation starts with break reminders off. The dashboard works from the first recorded view.

## What not to do

- Do not write that Doomscroll is an official Instagram, Meta, or Google product.
- Do not use the Instagram, Meta, or Google logos, or a screenshot of a real person's feed, messages, or account.
- Do not write "fully private", "100% accurate", "stops doomscrolling", or any claim about mood, health, or medical benefit. The extension stores captions and handles on the device. It does not read emotion.
- Do not add permissions, analytics, a backend, or code loaded from the network. The package check rejects a network call and any permission the listing does not already justify. Change the listing and `PRIVACY.md` first if the product ever changes.
- Do not include source maps, `node_modules`, test output, `.env` files, or a CSV export in the zip.
- Do not tick a box that says live testing or a public beta has passed. Those gates are still open and are not part of this listing.
- Do not keyword-stuff the description with unrelated search terms.
- The Chrome Web Store developer registration fee is paid in your own Google account, on Google's site, by you. This repository cannot do that step.

## Assets needed

| Asset              | Requirement                                   | Status                                                                                                 |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Icon               | 128×128 PNG                                   | Ready — `store-assets/doomscroll-store-icon.png`                                                        |
| Screenshots        | 1280×800 or 640×400, at least one, up to five | Ready — `store-assets/dashboard-demo.png`, `store-assets/settings-demo.png` (synthetic data disclosed) |
| Small promo tile   | 440×280                                       | optional                                                                                               |
| Privacy policy URL | publicly reachable                            | `https://sogoyalz.github.io/Doomscroll/PRIVACY`                                                        |

The two screenshots above are the ones to upload. Do not add a capture of a
real account.

## Still yours to finish

An archive is not approval. [release-readiness.md](release-readiness.md)
still has open live and beta gates. Do not describe those as passed in the
store form.

- [x] Privacy policy text is in `PRIVACY.md`, including the limited-use statement the form asks you to certify.
- [x] Version `1.1.2` matches in `manifest.json` and `package.json`.
- [x] `npm run package` checks that the zip's permissions match the source, that source code does not send network requests (bundled model/runtime files are read locally), and that Direct and Accounts stay excluded.
- [ ] You upload `doomscroll-1.1.2.zip` and pay or confirm the developer registration in your own Google account.
- [x] The public privacy policy URL serves the project's policy (checked 23 November 2026).

Review usually takes a few days. A reviewer who asks about Instagram access
should be pointed at the single purpose, the lack of any network request, and
the exclusion of `/direct/` and `/accounts/`.
