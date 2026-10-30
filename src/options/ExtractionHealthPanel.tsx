// What the scraper managed to read, as a share of recent reels.
//
// The one panel that reports on the extension rather than on the feed. It
// exists because every number elsewhere on this page is only as good as this
// one: Instagram ships markup changes without notice, and a selector that
// stopped matching produces plausible-looking dashboards built on nothing.

import { fallbackIdentityShare, textlessShare, type ExtractionHealth } from '@shared/health.js';
import { formatPercent } from '@shared/format.js';

/** Renders nothing until there is a sample worth quoting a percentage from. */
export function ExtractionHealthPanel({ health }: { health: ExtractionHealth | null }) {
  if (!health || health.samples === 0) return null;
  const textless = textlessShare(health);

  return (
    <section className="section">
      <h2 className="section-label">Extraction health</h2>
      <p className="section-note">
        What the extension managed to read from your last {health.samples} reels. Captions,
        hashtags, and audio are all legitimately missing sometimes; the creator name and the
        reel ID are not, so those two are the ones worth watching.
      </p>
      <table className="log">
        <tbody>
          <tr>
            <td>Reel ID resolved</td>
            <td>{formatPercent(1 - fallbackIdentityShare(health))}</td>
          </tr>
          <tr>
            <td>Creator name resolved</td>
            <td>{formatPercent(1 - health.missingAuthor / health.samples)}</td>
          </tr>
          <tr>
            <td>Some readable text</td>
            <td>{formatPercent(1 - textless)}</td>
          </tr>
          <tr>
            <td>Audio name resolved</td>
            <td>{formatPercent(1 - health.missingAudio / health.samples)}</td>
          </tr>
          <tr>
            <td>Audio read via</td>
            <td>
              {Object.entries(health.audioChannels).length
                ? Object.entries(health.audioChannels)
                    .sort(([, a], [, b]) => b - a)
                    .map(([channel, count]) => `${channel} (${count})`)
                    .join(', ')
                : 'nothing matched'}
            </td>
          </tr>
          <tr>
            <td>Page bridge</td>
            <td>
              {health.bridgeStatus === 'ok'
                ? 'working'
                : health.bridgeStatus === 'no-fiber'
                  ? 'ran, but React exposed nothing to read'
                  : health.bridgeStatus === 'no-code'
                    ? 'ran, but the last reel had not finished loading'
                    : 'not seen yet'}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
