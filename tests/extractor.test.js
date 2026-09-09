import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractReel,
  extractCaption,
  extractHashtags,
  extractAudioName,
  extractAuthorHandle,
  fillMissingFields,
  isIncomplete,
  isSameReel,
  isUnidentified,
  mergeExtractions,
  UNIDENTIFIED_IDENTITY,
} from '../src/content/extractor.ts';
import { SHORTCODE_ATTR } from '../src/content/dom.ts';

// Markup mirrors docs/dom-notes.md: aria-label / dir / href-prefix anchors
// only, with Meta's generated class names deliberately omitted since nothing
// may select on them.
function buildContainer({
  author = 'samplecreator',
  caption = null,
  hashtags = [],
  audio = null,
  shortcode = null,
  videoSrc = null,
} = {}) {
  const container = document.createElement('div');

  container.innerHTML = `
    <div aria-label="Video player" role="group" data-visualcompletion="ignore"></div>
    <a aria-label="${author} reels" href="/${author}/reels/" role="link"></a>
  `;

  if (caption !== null) {
    const el = document.createElement('div');
    el.setAttribute('dir', 'auto');
    el.textContent = caption;
    for (const tag of hashtags) {
      const link = document.createElement('a');
      link.setAttribute('href', `/explore/tags/${tag}/`);
      link.setAttribute('role', 'link');
      link.textContent = `#${tag}`;
      el.appendChild(link);
    }
    container.appendChild(el);
  }

  if (audio !== null) {
    const link = document.createElement('a');
    link.setAttribute('href', '/reels/audio/12345/');
    const span = document.createElement('span');
    span.setAttribute('dir', 'auto');
    // The marquee renders the text twice, separated by a newline.
    span.textContent = `${audio}\n${audio}`;
    link.appendChild(span);
    container.appendChild(link);
  }

  if (shortcode !== null) container.setAttribute(SHORTCODE_ATTR, shortcode);

  if (videoSrc !== null) {
    const video = document.createElement('video');
    video.setAttribute('src', videoSrc);
    container.appendChild(video);
  }

  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractCaption', () => {
  it('reads the div[dir=auto] caption', () => {
    const c = buildContainer({ caption: 'Be careful' });
    expect(extractCaption(c)).toBe('Be careful');
  });

  it('returns null when the reel has no caption element', () => {
    // A synthetic captionless case has no caption element at all.
    expect(extractCaption(buildContainer())).toBeNull();
  });

  it('ignores span[dir=auto], which holds the username and audio, not the caption', () => {
    const c = buildContainer();
    const span = document.createElement('span');
    span.setAttribute('dir', 'auto');
    span.textContent = 'samplecreator';
    c.appendChild(span);
    expect(extractCaption(c)).toBeNull();
  });
});

describe('extractHashtags', () => {
  it('parses tags from href segments, not anchor text', () => {
    const c = buildContainer({ caption: 'hi', hashtags: ['fyp', 'animation'] });
    expect(extractHashtags(c)).toEqual(['fyp', 'animation']);
  });

  it('returns an empty array for captions with no hashtags', () => {
    expect(extractHashtags(buildContainer({ caption: 'no tags here' }))).toEqual([]);
  });

  it('falls back to scanning caption text when no hashtag links exist', () => {
    const c = buildContainer({ caption: 'love this #Sunset and #vibes' });
    expect(extractHashtags(c)).toEqual(['sunset', 'vibes']);
  });

  it('deduplicates repeated tags', () => {
    const c = buildContainer({ caption: 'hi', hashtags: ['fyp', 'fyp'] });
    expect(extractHashtags(c)).toEqual(['fyp']);
  });
});

describe('extractAudioName', () => {
  it('takes only the first line, since the marquee duplicates the text', () => {
    const c = buildContainer({ audio: 'Sample Artist · Sample Track' });
    expect(extractAudioName(c)).toBe('Sample Artist · Sample Track');
  });

  it('returns null for original-audio reels with no audio link', () => {
    expect(extractAudioName(buildContainer())).toBeNull();
  });
});

describe('extractAuthorHandle', () => {
  it('strips the " reels" suffix from the aria-label', () => {
    expect(extractAuthorHandle(buildContainer({ author: 'samplecreator' }))).toBe('samplecreator');
  });

  it('falls back to the href when aria-label is missing', () => {
    // Simulates Instagram dropping or renaming the aria-label, which makes
    // the link stop matching the primary selector altogether.
    const c = buildContainer({ author: 'someone' });
    c.querySelector('a[aria-label$=" reels"]').removeAttribute('aria-label');
    expect(extractAuthorHandle(c)).toBe('someone');
  });

  it('returns null when there is no author link at all', () => {
    expect(extractAuthorHandle(document.createElement('div'))).toBeNull();
  });
});

describe('extractReel identity', () => {
  it('uses the shortcode published by the MAIN-world bridge', () => {
    const c = buildContainer({ shortcode: 'SYNTH-00001' });
    const reel = extractReel(c);
    expect(reel.shortcode).toBe('SYNTH-00001');
    expect(reel.identity).toBe('SYNTH-00001');
  });

  it('falls back to author|video-basename when no shortcode resolved', () => {
    const c = buildContainer({
      author: 'someone',
      videoSrc: 'https://cdn.example.com/path/abc123.mp4?token=xyz',
    });
    const reel = extractReel(c);
    expect(reel.shortcode).toBeNull();
    expect(reel.identity).toBe('someone|abc123.mp4');
  });

  it('still produces an identity for a placeholder with no video or shortcode', () => {
    // 2 of 9 mounted containers were unhydrated placeholders.
    const reel = extractReel(buildContainer({ author: 'someone' }));
    expect(reel.identity).toBe('someone|');
  });

  it('handles a fully null reel without throwing', () => {
    const reel = extractReel(document.createElement('div'));
    expect(reel.captionText).toBeNull();
    expect(reel.audioName).toBeNull();
    expect(reel.authorHandle).toBeNull();
    expect(reel.hashtags).toEqual([]);
  });
});

describe('mergeExtractions', () => {
  const base = {
    shortcode: null,
    identity: 'someone|abc.mp4',
    captionText: 'original caption',
    hashtags: ['fyp'],
    audioName: null,
    authorHandle: 'someone',
  };

  it('adopts a shortcode that resolved after activation', () => {
    const later = { ...base, shortcode: 'SYNTH-00001', captionText: 'next reel caption' };
    const merged = mergeExtractions(base, later);
    expect(merged.shortcode).toBe('SYNTH-00001');
    expect(merged.identity).toBe('SYNTH-00001');
    // Text must stay from the snapshot — the container may hold the next reel.
    expect(merged.captionText).toBe('original caption');
  });

  it('keeps the snapshot shortcode when one was already known', () => {
    const snapshot = { ...base, shortcode: 'AAAAAAAAAAA', identity: 'AAAAAAAAAAA' };
    const later = { ...base, shortcode: 'BBBBBBBBBBB' };
    expect(mergeExtractions(snapshot, later).shortcode).toBe('AAAAAAAAAAA');
  });

  it('returns the snapshot unchanged when the container is gone', () => {
    expect(mergeExtractions(base, null)).toEqual(base);
  });
});

describe('isSameReel', () => {
  const reel = (shortcode, identity) => ({
    shortcode,
    identity: identity ?? shortcode ?? '',
    captionText: null,
    hashtags: [],
    audioName: null,
    authorHandle: null,
  });

  it('matches identical shortcodes', () => {
    expect(isSameReel(reel('AAA'), reel('AAA'))).toBe(true);
  });

  it('separates different shortcodes', () => {
    // Instagram recycled the container for a different reel.
    expect(isSameReel(reel('AAA'), reel('BBB'))).toBe(false);
  });

  it('treats a late-resolving shortcode as the same reel', () => {
    // The MAIN-world bridge tags asynchronously; without this, every view
    // would be split the moment the shortcode landed.
    const before = reel(null, 'someone|abc.mp4');
    const after = reel('AAA');
    expect(isSameReel(before, after)).toBe(true);
    expect(isSameReel(after, before)).toBe(true);
  });

  it('falls back to the derived identity when neither side has a shortcode', () => {
    expect(isSameReel(reel(null, 'someone|abc.mp4'), reel(null, 'someone|abc.mp4'))).toBe(true);
    expect(isSameReel(reel(null, 'someone|abc.mp4'), reel(null, 'other|xyz.mp4'))).toBe(false);
  });
});

describe('audio extraction fallbacks', () => {
  it('reads audio from the /reels/audio/ anchor', () => {
    expect(extractAudioName(buildContainer({ audio: 'Sample Artist · Sample Track' }))).toBe(
      'Sample Artist · Sample Track',
    );
  });

  it('reads audio via the "Audio image" icon when no href anchor matches', () => {
    // Simulates Instagram changing the audio href (the real 0-of-700 failure):
    // the icon-anchored row still carries the artist · track text.
    const c = document.createElement('div');
    c.innerHTML = `
      <a aria-label="creator reels" href="/creator/reels/" role="link"></a>
      <div>
        <svg aria-label="Audio image"></svg>
        <span dir="auto">Arijit Singh · Channa Mereya\nArijit Singh · Channa Mereya</span>
      </div>`;
    expect(extractAudioName(c)).toBe('Arijit Singh · Channa Mereya');
  });

  it('returns null when there is no audio anywhere', () => {
    expect(extractAudioName(buildContainer())).toBeNull();
  });
});

describe('isIncomplete', () => {
  const reel = (over = {}) => ({
    shortcode: 'AAA',
    identity: 'AAA',
    captionText: 'hi',
    hashtags: ['x'],
    audioName: 'a · b',
    authorHandle: 'someone',
    ...over,
  });

  it('is false for a fully populated snapshot', () => {
    expect(isIncomplete(reel())).toBe(false);
  });

  it('is true when caption, audio, or hashtags are missing', () => {
    expect(isIncomplete(reel({ captionText: null }))).toBe(true);
    expect(isIncomplete(reel({ audioName: null }))).toBe(true);
    expect(isIncomplete(reel({ hashtags: [] }))).toBe(true);
  });
});

describe('fillMissingFields', () => {
  const snap = (over = {}) => ({
    shortcode: null,
    identity: 'someone|abc.mp4',
    captionText: null,
    hashtags: [],
    audioName: null,
    authorHandle: 'someone',
    ...over,
  });

  it('fills caption and audio that rendered after activation', () => {
    // The core fix: a reel captured before its caption/audio rendered.
    const before = snap();
    const fresh = {
      ...before,
      captionText: 'feeling low tonight',
      audioName: 'Artist · Sad Song',
      hashtags: ['sad'],
    };
    const merged = fillMissingFields(before, fresh);
    expect(merged.captionText).toBe('feeling low tonight');
    expect(merged.audioName).toBe('Artist · Sad Song');
    expect(merged.hashtags).toEqual(['sad']);
  });

  it('keeps the snapshot value where it already had one', () => {
    const before = snap({ captionText: 'original' });
    const merged = fillMissingFields(before, { ...before, captionText: 'later different text' });
    expect(merged.captionText).toBe('original');
  });

  it('adopts a late shortcode and promotes it to identity', () => {
    const merged = fillMissingFields(snap(), { ...snap(), shortcode: 'Dbv6giIR' });
    expect(merged.shortcode).toBe('Dbv6giIR');
    expect(merged.identity).toBe('Dbv6giIR');
  });

  it('keeps an already-known shortcode identity', () => {
    const before = snap({ shortcode: 'AAA', identity: 'AAA' });
    const merged = fillMissingFields(before, { ...before, shortcode: 'BBB' });
    expect(merged.shortcode).toBe('AAA');
    expect(merged.identity).toBe('AAA');
  });
});

describe('un-hydrated capture (reel seen before Instagram fills it in)', () => {
  // The container is mounted but empty: no author link, no video, no text.
  const unhydrated = {
    shortcode: null,
    identity: 'unknown|',
    captionText: null,
    hashtags: [],
    audioName: null,
    authorHandle: null,
  };
  const hydrated = {
    shortcode: null,
    identity: 'creator|abc.mp4',
    captionText: 'feeling low tonight',
    hashtags: ['sad'],
    audioName: 'Artist · Song',
    authorHandle: 'creator',
  };

  it('treats hydration as the same reel, not a recycled container', () => {
    // Regression: comparing the placeholder `unknown|` identity against the
    // real one marked it a different reel, so the empty shell was reported as
    // a finished view and the late-render fill never ran — which was the whole
    // point of the fill.
    expect(isSameReel(unhydrated, hydrated)).toBe(true);
    expect(isSameReel(hydrated, unhydrated)).toBe(true);
  });

  it('replaces the placeholder identity once the reel hydrates', () => {
    const filled = fillMissingFields(unhydrated, hydrated);
    expect(filled.identity).toBe('creator|abc.mp4');
    expect(filled.authorHandle).toBe('creator');
    expect(filled.captionText).toBe('feeling low tonight');
    expect(filled.audioName).toBe('Artist · Song');
    expect(filled.hashtags).toEqual(['sad']);
  });

  it('still detects genuine recycling between two identified reels', () => {
    const a = { ...hydrated, shortcode: 'AAA', identity: 'AAA' };
    const b = { ...hydrated, shortcode: 'BBB', identity: 'BBB', authorHandle: 'other' };
    expect(isSameReel(a, b)).toBe(false);
  });

  it('still detects recycling when neither reel has a shortcode', () => {
    const a = { ...hydrated, identity: 'one|1.mp4', authorHandle: 'one' };
    const b = { ...hydrated, identity: 'two|2.mp4', authorHandle: 'two' };
    expect(isSameReel(a, b)).toBe(false);
  });

  it('flags an un-hydrated snapshot as unidentified', () => {
    expect(isUnidentified(unhydrated)).toBe(true);
    expect(isUnidentified(hydrated)).toBe(false);
  });
});

describe('recycling vs late shortcode tagging', () => {
  const withAuthor = (over) => ({
    shortcode: null,
    identity: 'creatorA|a.mp4',
    captionText: 'A',
    hashtags: [],
    audioName: null,
    authorHandle: 'creatorA',
    ...over,
  });

  it('does not mistake a recycled reel for late shortcode tagging', () => {
    // Regression: the "shortcode on only one side means the bridge tagged us
    // late" rule also matched a container recycled from an untagged reel to a
    // tagged one — filing the outgoing reel's watch time under the incoming
    // reel's identity. A differing author distinguishes the two.
    const outgoing = withAuthor();
    const incoming = withAuthor({
      shortcode: 'BBBBBB',
      identity: 'BBBBBB',
      authorHandle: 'creatorB',
      captionText: 'B',
    });
    expect(isSameReel(outgoing, incoming)).toBe(false);
  });

  it('still treats a late-resolving shortcode from the same author as one reel', () => {
    const before = withAuthor();
    const after = withAuthor({ shortcode: 'AAAAAA', identity: 'AAAAAA' });
    expect(isSameReel(before, after)).toBe(true);
    expect(mergeExtractions(before, after).identity).toBe('AAAAAA');
  });

  it('allows late tagging when the author never resolved on the snapshot', () => {
    // The bridge and the author link can both be slow; that is still one reel.
    const before = {
      shortcode: null,
      identity: 'unknown|x.mp4',
      captionText: null,
      hashtags: [],
      audioName: null,
      authorHandle: null,
    };
    const after = withAuthor({ shortcode: 'CCCCCC', identity: 'CCCCCC', authorHandle: 'creatorC' });
    expect(isSameReel(before, after)).toBe(true);
  });
});

describe('shortcodeSource', () => {
  it('reports fiber when the MAIN-world bridge tagged the container', () => {
    expect(extractReel(buildContainer({ shortcode: 'SYNTH-00001' })).shortcodeSource).toBe('fiber');
  });

  it('reports fallback when identity had to be derived', () => {
    const reel = extractReel(buildContainer({ videoSrc: 'https://cdn/abc.mp4' }));
    expect(reel.shortcodeSource).toBe('fallback');
    expect(reel.identity).toBe('samplecreator|abc.mp4');
  });

  it('flips to fiber when a late tag supplies the shortcode', () => {
    // The bridge can tag a container after the snapshot was taken. The stored
    // identity becomes fiber-derived, so the counter must agree.
    const before = extractReel(buildContainer({ videoSrc: 'https://cdn/abc.mp4' }));
    const after = extractReel(buildContainer({ shortcode: 'SYNTH-00001' }));
    expect(mergeExtractions(before, after).shortcodeSource).toBe('fiber');
    expect(fillMissingFields(before, after).shortcodeSource).toBe('fiber');
  });

  it('stays fallback when neither read resolved a shortcode', () => {
    const before = extractReel(buildContainer({ videoSrc: 'https://cdn/abc.mp4' }));
    const after = extractReel(buildContainer({ videoSrc: 'https://cdn/abc.mp4', caption: 'hi' }));
    expect(fillMissingFields(before, after).shortcodeSource).toBe('fallback');
  });
});

describe('audioChannel', () => {
  it('names the href selector that matched', () => {
    // The builder renders the historical /reels/audio/ anchor.
    expect(extractReel(buildContainer({ audio: 'Sample Artist · Sample Track' })).audioChannel).toBe(
      'href-reels-audio',
    );
  });

  it('is null for an original-audio reel with no audio row at all', () => {
    const reel = extractReel(buildContainer({ audio: null }));
    expect(reel.audioName).toBeNull();
    expect(reel.audioChannel).toBeNull();
  });

  it('falls back to the Audio image icon when the href anchors are gone', () => {
    // The live failure this instrumentation exists to diagnose: audio went
    // 100% dark across 700+ reels and the counters could not say which
    // channel was at fault.
    const c = buildContainer();
    const row = document.createElement('div');
    row.innerHTML =
      '<svg aria-label="Audio image"></svg>' +
      '<span dir="auto">Sample Artist · Sample Track\nSample Artist · Sample Track</span>';
    c.appendChild(row);

    const reel = extractReel(c);
    expect(reel.audioName).toBe('Sample Artist · Sample Track');
    expect(reel.audioChannel).toBe('icon');
  });

  it('reports no channel when a matching row holds no readable text', () => {
    // A scope that matches but is empty is a broken channel, not audio — and
    // crediting the selector would hide exactly the breakage being hunted.
    const c = buildContainer();
    const link = document.createElement('a');
    link.setAttribute('href', '/reels/audio/12345/');
    c.appendChild(link);

    const reel = extractReel(c);
    expect(reel.audioName).toBeNull();
    expect(reel.audioChannel).toBeNull();
  });

  it('follows whichever read supplied the stored audio name', () => {
    const snapshot = extractReel(buildContainer({ audio: null }));
    const fresh = extractReel(buildContainer({ audio: 'Demo Artist · Demo Track' }));
    const filled = fillMissingFields(snapshot, fresh);
    expect(filled.audioName).toBe('Demo Artist · Demo Track');
    expect(filled.audioChannel).toBe('href-reels-audio');
  });
});

describe('hashtag percent-decoding', () => {
  it('decodes a Devanagari hashtag so the lexicon can match it', () => {
    // Instagram URL-encodes anything non-ASCII in the href. Left encoded, the
    // Hinglish/Devanagari half of the lexicon can never fire.
    const c = buildContainer({ caption: 'x', hashtags: ['%e0%a4%97%e0%a4%bc%e0%a4%ae'] });
    expect(extractHashtags(c)).toEqual(['ग़म']);
  });

  it('decodes emoji-bearing hashtags', () => {
    const c = buildContainer({ caption: 'x', hashtags: ['reelindia%e2%9d%a4%ef%b8%8f'] });
    expect(extractHashtags(c)).toEqual(['reelindia❤️']);
  });

  it('leaves a plain ASCII hashtag untouched', () => {
    const c = buildContainer({ caption: 'x', hashtags: ['fyp'] });
    expect(extractHashtags(c)).toEqual(['fyp']);
  });

  it('keeps the other hashtags when one is malformed', () => {
    // decodeURIComponent throws on a stray '%'. One bad tag must not cost the
    // reel the rest of its hashtags — or the reel its classification.
    const c = buildContainer({ caption: 'x', hashtags: ['100%', 'sad'] });
    expect(extractHashtags(c)).toEqual(['100%', 'sad']);
  });

  it('does not double-decode a literal percent sequence in the caption fallback', () => {
    // The caption path never had this problem: it reads rendered text, which
    // is already decoded. Only the href path encodes.
    const c = buildContainer({ caption: 'up 50% today #growth' });
    expect(extractHashtags(c)).toEqual(['growth']);
  });
});

describe('a feed where nothing can be identified', () => {
  // The failure this covers stopped tracking entirely and said nothing. With
  // the fiber bridge and the author link both gone, every reel collapsed to
  // the same `unknown|` identity, so isSameReel called them all one reel — the
  // container was recycled without anyone noticing, one view stayed open for
  // the whole session, and not a single reel was recorded.
  const nameless = (over = {}) => ({
    shortcode: null,
    identity: UNIDENTIFIED_IDENTITY,
    captionText: null,
    hashtags: [],
    audioName: null,
    authorHandle: null,
    shortcodeSource: 'fallback',
    audioChannel: null,
    ...over,
  });

  it('tells two unnameable reels apart by their captions', () => {
    expect(
      isSameReel(
        nameless({ captionText: 'the silence after the doctor says' }),
        nameless({ captionText: 'wait for it' }),
      ),
    ).toBe(false);
  });

  it('tells them apart by hashtags alone', () => {
    expect(
      isSameReel(nameless({ hashtags: ['sad'] }), nameless({ hashtags: ['comedy'] })),
    ).toBe(false);
  });

  it('tells them apart by audio alone', () => {
    expect(
      isSameReel(nameless({ audioName: 'Wishes' }), nameless({ audioName: 'Hasa' })),
    ).toBe(false);
  });

  it('still treats the same text as the same reel', () => {
    const text = { captionText: 'same reel, re-read a second later' };
    expect(isSameReel(nameless(text), nameless(text))).toBe(true);
  });

  it('does not split a shell that has not rendered its caption yet', () => {
    // The reason the rule existed. Calling hydration a new reel reports the
    // empty placeholder as a finished view and never fills it in.
    expect(isSameReel(nameless(), nameless({ captionText: 'now it has rendered' }))).toBe(true);
  });

  it('does not split when neither side has any readable text', () => {
    // Genuinely blind. Splitting here would close and reopen a view every
    // heartbeat, turning one reel into a stream of one-second fragments.
    expect(isSameReel(nameless(), nameless())).toBe(true);
  });

  it('ignores whitespace-only text rather than treating it as a difference', () => {
    expect(isSameReel(nameless({ captionText: '   ' }), nameless({ captionText: 'real' }))).toBe(
      true,
    );
  });

  it('does not let two fields run together into a false match', () => {
    // Joining without a separator would make caption "a" + audio "b" collide
    // with caption "ab".
    expect(
      isSameReel(
        nameless({ captionText: 'a', audioName: 'b' }),
        nameless({ captionText: 'ab' }),
      ),
    ).toBe(false);
  });

  it('leaves identifiable reels alone', () => {
    // The fix must not touch the path that works.
    const a = nameless({ shortcode: 'AAA', identity: 'AAA', captionText: 'x' });
    const b = nameless({ shortcode: 'BBB', identity: 'BBB', captionText: 'x' });
    expect(isSameReel(a, b)).toBe(false);
    expect(isSameReel(a, { ...a })).toBe(true);
  });
});
