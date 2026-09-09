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

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings and their local viewing history. No data leaves the device. |
| `alarms` | Runs daily maintenance — rolling up statistics and deleting history older than 90 days. A Manifest V3 service worker is terminated when idle and cannot use `setTimeout` for scheduled work, so alarms are the only mechanism available. |
| `notifications` | Shows the gentlest of the three optional break reminders. Off by default and unavailable until the extension has a week of the user's own history to compare against; the user turns it on in the extension's settings and can turn it off there. No notification is ever sent from a server — there is no server. |
| `https://*.instagram.com/*` | Reads the caption, hashtags, and audio name of the reel currently on screen in order to categorise it. This is the only site the extension runs on, and it is excluded from `/direct/` and `/accounts/`. |

**Remote code:** none. Everything executes from the packaged bundle; the
extension makes no network requests of any kind.

**Data usage disclosures:** tick *Personally identifiable information* — the
fallback reel identifier includes the creator's Instagram handle. Then certify
all three: data is not sold, not used for unrelated purposes, and not used to
determine creditworthiness. All true; nothing is transmitted anywhere.

## Listing copy

**Name:** Doomscroll

**Short description** (132 char limit):

> See how much you scroll Reels, and get told when the feed keeps serving you
> the same kind of content. Fully private.

**Detailed description:**

> Doomscroll answers two questions about your Instagram Reels habit: how much
> are you watching, and what does the feed keep showing you?
>
> It tracks watch time, reel count, scroll pace, and your longest unbroken
> stretch. It reads each reel's caption, hashtags, and audio name to sort it
> into one of eight categories, and shows the mix.
>
> The part that matters: it watches for the feed locking onto one category and
> serving it back. That judgement is made against YOUR OWN normal, not a fixed
> rule — being shown a lot of sad content is only flagged if it is unusual for
> you. It needs about a week of history before it can say anything, and it
> tells you so rather than guessing.
>
> WHAT IT DOES NOT DO
> • No account, no server, no analytics — it makes no network requests at all
> • Does not run on direct messages or account settings
> • Does not read your login, cookies, or anything outside instagram.com
> • Interruptions are off by default and stay off until you switch them on
>
> Pause tracking at any time from the popup. Export or delete your data
> whenever you like.
>
> A note on what this can and cannot tell you: it detects repetition in a
> content category derived from text. It is not a read on your mood. Text is
> the only signal available, so reels with no caption cannot be categorised at
> all, and those are shown honestly rather than counted as neutral.

**Category:** Productivity
**Language:** English

## Assets needed

| Asset | Requirement | Status |
|---|---|---|
| Icon | 128×128 PNG | have — `assets/icons/icon128.png` |
| Screenshots | 1280×800 or 640×400, at least one, up to five | **TODO** |
| Small promo tile | 440×280 | optional |
| Privacy policy URL | publicly reachable | **TODO — see below** |

Suggested screenshots, in order: the popup with a populated day; the category
mix with a clear dominant category; the options detection log; the "why so
much neutral" tuning report.

Take them with real data, not the mocked preview — reviewers can usually tell,
and fabricated screenshots are grounds for removal.

## Before submitting

- [ ] Host `PRIVACY.md` at a public URL. Enabling GitHub Pages on the repo
      gives you `https://sogoyalz.github.io/Doomscroll/PRIVACY` for free.
- [ ] Bump `version` in `manifest.json` — `0.1.0` is not a release version.
      It must increase on every subsequent upload.
- [ ] `npm run package`, then upload `doomscroll-<version>.zip`.
- [ ] Verify the built manifest declares no permission the code does not use.
      `npm run package` checks structure but not this — read it.
- [ ] Test the packaged zip in a clean Chrome profile, not just the unpacked
      `dist/`, and confirm it works on a Chrome at the declared minimum (111).
- [ ] Have the developer account's one-time fee paid and identity verified.

## Expect

First review typically takes a few days. Extensions requesting host
permissions for a major site draw more scrutiny than average — the narrow
single purpose, the absence of any network code, and the `/direct/` exclusion
are the three things most worth pointing at if a reviewer asks.
