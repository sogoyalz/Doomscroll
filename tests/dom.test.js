import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeReelContainer,
  bridgeStatus,
  BRIDGE_STATUS_ATTR,
  containerForPlayer,
  findReelContainers,
  findScrollContainer,
  AUTHOR_LINK_SELECTOR,
  VIDEO_PLAYER_SELECTOR,
} from '../src/content/dom.ts';
import { extractReel } from '../src/content/extractor.ts';
import { FIXTURE_REELS, PLACEHOLDER_INDEX, mountFeed } from './fixtures/reelFeed.js';

let feed;

beforeEach(() => {
  feed = mountFeed();
});

describe('findReelContainers', () => {
  it('finds every mounted container, placeholders included', () => {
    // Extraction has to tolerate unhydrated slots rather than assume every
    // container is a real reel.
    expect(findReelContainers()).toHaveLength(FIXTURE_REELS.length);
  });

  it('returns the container, not the video player it was found from', () => {
    const [first] = findReelContainers();
    expect(first.getAttribute('aria-label')).not.toBe('Video player');
    expect(first.querySelector(VIDEO_PLAYER_SELECTOR)).not.toBeNull();
  });

  it('returns containers in DOM order', () => {
    const handles = findReelContainers().map(
      (c) => c.querySelector(AUTHOR_LINK_SELECTOR)?.getAttribute('aria-label'),
    );
    expect(handles).toEqual(FIXTURE_REELS.map((r) => `${r.handle} reels`));
  });

  it('does not depend on Meta generated class names', () => {
    // Strip every class in the tree; structure alone must still resolve.
    for (const el of document.querySelectorAll('[class]')) el.removeAttribute('class');
    expect(findReelContainers()).toHaveLength(FIXTURE_REELS.length);
  });

  it('finds nothing on a page with no reels', () => {
    document.body.innerHTML = '<div><p>Profile page</p></div>';
    expect(findReelContainers()).toEqual([]);
  });

  it('deduplicates when a container somehow holds two players', () => {
    const container = findReelContainers()[0];
    container.appendChild(container.querySelector(VIDEO_PLAYER_SELECTOR).cloneNode(true));
    const found = findReelContainers();
    expect(new Set(found).size).toBe(found.length);
  });
});

describe('containerForPlayer', () => {
  it('resolves the container via the author link', () => {
    const player = document.querySelector(VIDEO_PLAYER_SELECTOR);
    const container = containerForPlayer(player);
    expect(container.querySelector(AUTHOR_LINK_SELECTOR)).not.toBeNull();
  });

  it('falls back to a viewport-height ancestor when the author label is gone', () => {
    // Simulates Instagram renaming or dropping the aria-label, which is the
    // single most likely way this selector breaks.
    for (const link of document.querySelectorAll(AUTHOR_LINK_SELECTOR)) {
      link.removeAttribute('aria-label');
    }

    const player = document.querySelector(VIDEO_PLAYER_SELECTOR);
    const reelContainer = feed.containers[0];
    Object.defineProperty(reelContainer, 'clientHeight', {
      value: feed.viewportHeight,
      configurable: true,
    });

    expect(containerForPlayer(player)).toBe(reelContainer);
  });

  it('gives up rather than returning the whole page', () => {
    // Regression: the walk used to reach <html>, whose height matches the
    // viewport, and return it — collapsing every reel into one container.
    for (const link of document.querySelectorAll(AUTHOR_LINK_SELECTOR)) {
      link.removeAttribute('aria-label');
    }
    const resolved = containerForPlayer(document.querySelector(VIDEO_PLAYER_SELECTOR));
    expect(resolved).not.toBe(document.body);
    expect(resolved).not.toBe(document.documentElement);
    expect(resolved).toBeNull();
  });

  it('does not climb into the feed when one reel lacks an author link', () => {
    // Only this reel's label is removed; the feed above it still contains the
    // other reels' links, so a naive walk would return the scroll container
    // and make every reel share one identity.
    const first = feed.containers[0];
    first.querySelector(AUTHOR_LINK_SELECTOR).removeAttribute('aria-label');

    const resolved = containerForPlayer(first.querySelector(VIDEO_PLAYER_SELECTOR));
    expect(resolved).not.toBe(feed.scroller);
  });

  it('resolves each reel to its own distinct container', () => {
    const containers = findReelContainers();
    expect(new Set(containers).size).toBe(containers.length);
  });
});

describe('activeReelContainer', () => {
  it('picks the container straddling the viewport midpoint', () => {
    const containers = findReelContainers();
    feed.scrollTo(2);
    expect(activeReelContainer(containers)).toBe(containers[2]);
  });

  it('follows the feed as it scrolls', () => {
    const containers = findReelContainers();
    for (const index of [0, 1, 3, 4]) {
      feed.scrollTo(index);
      expect(activeReelContainer(containers)).toBe(containers[index]);
    }
  });

  it('picks exactly one container at every position', () => {
    const containers = findReelContainers();
    for (let index = 0; index < containers.length; index++) {
      feed.scrollTo(index);
      const active = activeReelContainer(containers);
      const straddling = containers.filter((c) => {
        const rect = c.getBoundingClientRect();
        return rect.top <= feed.viewportHeight / 2 && rect.bottom >= feed.viewportHeight / 2;
      });
      expect(straddling).toEqual([active]);
    }
  });

  it('falls back to the most visible container when none spans the midpoint', () => {
    // Happens mid-flick, when a gap between reels crosses the centre line.
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({
      top: 10,
      bottom: 200,
      height: 190,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
    expect(activeReelContainer([container])).toBe(container);
  });

  it('returns null when nothing is on screen', () => {
    const offscreen = document.createElement('div');
    offscreen.getBoundingClientRect = () => ({
      top: -900,
      bottom: -100,
      height: 800,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: -900,
      toJSON: () => ({}),
    });
    expect(activeReelContainer([offscreen])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(activeReelContainer([])).toBeNull();
  });
});

describe('findScrollContainer', () => {
  it('finds the nested div the feed actually scrolls in', () => {
    // The document itself never scrolls on Instagram.
    expect(findScrollContainer()).toBe(feed.scroller);
  });

  it('returns null when nothing overflows', () => {
    document.body.innerHTML = '<div><div>short</div></div>';
    expect(findScrollContainer()).toBeNull();
  });
});

describe('end-to-end extraction against the fixture', () => {
  it('reads every field from a fully populated reel', () => {
    const reel = extractReel(findReelContainers()[0]);
    const expected = FIXTURE_REELS[0];

    expect(reel.shortcode).toBe(expected.shortcode);
    expect(reel.identity).toBe(expected.shortcode);
    expect(reel.authorHandle).toBe(expected.handle);
    expect(reel.captionText).toContain('Synthetic warning caption');
    expect(reel.hashtags).toEqual(expected.hashtags);
    expect(reel.audioName).toBe(expected.audio);
  });

  it('returns an empty hashtag list rather than failing', () => {
    expect(extractReel(findReelContainers()[1]).hashtags).toEqual([]);
  });

  it('returns null audio for an original-audio reel', () => {
    const reel = extractReel(findReelContainers()[2]);
    expect(reel.audioName).toBeNull();
    expect(reel.hashtags).toEqual(['original']);
  });

  it('returns null caption for a captionless reel', () => {
    const reel = extractReel(findReelContainers()[3]);
    expect(reel.captionText).toBeNull();
    expect(reel.audioName).toBe(FIXTURE_REELS[3].audio);
  });

  it('falls back to author|basename when no shortcode was resolved', () => {
    const reel = extractReel(findReelContainers()[3]);
    expect(reel.shortcode).toBeNull();
    expect(reel.identity).toBe('creatorfour|jkl012.mp4');
  });

  it('survives an unhydrated placeholder with no video or text', () => {
    const reel = extractReel(findReelContainers()[PLACEHOLDER_INDEX]);
    expect(reel.captionText).toBeNull();
    expect(reel.audioName).toBeNull();
    expect(reel.hashtags).toEqual([]);
    // The author link is still present, so identity is not wholly unknown.
    expect(reel.authorHandle).toBe('creatorfive');
    expect(reel.identity).toBe('creatorfive|');
  });

  it('never picks up the username span as the caption', () => {
    // span[dir=auto] holds the handle, the separator, and "Follow"; only the
    // div variant is the caption.
    for (const container of findReelContainers()) {
      const caption = extractReel(container).captionText;
      if (caption === null) continue;
      expect(caption).not.toBe('Follow');
      expect(caption).not.toMatch(/^creator\w+$/);
    }
  });

  it('strips the query string from the fallback identity', () => {
    // The first reel's video URL carries ?efg=1&oh=xyz.
    const container = findReelContainers()[0];
    container.removeAttribute('data-doomscroll-shortcode');
    expect(extractReel(container).identity).toBe('creatorone|abc123.mp4');
  });
});

describe('container resolution caching', () => {
  it('returns the same containers across repeated passes', () => {
    // The scroll path calls this every animation frame, so the second pass
    // must be a cache hit yet identical to the first.
    const first = findReelContainers();
    expect(findReelContainers()).toEqual(first);
  });

  it('drops a cached container once it detaches', () => {
    const [first] = findReelContainers();
    first.remove();

    const after = findReelContainers();
    expect(after).not.toContain(first);
    expect(after).toHaveLength(FIXTURE_REELS.length - 1);
  });

  it('re-resolves when the player moves to a different container', () => {
    // The cache must never outlive the relationship it recorded — a container
    // that no longer owns the player has to be discarded, not returned.
    const original = findReelContainers()[0];
    const player = original.querySelector(VIDEO_PLAYER_SELECTOR);

    const relocated = document.createElement('div');
    relocated.innerHTML = '<a aria-label="moved reels" href="/moved/reels/" role="link"></a>';
    document.body.appendChild(relocated);
    relocated.appendChild(player);

    const after = findReelContainers();
    expect(after).toContain(relocated);
    expect(after).not.toContain(original);
  });
});

describe('bridgeStatus', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(BRIDGE_STATUS_ATTR);
  });

  it("reports 'absent' when the MAIN-world script never ran", () => {
    // Distinct from 'no-fiber': nothing published a status at all, which is
    // also what startup looks like before injection completes.
    expect(bridgeStatus()).toBe('absent');
  });

  it('reads the status the bridge published', () => {
    document.documentElement.setAttribute(BRIDGE_STATUS_ATTR, 'ok');
    expect(bridgeStatus()).toBe('ok');

    document.documentElement.setAttribute(BRIDGE_STATUS_ATTR, 'no-fiber');
    expect(bridgeStatus()).toBe('no-fiber');
  });

  it("treats an unrecognised value as 'absent' rather than trusting it", () => {
    document.documentElement.setAttribute(BRIDGE_STATUS_ATTR, 'nonsense');
    expect(bridgeStatus()).toBe('absent');
  });
});
