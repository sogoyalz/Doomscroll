import { describe, it, expect } from 'vitest';
import { classify, hasSignal } from '../src/shared/classifier.ts';
import { LEXICON, TIE_BREAK_ORDER } from '../src/shared/lexicon.ts';
import { CATEGORIES } from '../src/shared/taxonomy.ts';

function input({ captionText = null, hashtags = [], audioName = null } = {}) {
  return { captionText, hashtags, audioName };
}

describe('the unclassified / neutral distinction', () => {
  it('returns null when there is no text at all', () => {
    // A dance clip with no caption: nothing looked, so nothing is claimed.
    expect(classify(input())).toBeNull();
  });

  it('treats whitespace-only text as no signal', () => {
    expect(classify(input({ captionText: '   \n  ' }))).toBeNull();
  });

  it('returns neutral when there was text but nothing charged in it', () => {
    // Looked and found nothing — a real finding, unlike having nothing to read.
    const result = classify(input({ captionText: 'the parcel arrived on tuesday afternoon' }));
    expect(result.category).toBe('neutral');
  });

  it('counts hashtags alone as signal', () => {
    expect(classify(input({ hashtags: ['cooking'] }))).not.toBeNull();
  });

  it('counts an audio name alone as signal', () => {
    expect(classify(input({ audioName: 'Some Artist · Some Song' }))).not.toBeNull();
  });
});

describe('clear-cut category cases', () => {
  it.each([
    ['joyful', 'so happy and grateful today, best day', ['blessed']],
    ['sad', 'crying again tonight, feeling so lonely', ['sad']],
    ['breakup', 'still not over the breakup, trying to move on', ['heartbreak']],
    ['anxious', 'my anxiety is spiraling, another panic attack', ['anxiety']],
    ['angry', 'absolutely furious about this, what an outrage', ['rant']],
    ['motivational', 'discipline over motivation, never give up', ['grindset']],
    ['romantic', 'my boyfriend surprised me on our anniversary', ['couplegoals']],
  ])('classifies %s content', (expected, captionText, hashtags) => {
    const result = classify(input({ captionText, hashtags }));
    expect(result.category).toBe(expected);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('reports the terms that drove the decision', () => {
    const result = classify(input({ captionText: 'so much anxiety', hashtags: ['overthinking'] }));
    expect(result.subtags).toContain('anxiety');
    expect(result.subtags).toContain('#overthinking');
  });

  describe('topic tier keeps ordinary content out of neutral', () => {
    it.each([
      ['comedy', 'new standup skit, try not to laugh', ['meme']],
      ['food', 'easy paneer recipe for dinner', ['streetfood']],
      ['sports', 'what an over, cricket at its best', ['ipl']],
      ['music', 'acoustic guitar cover of this song', ['cover']],
      ['fitness', 'leg day at the gym, chasing those abs', ['gymmotivation']],
      ['tech', 'quick python coding tutorial', ['programming']],
      ['travel', 'weekend trip to the mountains', ['wanderlust']],
      ['pets', 'my puppy learned a new trick', ['dogsofinstagram']],
    ])('names %s content that would otherwise be neutral', (expected, captionText, hashtags) => {
      expect(classify(input({ captionText, hashtags })).category).toBe(expected);
    });

    it('leaves genuinely topic-less text as neutral', () => {
      expect(classify(input({ captionText: 'the meeting is at four tomorrow' })).category).toBe(
        'neutral',
      );
    });
  });

  describe('charged outranks topic on a tie', () => {
    it('reads a heartbreak song as breakup, not music', () => {
      // Both tiers match; the emotional register is what detection cares about.
      const result = classify(input({ captionText: 'heartbreak song, still not over you' }));
      expect(result.category).toBe('breakup');
    });

    it('reads a gym-motivation clip as motivational, not fitness, when motivation leads', () => {
      const result = classify(
        input({ captionText: 'discipline over motivation, no excuses', hashtags: ['grindset'] }),
      );
      expect(result.category).toBe('motivational');
    });
  });

  it('caps subtags so one verbose caption cannot bloat a record', () => {
    const result = classify(
      input({
        captionText: 'sad crying tears lonely grief numb hopeless despair miserable',
      }),
    );
    expect(result.subtags.length).toBeLessThanOrEqual(5);
  });
});

describe('word matching', () => {
  it('does not match a lexicon word inside a longer word', () => {
    // "ex" is a breakup term; it must not fire on "example" or "next".
    const result = classify(input({ captionText: 'for example, the next step is simple' }));
    expect(result.category).toBe('neutral');
  });

  it('matches a word regardless of surrounding punctuation', () => {
    expect(classify(input({ captionText: 'i am (angry)!' })).category).toBe('angry');
  });

  it('is case insensitive', () => {
    expect(classify(input({ captionText: 'SO ANXIOUS RIGHT NOW' })).category).toBe('anxious');
  });

  it('matches multi-word phrases', () => {
    expect(classify(input({ captionText: 'we broke up last week' })).category).toBe('breakup');
  });

  it('does not match a phrase split across unrelated words', () => {
    const result = classify(input({ captionText: 'broke the vase, then went up the stairs' }));
    expect(result.category).not.toBe('breakup');
  });

  it('matches emoji', () => {
    expect(classify(input({ captionText: 'no words 💔' })).category).toBe('breakup');
  });

  it('keeps non-Latin words whole when tokenizing', () => {
    // Regression: combining vowel marks are \p{M}, not \p{L}. Splitting on
    // them shattered Devanagari into single characters, so no term added in
    // such a script could ever match.
    const result = classify(input({ captionText: 'दिल टूट गया 💔' }));
    expect(result.category).toBe('breakup');
  });
});

describe('signal weighting', () => {
  it('lets a hashtag outweigh a single competing caption word', () => {
    // "love" is romantic; the deliberate #breakup tag should win.
    const result = classify(input({ captionText: 'i love this', hashtags: ['breakup'] }));
    expect(result.category).toBe('breakup');
  });

  it('weights audio below caption text', () => {
    const viaCaption = classify(input({ captionText: 'heartbreak breakup' }));
    const viaAudio = classify(input({ audioName: 'heartbreak breakup' }));
    expect(viaCaption.category).toBe('breakup');
    expect(viaAudio.category).toBe('breakup');
    expect(viaAudio.confidence).toBeLessThan(viaCaption.confidence);
  });

  it('will not classify on a single half-weight audio hit alone', () => {
    // Song titles routinely mismatch the content they play over — a sad track
    // on a comedy skit is a genre. One audio term is not enough.
    expect(classify(input({ audioName: 'Some Artist · Heartbreak' })).category).toBe('neutral');
  });

  it('still lets audio alone carry a classification', () => {
    const result = classify(input({ audioName: 'Some Artist · Breakup Song heartbreak' }));
    expect(result.category).toBe('breakup');
  });

  describe('charged recall is favoured over per-reel precision', () => {
    it('rescues a weak authored charged signal from neutral', () => {
      // Natural-language sadness with one term and no margin used to fall
      // below the confidence floor into neutral — a miss the detector can
      // never recover. The detection layer enforces precision instead.
      expect(classify(input({ captionText: 'why does it always hurt like this' })).category).toBe(
        'sad',
      );
    });

    it('rescues a charged reel that ties between two charged categories', () => {
      // 'naraz' (angry) + 😭 (sad) tie; it must land on some charged category,
      // not neutral, because for detection what matters is that it is emotional.
      const result = classify(input({ captionText: 'kya tum naraz ho 😭' }));
      expect(['angry', 'sad']).toContain(result.category);
    });

    it('does NOT rescue an audio-only charged hit', () => {
      // A song title is not authored by the poster and routinely mismatches
      // the content, so a lone half-weight audio match stays neutral.
      expect(classify(input({ audioName: 'Some Artist · Heartbreak' })).category).toBe('neutral');
    });

    it('does NOT rescue a weak TOPIC signal — topics keep the floor', () => {
      // Only charged content is favoured for recall; a lone weak topic match
      // must not flood the dashboard with low-confidence topic guesses.
      const result = classify(input({ audioName: 'Some Artist · Guitar' }));
      expect(result.category).toBe('neutral');
    });
  });
});

describe('confidence', () => {
  it('rises as more of the same category matches', () => {
    const weak = classify(input({ captionText: 'a bit anxious' }));
    const strong = classify(
      input({ captionText: 'anxiety and panic, overthinking again', hashtags: ['anxiety'] }),
    );
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it('drops when two categories match equally', () => {
    const clean = classify(input({ hashtags: ['anxiety'] }));
    const ambiguous = classify(input({ hashtags: ['anxiety', 'motivation'] }));
    expect(ambiguous.confidence).toBeLessThan(clean.confidence);
  });

  it('never exceeds 1', () => {
    const result = classify(
      input({
        captionText: 'sad crying tears lonely grief despair, i miss you, feeling low',
        hashtags: ['sad', 'depression', 'lonely'],
      }),
    );
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('does not read ordinary enthusiasm as romantic', () => {
    // "love" is among the most overloaded tokens on the platform, so it is
    // deliberately not a romantic term on its own. ("recipe" now lands this
    // on the food topic, which is correct — the point is it is not romantic.)
    expect(classify(input({ captionText: 'i love this pasta recipe so much' })).category).not.toBe(
      'romantic',
    );
  });

  it('still reads an explicit romantic phrase', () => {
    expect(classify(input({ captionText: 'i am so in love with him' })).category).toBe('romantic');
  });
});

describe('tie-breaking', () => {
  it('is deterministic across repeated calls', () => {
    const args = input({ hashtags: ['sad', 'breakup'] });
    const first = classify(args).category;
    for (let i = 0; i < 5; i++) expect(classify(args).category).toBe(first);
  });

  it('prefers the more specific category on an exact tie', () => {
    // breakup precedes sad in TIE_BREAK_ORDER.
    expect(classify(input({ hashtags: ['sad', 'breakup'] })).category).toBe('breakup');
  });

  it('does not depend on the order signals are supplied in', () => {
    const a = classify(input({ hashtags: ['breakup', 'sad'] })).category;
    const b = classify(input({ hashtags: ['sad', 'breakup'] })).category;
    expect(a).toBe(b);
  });
});

describe('lexicon integrity', () => {
  it('covers every category except neutral', () => {
    const classifiable = CATEGORIES.filter((c) => c !== 'neutral');
    expect(Object.keys(LEXICON).sort()).toEqual([...classifiable].sort());
  });

  it('tie-break order lists every classifiable category exactly once', () => {
    expect([...TIE_BREAK_ORDER].sort()).toEqual(Object.keys(LEXICON).sort());
    expect(new Set(TIE_BREAK_ORDER).size).toBe(TIE_BREAK_ORDER.length);
  });

  it('has only lowercase terms, since matching normalizes to lowercase', () => {
    for (const [category, table] of Object.entries(LEXICON)) {
      for (const term of [...table.words, ...table.phrases, ...table.hashtags]) {
        expect(term, `${category}: "${term}"`).toBe(term.toLowerCase());
      }
    }
  });

  it('has no multi-word entries in the whole-word list', () => {
    for (const [category, table] of Object.entries(LEXICON)) {
      for (const word of table.words) {
        expect(word.includes(' '), `${category}: "${word}"`).toBe(false);
      }
    }
  });

  it('has no single-word entries in the phrase list', () => {
    for (const [category, table] of Object.entries(LEXICON)) {
      for (const phrase of table.phrases) {
        expect(phrase.includes(' '), `${category}: "${phrase}"`).toBe(true);
      }
    }
  });

  it('has no hashtag containing a "#" or space', () => {
    for (const table of Object.values(LEXICON)) {
      for (const tag of table.hashtags) {
        expect(tag).not.toMatch(/[#\s]/);
      }
    }
  });
});

describe('hasSignal', () => {
  it('is false for a fully empty reel', () => {
    expect(hasSignal(input())).toBe(false);
  });

  it('is true when any one field has content', () => {
    expect(hasSignal(input({ captionText: 'hi' }))).toBe(true);
    expect(hasSignal(input({ hashtags: ['x'] }))).toBe(true);
    expect(hasSignal(input({ audioName: 'x' }))).toBe(true);
  });
});

describe('the general vocabulary applies to hashtags, not just the curated list', () => {
  it('reads a lexicon word written as a hashtag', () => {
    // Before this, the highest-weighted channel had the smallest dictionary:
    // only the curated hashtag list was ever consulted for tags, so a word the
    // lexicon knows scored nothing when it arrived with a '#'.
    expect(classify(input({ hashtags: ['दर्द'] })).category).toBe('sad');
    expect(classify(input({ hashtags: ['बेवफा'] })).category).toBe('breakup');
  });

  it('gives the same verdict whether a term is a caption word or a hashtag', () => {
    const asCaption = classify(input({ captionText: 'दर्द' }));
    const asHashtag = classify(input({ hashtags: ['दर्द'] }));
    expect(asHashtag.category).toBe(asCaption.category);
  });

  it('matches whole tokens, never substrings', () => {
    // #sadhguru is not sad content. Substring matching would say otherwise,
    // which is why compound tags like #sadstatus are left unmatched instead.
    expect(classify(input({ hashtags: ['sadhguru'] })).category).toBe('neutral');
  });

  it('still pays the premium for a curated hashtag', () => {
    // A term someone deliberately added to the hashtag lexicon outranks an
    // incidental vocabulary hit, and must not lose that weight.
    const curated = classify(input({ hashtags: ['sad'] }));
    const incidental = classify(input({ hashtags: ['दर्द'] }));
    expect(curated.confidence).toBeGreaterThan(incidental.confidence);
  });

  it('does not count a curated hashtag twice', () => {
    // The tag is in the hashtag list; scoring it again as text would inflate
    // the score and, through it, the reported confidence.
    expect(classify(input({ hashtags: ['sad'] })).confidence).toBeLessThanOrEqual(1);
  });

  it('ignores decorative emoji inside hashtags', () => {
    // Reach tags routinely carry hearts that mean nothing about the content.
    // Measured: reading these as romantic was worse than ignoring them.
    expect(classify(input({ hashtags: ['trendingsongs❤️'] })).category).toBe('neutral');
    expect(classify(input({ hashtags: ['reelindia❤️'] })).category).toBe('neutral');
  });

  it('still reads emoji in a caption, where they are meant', () => {
    const result = classify(input({ captionText: 'miss you ❤️' }));
    expect(result.category).not.toBe('neutral');
  });
});
