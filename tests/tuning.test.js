import { describe, it, expect } from 'vitest';
import { buildTuningReport } from '../src/shared/tuning.ts';

let nextId = 0;

function ev({ category = 'neutral', captionText = null, hashtags = [] } = {}) {
  return {
    id: `e${nextId++}`,
    reelShortcode: 'abc',
    sessionId: 's1',
    startedAt: 0,
    endedAt: 1000,
    watchDurationMs: 1000,
    captionText,
    hashtags,
    audioName: null,
    category,
    categoryConfidence: category ? 0.5 : null,
    subtags: [],
  };
}

describe('buildTuningReport', () => {
  it('counts the three outcomes separately', () => {
    const report = buildTuningReport([
      ev({ category: null }),
      ev({ category: 'neutral', captionText: 'paneer tikka masala' }),
      ev({ category: 'sad', captionText: 'crying' }),
    ]);

    expect(report.totalReels).toBe(3);
    expect(report.textlessReels).toBe(1);
    expect(report.neutralReels).toBe(1);
    expect(report.classifiedReels).toBe(1);
  });

  it('only reports terms from neutral reels', () => {
    // A word that appears in a successfully classified reel is not a gap.
    const report = buildTuningReport([
      ev({ category: 'sad', captionText: 'devastated tonight' }),
      // Invented tokens, so they are genuinely not in the lexicon.
      ev({ category: 'neutral', captionText: 'blorptak fremwidge' }),
    ]);

    expect(report.topWords.map((t) => t.term).sort()).toEqual(['blorptak', 'fremwidge']);
  });

  it('ranks by frequency', () => {
    const report = buildTuningReport([
      ev({ captionText: 'zonktar update' }),
      ev({ captionText: 'zonktar again' }),
      ev({ captionText: 'zonktar returns' }),
      ev({ captionText: 'plindle today' }),
    ]);

    expect(report.topWords[0]).toEqual({ term: 'zonktar', count: 3 });
  });

  it('excludes terms the lexicon already knows', () => {
    // These would already have classified; seeing them would be misleading.
    const report = buildTuningReport([ev({ captionText: 'anxiety and heartbreak' })]);
    const terms = report.topWords.map((t) => t.term);

    expect(terms).not.toContain('anxiety');
    expect(terms).not.toContain('heartbreak');
  });

  it('still reports a word that only exists inside a phrase', () => {
    // Regression: bare "love" is deliberately not a romantic term — it
    // survives only in phrases like "in love". Treating it as already-known
    // hid the single term most likely to need reconsidering.
    const report = buildTuningReport([
      ev({ captionText: 'love this pasta' }),
      ev({ captionText: 'love the weather today' }),
    ]);

    expect(report.topWords.map((t) => t.term)).toContain('love');
  });

  it('excludes platform boilerplate that appears on everything', () => {
    const report = buildTuningReport([
      ev({ captionText: 'follow for more', hashtags: ['viral', 'fyp', 'trending'] }),
    ]);

    expect(report.topHashtags).toEqual([]);
    expect(report.topWords.map((t) => t.term)).not.toContain('follow');
  });

  it('keeps non-Latin script, which is the whole point of the report', () => {
    // A feed in another language is one of the two explanations for a high
    // neutral rate, and an ASCII-only tokenizer would hide it entirely.
    const report = buildTuningReport([
      ev({ captionText: 'दिल टूट गया' }),
      ev({ captionText: 'दिल की बात' }),
    ]);

    expect(report.topWords[0]).toEqual({ term: 'दिल', count: 2 });
  });

  it('reports hashtags separately from words', () => {
    const report = buildTuningReport([
      ev({ captionText: 'glonk today', hashtags: ['zibberish', 'wompus'] }),
    ]);

    expect(report.topHashtags.map((t) => t.term).sort()).toEqual(['wompus', 'zibberish']);
    expect(report.topWords.map((t) => t.term)).toContain('glonk');
  });

  it('drops very short tokens and bare numbers', () => {
    const report = buildTuningReport([ev({ captionText: 'a b 2024 ok blorptak' })]);
    expect(report.topWords.map((t) => t.term)).toEqual(['blorptak']);
  });

  it('keeps verbatim captions so content type can be judged by eye', () => {
    const report = buildTuningReport([ev({ captionText: 'Butter chicken in 20 minutes' })]);
    expect(report.sampleCaptions).toEqual(['Butter chicken in 20 minutes']);
  });

  it('truncates a long caption rather than dropping it', () => {
    const long = 'x'.repeat(400);
    const [sample] = buildTuningReport([ev({ captionText: long })]).sampleCaptions;
    expect(sample.length).toBeLessThan(140);
    expect(sample.endsWith('…')).toBe(true);
  });

  it('honours the term limit', () => {
    const events = Array.from({ length: 40 }, (_, i) => ev({ captionText: `token${i}x` }));
    expect(buildTuningReport(events, 5).topWords).toHaveLength(5);
  });

  it('is deterministic when counts tie', () => {
    const events = [ev({ captionText: 'zebra apple' }), ev({ captionText: 'mango' })];
    const first = buildTuningReport(events).topWords.map((t) => t.term);
    for (let i = 0; i < 3; i++) {
      expect(buildTuningReport(events).topWords.map((t) => t.term)).toEqual(first);
    }
  });

  it('handles no history', () => {
    const report = buildTuningReport([]);
    expect(report.totalReels).toBe(0);
    expect(report.topWords).toEqual([]);
    expect(report.sampleCaptions).toEqual([]);
  });
});
