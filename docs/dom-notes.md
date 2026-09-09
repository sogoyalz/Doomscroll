# Instagram Reels DOM notes

Sanitized from manual inspection of `https://www.instagram.com/reels/` in a
logged-in desktop Chrome session. Account identifiers, reel shortcodes,
captions, audio names, URLs, dates, and exact session details below are
synthetic or generalized. The DOM relationships and failure modes are the
only observations this document preserves.

Class names in every snippet below are Meta's auto-generated atomic CSS
(`x1lliihq`, `xvs91rp`, …). **Never select on them** — they change between
deploys and between A/B cohorts. Every selector here is anchored on
`aria-label`, `dir`, `role`, or `href` prefix instead.

> Re-verify this file against the live site before any store submission.
> CI runs against saved fixtures and will happily pass while production
> silently returns nulls.

---

## 1. Reel container (one item in the vertical feed)

There is no semantic wrapper — the container is a plain `<div>` carrying only
generated classes. It has to be derived from a stable descendant.

**Primary:** nearest ancestor of `div[aria-label="Video player"]` that also
contains `a[aria-label$=" reels"]` (the author link).

**Fallback:** `div[aria-label="Video player"]` itself, walking up while
`clientHeight` is within ~10% of `window.innerHeight`.

```html
<!-- the stable descendant the container is found from -->
<div aria-label="Video player"
     class="x5yr21d x10l6tqk x13vifvy xh8yej3"
     role="group"
     data-visualcompletion="ignore">
```

```html
<!-- author link present in every real reel container -->
<a aria-label="samplecreator reels"
   class="x1i10hfl xjbqb8w …"
   href="/samplecreator/reels/" role="link" tabindex="0">
```

Observed: several containers mounted simultaneously, stacked roughly one
viewport apart.
Each has its own `<video>` with a real `src` — video presence does **not**
identify the active reel.

**Note:** some mounted containers had no resolvable shortcode and no
`<video>` (placeholders / not-yet-hydrated slots). Extraction must tolerate
them rather than assume every container is a real reel.

## 2. Distinguishing the active reel

**Use geometry.** The active reel is the container whose bounding rect
straddles the viewport vertical midpoint:

```js
const mid = window.innerHeight / 2;
const active = containers.find(c => {
  const b = c.getBoundingClientRect();
  return b.top <= mid && b.bottom >= mid;
});
```

Verified to select exactly one container at every scroll position sampled.

**Do not use `video.paused` / `video.currentTime`.** Every mounted video read
`paused: true, currentTime: 0` regardless of which reel was on screen —
autoplay state is not a reliable active-reel signal.

There is no `aria-current`, `aria-selected`, or active-state data attribute
on any container.

## 3. Caption text

**Primary:** `div[dir="auto"]` within the container.

The tag name matters: `span[dir="auto"]` is used for the username, the `•`
separator, "Follow", and the audio attribution. The **`div`** variant is the
caption. It is the only `div[dir="auto"]` inside a container.

```html
<div class="xvs91rp xd4r4e8 x5n08af xt7dq6l x1i0vuye x1ua5tub x104kibb
            x6ikm8r x10wlt62 xeaf4i8 x1gzmk7r" dir="auto">
  Synthetic warning caption<br><br>
  <a class="…" href="/explore/tags/demo/" role="link" tabindex="0">#demo</a>
  <a class="…" href="/explore/tags/animation/" role="link">#animation</a>
</div>
```

Line breaks are `<br>` elements — read `innerText`, not `textContent`, or
paragraphs run together.

**Nullable.** A synthetic captionless case has no caption element at all.
Manual validation covered empty, short, medium, and long captions.

## 4. Hashtags

**Primary:** `a[href^="/explore/tags/"]` within the caption element.

```html
<a class="…" href="/explore/tags/demo/" role="link" tabindex="0">#demo</a>
```

Anchor text includes the leading `#` — strip it. The href segment is the
canonical lowercase tag and is safer to parse than the visible text:
`/explore/tags/<tag>/`.

Captions frequently have zero hashtags, so an empty array is normal, not a
failure. Synthetic fixtures also cover one and several hashtags.

## 5. Audio / song attribution

**Primary:** within `a[href^="/reels/audio/"]`, the `span[dir="auto"]` whose
text contains `" · "` (space–middot–space, U+00B7).

Format is `Artist · Track`:

```
Sample Artist · Sample Track
Demo Artist · Demo Track
Example Duo · Example Song
Three Artists · Long-form Track
Solo Artist · Short Track
```

The audio link's icon is `svg[aria-label="Audio image"]`, a useful secondary
anchor.

**The text is duplicated** — the marquee animation renders two identical
spans, so `innerText` yields the string twice separated by `\n`. Take
`.split('\n')[0]`.

**Nullable.** Reels using original audio can render no `/reels/audio/` link
at all.

## 6. URL and shortcode — the important finding

**The URL does not change as you scroll.** This was tested three ways and
held every time:

- Landing on `/reels/` immediately redirects to `/reels/<shortcode>/` for the
  *first* reel, then never updates again.
- Scrolling through multiple reels (real wheel events): path stayed
  `/reels/SYNTH-00005/` throughout.
- Scrolling through another synthetic sample on a fresh load: path stayed
  `/reels/SYNTH-00006/`, and **none of the active shortcodes matched it**.
- Clicking Instagram's own `div[aria-label="Navigate to next Reel"]` control
  also left the path unchanged.

Representative proof: with the active reel resolving to `SYNTH-00001`, the
address bar can still read `/reels/SYNTH-00005/`.

**Consequence: `location.pathname` cannot be used to identify which reel is
being watched.** It identifies only the reel the page was opened on. Any
"reels scrolled" counter built on URL changes will report ~1 per page load.

### Where the shortcode actually lives

React fiber props on the container. Walking `__reactFiber$*` up the `return`
chain finds `memoizedProps.media.code` within ~5 levels:

```js
const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
let node = el[key];
for (let d = 0; d < 30 && node; d++, node = node.return) {
  const p = node.memoizedProps;
  if (p?.media?.code) return p.media.code;   // e.g. "SYNTH-00001"
}
```

Shortcode format: 11 chars, `[A-Za-z0-9_-]` (hyphens do occur —
`SYNTH-00001`, `SYNTH-00007`).

**This is not reachable from a normal content script.** Content scripts run
in an isolated world and cannot see expando properties the page's own JS put
on DOM nodes. Reaching `media.code` requires a second content script
registered with `"world": "MAIN"` that reads the fiber and relays the value
out via `postMessage` / a DOM `CustomEvent`.

It is also the most fragile thing in this document — a React internals
rename breaks it with no warning. Treat it as a best-effort identity with a
fallback.

### Fallback identity

When no shortcode resolves, derive a stable-enough key from the author
handle plus the video `src` basename:

```
<author-handle>|<basename of video.currentSrc without query string>
```

Author handle comes from `a[aria-label$=" reels"]`'s `aria-label` (strip the
trailing `" reels"`) or its `href` (`/<handle>/reels/`). This is sufficient
for dedupe within a session, though it will not survive Instagram rotating
CDN URLs.

## 7. Scroll container

The document does **not** scroll: `window.scrollY` stays 0 and
`document.documentElement.scrollHeight` equals the viewport height.

Scrolling happens inside a nested `div` whose `scrollHeight` is much larger
than its `clientHeight`. Find it by searching for the div whose
`scrollHeight > clientHeight + 200` and `clientHeight > 300`.

Implications:
- A scroll listener on `window` / `document` will never fire. Bind to the
  inner container.
- `IntersectionObserver` with the default `root: null` still works correctly,
  because containers do move relative to the viewport.
- `MutationObserver` should be scoped to this container's parent rather than
  `document.body`.
- Programmatic `scrollBy` on the container moves the feed but did **not**
  trigger Instagram's lazy-load of further reels; real wheel events did.
  Anything that needs pagination has to come from genuine user scrolling.

## 8. Selector summary

| Field | Primary | Fallback | Nullable |
|---|---|---|---|
| container | ancestor of `div[aria-label="Video player"]` containing `a[aria-label$=" reels"]` | `div[aria-label="Video player"]` walked up to viewport height | no |
| active reel | container straddling viewport midpoint | largest intersection ratio | no |
| shortcode | fiber `memoizedProps.media.code` (MAIN world) | `handle\|video-src-basename` | yes |
| caption | `div[dir="auto"]` in container | — | **yes** |
| hashtags | `a[href^="/explore/tags/"]` in caption | parse `#\w+` from caption text | yes (empty) |
| audio | `span[dir="auto"]` containing `" · "` inside `a[href^="/reels/audio/"]` | text near `svg[aria-label="Audio image"]` | **yes** |
| author | `a[aria-label$=" reels"]` → strip `" reels"` | `href` `/<handle>/reels/` | no |

## 9. Sample data

Synthetic cases modeled on consecutive reels. `pathAtCapture` remains
`/reels/SYNTH-00006/` for **all** of them to encode the non-changing URL
behavior.

| shortcode | caption chars | hashtags | audio |
|---|---|---|---|
| `SYNTH-00007` | 498 | 5 | — |
| `SYNTH-00002` | 136 | 1 | — |
| `SYNTH-00003` | 39 | 0 | Example Artist A, Example Artist B, … |
| `SYNTH-00008` | 212 | 5 | Demo Artist A, Demo Artist B, … |
| `SYNTH-00009` | 143 | 5 | Sample Artist · Sample Track |
| `SYNTH-00010` | 105 | 5 | Demo Artist · Demo Track |
| `SYNTH-00004` | 0 | 0 | Example Duo · Example Song |

Covers: long and short captions, captionless, zero-hashtag, and missing-audio
variants — the null cases `extractor.ts` has to handle.


## Identity is the load-bearing extraction

Everything else degrades gracefully on its own: no caption means an
unclassified reel, no audio means one fewer signal. Identity is different,
because two things depend on it at once — telling reels apart in storage, and
noticing that a recycled container now holds a different reel.

When the fiber shortcode, the author link and the video `src` all fail
together, `identity` collapses to the `unknown|` placeholder for every reel.
The recycling check then cannot see a change, one view stays open across the
whole session, and no reel is ever recorded. The symptom is the popup reading
"Nothing tracked yet" while the drift banner says the layout may have changed —
those are one failure, not two.

`isSameReel` now falls back to comparing readable text (caption, hashtags,
audio) when neither side can be named, which keeps tracking alive through a
selector break as long as *something* renders. If that ever reads "nothing
tracked" again, check in this order:

1. `document.querySelectorAll('div[aria-label="Video player"]').length`
2. `document.querySelectorAll('a[aria-label$=" reels"]').length`
3. `document.querySelectorAll('[data-doomscroll-shortcode]').length`
4. `document.querySelector('video')?.currentSrc`

Zero on 2 and 3 together is the collapse described above. Note also that a
single-reel permalink (`/reel/<code>/`) is a different layout from the feed
(`/reels/`); the selectors here were researched against the feed.
