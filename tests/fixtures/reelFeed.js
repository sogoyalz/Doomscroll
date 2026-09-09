// Sanitized Instagram Reels DOM snapshot.
//
// Mirrors the generalized structure recorded in docs/dom-notes.md.
// Handles, captions, audio names, shortcodes, and media URLs are invented;
// the STRUCTURE is what is under test — element nesting, aria-labels, dir
// attributes, and href prefixes.
//
// The class names below are intentionally present and intentionally
// meaningless. Meta generates them per deploy and per A/B cohort, so any
// selector that starts matching on them should start failing these tests.
//
// Covers the null cases observed in the wild: a captionless reel, a reel with
// no hashtags, an original-audio reel with no audio link, and an unhydrated
// placeholder slot with no video at all.

const REELS = [
  {
    handle: 'creatorone',
    caption: 'Synthetic warning caption',
    hashtags: ['demo', 'animation'],
    audio: 'Sample Artist · Sample Track',
    video: 'https://scontent.example.com/v/t50/abc123.mp4?efg=1&oh=xyz',
    shortcode: 'SYNTH-00001',
  },
  {
    handle: 'creatortwo',
    caption: 'Synthetic caption without tags',
    hashtags: [],
    audio: 'Demo Artist · Demo Track',
    video: 'https://scontent.example.com/v/t50/def456.mp4?efg=2',
    shortcode: 'SYNTH-00002',
  },
  {
    // Original audio: Instagram renders no /reels/audio/ link at all.
    handle: 'creatorthree',
    caption: 'Synthetic original-audio caption #original',
    hashtags: ['original'],
    audio: null,
    video: 'https://scontent.example.com/v/t50/ghi789.mp4',
    shortcode: 'SYNTH-00003',
  },
  {
    // Synthetic captionless edge case.
    handle: 'creatorfour',
    caption: null,
    hashtags: [],
    audio: 'Example Duo · Example Song',
    video: 'https://scontent.example.com/v/t50/jkl012.mp4',
    shortcode: null,
  },
  {
    // Unhydrated placeholder: player chrome mounted, nothing inside it yet.
    handle: 'creatorfive',
    caption: null,
    hashtags: [],
    audio: null,
    video: null,
    shortcode: null,
  },
];

function hashtagLinks(tags) {
  return tags
    .map((tag) => `<a class="x1i10hfl xjbqb8w" href="/explore/tags/${tag}/" role="link">#${tag}</a>`)
    .join('');
}

function captionBlock(reel) {
  if (reel.caption === null && !reel.hashtags.length) return '';
  return `<div class="xvs91rp xd4r4e8 x5n08af x1gzmk7r" dir="auto">${
    reel.caption ?? ''
  }<br><br>${hashtagLinks(reel.hashtags)}</div>`;
}

function audioBlock(reel) {
  if (!reel.audio) return '';
  // The marquee animation renders the text twice, separated by a newline.
  return `<a class="x1i10hfl x1qjc9v5" href="/reels/audio/998877/" role="link">
      <svg aria-label="Audio image" class="x1lliihq"></svg>
      <span class="x1lliihq x1plvlek" dir="auto">${reel.audio}\n${reel.audio}</span>
    </a>`;
}

function videoBlock(reel) {
  if (!reel.video) return '';
  return `<video class="x1lliihq xh8yej3" src="${reel.video}"></video>`;
}

function reelBlock(reel) {
  const shortcodeAttr = reel.shortcode ? ` data-doomscroll-shortcode="${reel.shortcode}"` : '';
  return `
    <div class="x5yr21d x1n2onr6 xh8yej3"${shortcodeAttr}>
      <div aria-label="Video player"
           class="x5yr21d x10l6tqk x13vifvy xh8yej3"
           role="group"
           data-visualcompletion="ignore">
        ${videoBlock(reel)}
      </div>
      <div class="x9f619 x1n2onr6">
        <a aria-label="${reel.handle} reels"
           class="x1i10hfl xjbqb8w"
           href="/${reel.handle}/reels/"
           role="link"
           tabindex="0">
          <span class="x1lliihq" dir="auto">${reel.handle}</span>
        </a>
        <span class="x1lliihq" dir="auto">•</span>
        <span class="x1lliihq" dir="auto">Follow</span>
      </div>
      ${captionBlock(reel)}
      ${audioBlock(reel)}
    </div>`;
}

/** The reels the fixture describes, for assertions. */
export const FIXTURE_REELS = REELS;

/** Index of the placeholder slot, which has no video and no text. */
export const PLACEHOLDER_INDEX = 4;

export const FEED_HTML = `
  <div class="x1qjc9v5 x9f619" id="app-shell">
    <div class="x78zum5 xdt5ytf" id="scroll-container">
      ${REELS.map(reelBlock).join('\n')}
    </div>
  </div>`;

const VIEWPORT_HEIGHT = 900;
const REEL_HEIGHT = 840;

/**
 * Mounts the fixture and fakes the layout jsdom does not compute.
 *
 * jsdom reports every rect and scroll dimension as zero, so both the
 * active-reel geometry and the scroll-container search need stubbing to test
 * anything real. Reels are stacked roughly one synthetic viewport apart.
 *
 * `scrollTo(index)` positions the feed so that reel's container straddles the
 * viewport midpoint.
 */
export function mountFeed(doc = document, win = window) {
  doc.body.innerHTML = FEED_HTML;

  Object.defineProperty(win, 'innerHeight', {
    value: VIEWPORT_HEIGHT,
    configurable: true,
    writable: true,
  });

  const scroller = doc.getElementById('scroll-container');
  Object.defineProperty(scroller, 'scrollHeight', {
    value: REEL_HEIGHT * REELS.length,
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', {
    value: VIEWPORT_HEIGHT,
    configurable: true,
  });

  const containers = [...doc.querySelectorAll('[data-doomscroll-shortcode], #scroll-container > div')];

  let offset = 0;
  const applyRects = () => {
    containers.forEach((container, index) => {
      const top = index * REEL_HEIGHT - offset;
      container.getBoundingClientRect = () => ({
        top,
        bottom: top + REEL_HEIGHT,
        left: 0,
        right: 500,
        width: 500,
        height: REEL_HEIGHT,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
    });
  };
  applyRects();

  return {
    scroller,
    containers,
    /** Scroll so the container at `index` straddles the viewport midpoint. */
    scrollTo(index) {
      offset = index * REEL_HEIGHT - (VIEWPORT_HEIGHT / 2 - REEL_HEIGHT / 2);
      applyRects();
    },
    viewportHeight: VIEWPORT_HEIGHT,
    reelHeight: REEL_HEIGHT,
  };
}
