// One scrolling session at a time, with the reels in the order they came.
//
// The other views aggregate; this one deliberately does not. Detection acts on
// runs — an unbroken stretch of one register — and a run is invisible in any
// summary, because a session that was 40% sad reads the same whether that was
// spread evenly or arrived as twelve in a row. The strip is the only place
// that distinction is visible, which makes it the view for answering "was the
// log right about this session".
//
// Reels are equal-width cells rather than scaled by watch time. Width by
// duration turns the strip into a chart about dwell, and buries the thing it
// is for: a run of twelve reels should look like twelve cells regardless of
// how long each was held.

import { useCallback, useState } from 'react';
import { send } from '@shared/client.js';
import { formatDuration, formatTimestamp } from '@shared/format.js';
import { colorForCategory, UNCLASSIFIED_COLOR } from '@shared/palette.js';
import { UNCLASSIFIED } from '@shared/aggregation.js';
import { TOPICS_BAND, type SessionSummary } from '@shared/insights.js';
import type { ReelEvent } from '@shared/types.js';

interface Props {
  sessions: SessionSummary[];
}

const BAND_COLORS: Record<string, string> = {
  [TOPICS_BAND]: '#8a8a95',
  [UNCLASSIFIED]: UNCLASSIFIED_COLOR,
};

/**
 * The summary bar pools topics into one band; the strip does not.
 *
 * Deliberate, and the reason is the difference between the two shapes. Twenty
 * one colours stacked in an eight-pixel bar is a texture, but the strip is a
 * sequence of discrete cells with a tooltip each — there, telling `food` from
 * `music` is exactly what a reader wants, and pooling them would hide that a
 * "topic stretch" was really one creator's cooking videos.
 */
function colorFor(key: string): string {
  return BAND_COLORS[key] ?? colorForCategory(key);
}

function labelFor(key: string): string {
  if (key === TOPICS_BAND) return 'topics';
  if (key === UNCLASSIFIED) return 'no text';
  return key;
}

/** First line of a caption, trimmed — the strip's tooltip, not a reader. */
function captionHint(event: ReelEvent): string {
  const line = (event.captionText ?? '').split('\n')[0]?.trim() ?? '';
  if (!line) return event.hashtags.length ? `#${event.hashtags.join(' #')}` : '(no text)';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

export function Sessions({ sessions }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reels, setReels] = useState<ReelEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setReels([]);
        return;
      }
      // Fetched on expand rather than up front: a month of sessions is
      // thousands of reels, and almost none of them are ever looked at.
      setOpenId(id);
      setLoading(true);
      setFailed(false);
      setReels([]);
      try {
        setReels(await send('GET_SESSION_REELS', { sessionId: id }));
      } catch {
        // Without this the strip renders empty under a note explaining how to
        // read it, which says "this session had no reels" — a claim about the
        // data rather than about the fetch that failed.
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [openId],
  );

  return (
    <div className="sessions">
      {sessions.map((session) => {
        const open = openId === session.id;
        return (
          <div className={`session${open ? ' is-open' : ''}`} key={session.id}>
            <button
              className="session-head"
              onClick={() => void toggle(session.id)}
              aria-expanded={open}
            >
              <span className="session-when">{formatTimestamp(session.startedAt)}</span>
              <span className="session-meta">
                {session.reelCount} reels · {formatDuration(session.totalDurationMs)}
              </span>
              <span className="session-mix" aria-hidden="true">
                {session.bands.map((band) => (
                  <span
                    key={band.key}
                    className="session-seg"
                    style={{ width: `${band.share * 100}%`, background: colorFor(band.key) }}
                  />
                ))}
              </span>
              {/* The finding, when there is one. Describes the run, not the
                  person who watched it. */}
              {session.longestRun && session.longestRun.length >= 3 ? (
                <span className="session-run">
                  {session.longestRun.length} × {session.longestRun.category} in a row
                </span>
              ) : (
                <span className="session-run is-quiet">no run</span>
              )}
            </button>

            {open && (
              <div className="session-body">
                {loading ? (
                  <p className="empty">Loading</p>
                ) : failed ? (
                  <p className="empty">Couldn&rsquo;t load this session&rsquo;s reels.</p>
                ) : reels.length === 0 ? (
                  <p className="empty">
                    This session&rsquo;s reels have been deleted — history is kept for 90 days.
                  </p>
                ) : (
                  <>
                    <div className="strip">
                      {reels.map((reel) => (
                        <span
                          key={reel.id}
                          className="strip-cell"
                          style={{ background: colorFor(reel.category ?? UNCLASSIFIED) }}
                          title={
                            `${labelFor(reel.category ?? UNCLASSIFIED)} · ` +
                            `${formatDuration(reel.watchDurationMs)}` +
                            `${reel.authorHandle ? ` · @${reel.authorHandle}` : ''}\n` +
                            captionHint(reel)
                          }
                        />
                      ))}
                    </div>
                    <p className="strip-note">
                      Each cell is one reel, in the order you saw them — a run shows up as a
                      block of one colour. Hover for the caption.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
