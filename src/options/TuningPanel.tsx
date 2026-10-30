// The words behind an unhelpful "neutral".
//
// When most of a feed classifies as neutral there are two explanations that
// look identical in the percentages — the word list is missing that feed's
// vocabulary, or the taxonomy does not describe that feed at all — and only
// the actual terms tell them apart. See shared/tuning.ts for how they are
// picked.

import type { TuningReport } from '@shared/tuning.js';

/** Hidden entirely when nothing came back neutral: there is nothing to tune. */
export function TuningPanel({ tuning }: { tuning: TuningReport | null }) {
  if (!tuning || tuning.neutralReels === 0) return null;

  return (
    <section className="section">
      <h2 className="section-label">Why so much neutral</h2>
      <p className="section-note">
        {tuning.neutralReels} of {tuning.totalReels} reels had readable text that matched
        nothing in the word list. These are the terms that came up most often in them. If they
        look like feelings, they are worth adding to <code>src/shared/lexicon.ts</code>. If they
        look like recipes, cricket, or product names, the feed genuinely is not emotional and
        neutral is the right answer.
      </p>

      <div className="terms">
        <div>
          <h3 className="terms-label">Hashtags</h3>
          {tuning.topHashtags.length === 0 ? (
            <p className="empty">None.</p>
          ) : (
            <ul className="term-list">
              {tuning.topHashtags.map(({ term, count }) => (
                <li key={term}>
                  <span>#{term}</span>
                  <span className="term-count">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="terms-label">Words</h3>
          {tuning.topWords.length === 0 ? (
            <p className="empty">None.</p>
          ) : (
            <ul className="term-list">
              {tuning.topWords.map(({ term, count }) => (
                <li key={term}>
                  <span>{term}</span>
                  <span className="term-count">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {tuning.sampleCaptions.length > 0 && (
        <>
          <h3 className="terms-label" style={{ marginTop: 22 }}>
            Captions that matched nothing
          </h3>
          <ul className="samples">
            {tuning.sampleCaptions.map((caption, i) => (
              <li key={i}>{caption}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
