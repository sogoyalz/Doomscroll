// Every detection check, including the ones that decided to stay quiet.
//
// The quiet ones are the useful half: this is the surface the thresholds are
// tuned against, and a log of only the hits would show which settings fire
// without showing which ones nearly did.

import { formatPercent, formatRatio, formatTimestamp, reasonLabel } from '@shared/format.js';
import type { DetectionLogEntry } from '@shared/types.js';

export function DetectionLogPanel({ log }: { log: DetectionLogEntry[] }) {
  const flagged = log.filter((e) => e.detected).length;

  return (
    <section className="section">
      <h2 className="section-label">Detection log</h2>
      <p className="section-note">
        Every check, including the ones that didn&rsquo;t fire — those are the useful half. An
        unbroken run of the same outcome is collapsed into one row; &ldquo;checks&rdquo; is how
        many reels it held for. &ldquo;Normal&rdquo; is your own rate over the last fortnight,
        weighted toward recent days; &ldquo;usual&rdquo; is the same thing over two months. When
        those two disagree, your feed has shifted recently.
        {flagged > 0
          ? ` ${flagged} of the last ${log.length} decision groups flagged a pattern. Intervention thresholds and cooldowns are evaluated separately.`
          : ' No recorded decision groups flagged a pattern.'}
      </p>

      {log.length === 0 ? (
        <p className="empty">No checks recorded yet. Scroll some reels and come back.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Category</th>
                <th className="num">Share</th>
                <th className="num">Normal</th>
                <th className="num">Usual</th>
                <th className="num">Ratio</th>
                <th className="num">Run</th>
                <th className="num">Checks</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry) => (
                <tr key={entry.id}>
                  <td className="when">{formatTimestamp(entry.at)}</td>
                  <td className="cat">{entry.category ?? '—'}</td>
                  <td className="num">{entry.category ? formatPercent(entry.share) : '—'}</td>
                  <td className="num">
                    {entry.category ? formatPercent(entry.baselineShare) : '—'}
                  </td>
                  <td className="num">
                    {entry.category && entry.baselineShareLong !== undefined
                      ? formatPercent(entry.baselineShareLong)
                      : '—'}
                  </td>
                  <td className="num">{entry.category ? formatRatio(entry.ratio) : '—'}</td>
                  <td className="num">{entry.streak || '—'}</td>
                  <td className="num">{entry.occurrences ?? 1}</td>
                  <td>
                    <span className={`outcome${entry.detected ? ' hit' : ''}`}>
                      {reasonLabel(entry.reason)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
