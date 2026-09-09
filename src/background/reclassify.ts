// Re-labels stored history when the lexicon changes.
//
// Possible because a ReelEvent keeps the inputs classification was derived
// from — captionText, hashtags, audioName — rather than discarding them after
// the first pass. That makes tuning the lexicon against a real feed practical:
// edit the terms, bump LEXICON_VERSION, reload, and existing history is
// re-scored instead of having to be thrown away.

import { getAllReelEvents, putDailyAggregates, putReelEvents } from './db.js';
import { classifyReel } from './classify.js';
import { aggregateDay, groupByLocalDay } from '@shared/aggregation.js';
import { LEXICON_VERSION } from '@shared/lexicon.js';
import type { ReelEvent, UserSettings } from '@shared/types.js';

const LEXICON_VERSION_KEY = 'doomscroll:lexiconVersion';

/**
 * Re-scores every stored event and rebuilds the affected daily aggregates.
 *
 * Returns the number of events whose category actually changed.
 */
export async function reclassifyAll(
  mode: UserSettings['classificationMode'] = 'local-rules',
  gapMs?: number,
): Promise<number> {
  const events = await getAllReelEvents();
  if (!events.length) return 0;

  // `current` is the post-relabel view of every event, kept in memory so the
  // aggregate rebuild below does not have to re-read the whole store.
  const current: ReelEvent[] = [];
  const rewrites: ReelEvent[] = [];

  for (const event of events) {
    const classification = classifyReel(event, mode);
    const category = classification?.category ?? null;
    if (
      category === event.category &&
      (classification?.confidence ?? null) === event.categoryConfidence
    ) {
      current.push(event);
      continue;
    }

    const relabelled: ReelEvent = {
      ...event,
      category,
      categoryConfidence: classification?.confidence ?? null,
      subtags: classification?.subtags ?? [],
    };
    current.push(relabelled);
    rewrites.push(relabelled);
  }

  // Batched: a lexicon bump rewrites most of the history, and one transaction
  // per row took minutes at a realistic volume — long enough for an MV3 worker
  // to be killed partway, leaving the version stamp unwritten and the whole
  // pass retrying forever without ever finishing.
  await putReelEvents(rewrites);

  if (rewrites.length) {
    // Aggregates carry a category breakdown, so they are stale the moment any
    // label moves.
    const rebuilt = [...groupByLocalDay(current)].map(([dateKey, dayEvents]) =>
      aggregateDay(dateKey, dayEvents, gapMs),
    );
    await putDailyAggregates(rebuilt);
  }

  return rewrites.length;
}

/**
 * Runs a re-label only when the stored lexicon version is behind the current
 * one, so a normal extension reload does not rescan the whole history.
 */
export async function reclassifyIfLexiconChanged(
  mode: UserSettings['classificationMode'] = 'local-rules',
  gapMs?: number,
): Promise<number> {
  let stored: unknown;
  try {
    ({ [LEXICON_VERSION_KEY]: stored } = await chrome.storage.local.get(LEXICON_VERSION_KEY));
  } catch {
    return 0;
  }

  if (stored === LEXICON_VERSION) return 0;

  const changed = await reclassifyAll(mode, gapMs);

  try {
    await chrome.storage.local.set({ [LEXICON_VERSION_KEY]: LEXICON_VERSION });
  } catch {
    // Failing to record the version only means a repeat pass next load, which
    // is idempotent.
  }

  return changed;
}
