// The banners above the settings: something is broken, or nothing is yet.
//
// Deliberately mutually exclusive and ordered by root cause. A dead page
// bridge makes every downstream rate look bad at once, so a single upstream
// failure used to raise four alarms and bury the one that mattered — each
// guard below excludes the ones above it, and only the first true cause is
// shown.

import { fallbackIdentityShare, type ExtractionHealth } from '@shared/health.js';
import { formatPercent, formatTimestamp } from '@shared/format.js';
import type { StorageFailure } from '@shared/storage-health.js';

interface AlertsProps {
  /** Nothing observed and nothing rolled up, and we know that rather than having failed to ask. */
  brandNew: boolean;
  writeFailure: StorageFailure | null;
  health: ExtractionHealth | null;
  drifting: boolean;
  shortcodeDegraded: boolean;
  audioDark: boolean;
  /** Share of recent reels with no readable text at all. */
  textless: number;
}

export function Alerts({
  brandNew,
  writeFailure,
  health,
  drifting,
  shortcodeDegraded,
  audioDark,
  textless,
}: AlertsProps) {
  return (
    <>
      {brandNew && (
        <div className="alert info welcome">
          <h2>You&rsquo;re set up. There&rsquo;s nothing else to do.</h2>
          <p>
            Go and use Instagram the way you normally would — this watches the Reels you
            actually stop on and works out what they have in common. Everything stays on this
            machine.
          </p>
          <p>
            It will look idle for about a week, and that is the design. It flags a category only
            when it runs well above <em>your own</em> usual rate for it, so it needs to learn
            your usual rate first. A fixed threshold would spend that week accusing you of a
            problem it had no way to measure.
          </p>
          <p>
            Nothing will interrupt you unless you switch it on below, and that switch stays
            disabled until the baseline exists. Come back in a few days and the popup will show
            how far along it is.
          </p>
        </div>
      )}

      {writeFailure && (
        <div className="alert danger">
          <h2>Reels aren&rsquo;t being saved</h2>
          <p>
            A write to the local database failed at {formatTimestamp(writeFailure.at)}. The
            usual causes are a full disk or site data blocked for this Chrome profile. Watching
            carries on and saving resumes by itself once writes succeed again, but reels watched
            in the meantime are lost, and every number on this page is stale until then.
          </p>
          <p className="fine">{writeFailure.message}</p>
        </div>
      )}

      {drifting && health && (
        <div className="alert danger">
          <h2>Tracking is probably broken</h2>
          <p>
            The creator name couldn&rsquo;t be read on{' '}
            {formatPercent(health.missingAuthor / health.samples)} of recent reels. That field
            is on every real reel, so Instagram has most likely changed its page layout and the
            extension needs updating. Treat the numbers below as unreliable.
          </p>
        </div>
      )}

      {!drifting && shortcodeDegraded && health && (
        <div className="alert danger">
          <h2>Reels aren&rsquo;t being identified reliably</h2>
          <p>
            {health.bridgeStatus === 'no-fiber'
              ? 'Instagram no longer exposes the internals the extension reads a reel’s ID from.'
              : `The reel ID couldn’t be read on ${formatPercent(
                  fallbackIdentityShare(health),
                )} of recent reels.`}{' '}
            Watch time is still being recorded, but reels are being identified by creator and
            video filename instead — which stops matching once Instagram rotates its video URLs,
            so the same reel can be counted twice. The extension needs updating.
          </p>
        </div>
      )}

      {!drifting && !shortcodeDegraded && audioDark && health && (
        <div className="alert danger">
          <h2>Audio isn&rsquo;t being read</h2>
          <p>
            The song/audio name resolved on almost none of your recent reels (
            {formatPercent(1 - health.missingAudio / health.samples)}). Most reels use licensed
            audio, so this points to a broken audio selector rather than the reels genuinely
            lacking it — and audio is a real signal for mood. The extraction code needs updating
            against Instagram&rsquo;s current layout.
          </p>
        </div>
      )}

      {!drifting && !shortcodeDegraded && !audioDark && textless > 0.6 && (
        <div className="alert info">
          <h2>Most of your reels have no text</h2>
          <p>
            {formatPercent(textless)} carried no caption, hashtags, or audio name, so they
            can&rsquo;t be categorised. Text is the only signal available — this is a limit of
            the approach, not a fault.
          </p>
        </div>
      )}
    </>
  );
}
