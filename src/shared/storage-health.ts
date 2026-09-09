// Whether the database is actually accepting writes.
//
// Separate from health.ts, which measures whether the *page* can still be read.
// This measures whether what was read can still be kept, and the two fail for
// unrelated reasons — a moved selector versus a full disk, a corrupted
// database, or a profile where IndexedDB is blocked outright.
//
// The reason it needs surfacing at all is that its symptom is identical to two
// other states: the popup says "Nothing tracked yet" whether you have not
// scrolled, whether tracking is paused, or whether every write has been failing
// for a week. The first two are explained on screen. The third was not, and it
// is the only one where the user has genuinely lost something.

const KEY = 'doomscroll:storageFailure';

export interface StorageFailure {
  /** When the most recent failed write happened. */
  at: number;
  /** The error, for the diagnostics the user can copy out. */
  message: string;
}

function isFailure(value: unknown): value is StorageFailure {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<StorageFailure>;
  return typeof c.at === 'number' && typeof c.message === 'string';
}

export async function readStorageFailure(): Promise<StorageFailure | null> {
  try {
    const { [KEY]: stored } = await chrome.storage.local.get(KEY);
    return isFailure(stored) ? stored : null;
  } catch {
    // chrome.storage is unavailable too. Nothing useful to report, and the
    // caller is a dashboard that must still render.
    return null;
  }
}

/**
 * Whether this context has already looked.
 *
 * `null` until the first read. Held per context, so the worker seeds it once
 * per lifetime rather than reading storage on every reel — which is the whole
 * point: a healthy install must pay nothing for this.
 */
let failing: boolean | null = null;

export async function noteStorageFailure(error: unknown, now: number = Date.now()): Promise<void> {
  failing = true;
  try {
    await chrome.storage.local.set({
      [KEY]: { at: now, message: String(error).slice(0, 200) } satisfies StorageFailure,
    });
  } catch {
    // If neither database will take a write there is nowhere left to record
    // that, and saying so is not worth crashing the write path over.
  }
}

/**
 * Called after every successful write, so it has to be nearly free.
 *
 * It reads storage exactly once per context — to find out whether a previous
 * worker left a failure behind — and writes only when there is one to clear.
 * On a healthy install that is one read for the life of the service worker and
 * no writes at all.
 */
export async function noteStorageWorking(): Promise<void> {
  if (failing === false) return;

  if (failing === null) {
    failing = (await readStorageFailure()) !== null;
    if (!failing) return;
  }

  failing = false;
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    // The banner lingers until the next successful write. Harmless.
  }
}

/** Test seam: forget what this context believes about the store. */
export function resetStorageHealthCache(): void {
  failing = null;
}
