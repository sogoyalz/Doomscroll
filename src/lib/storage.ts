// Thin wrapper around chrome.storage.local so the rest of the codebase never
// touches the chrome.* API directly (makes it mockable in tests).

import type { ReelRecord, StoredData } from './types.js';

const DEFAULTS: StoredData = {
  reelCount: 0,
  reel_records: [],
  settings: { useLLM: false },
};

// `keys` doubles as the fallback values chrome.storage.local.get() returns
// for keys missing from storage, so the resolved object always has the same
// shape as StoredData regardless of which subset of keys was requested.
export function getAll(
  keys: Partial<StoredData> | (keyof StoredData)[] = DEFAULTS,
): Promise<StoredData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data as unknown as StoredData));
  });
}

export function set(data: Partial<StoredData>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

export function onChanged(callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') callback(changes);
  });
}

export async function initDefaults(): Promise<void> {
  const data = await getAll(['reelCount', 'reel_records', 'settings']);
  const patch: Partial<StoredData> = {};
  if (data.reelCount === undefined) patch.reelCount = DEFAULTS.reelCount;
  if (!Array.isArray(data.reel_records)) patch.reel_records = DEFAULTS.reel_records;
  if (!data.settings) patch.settings = DEFAULTS.settings;
  if (Object.keys(patch).length) await set(patch);
}

const MAX_RECORDS = 2000;

// appendRecord does a read-modify-write against chrome.storage.local, which has
// no atomic increment/append. Two REEL_WATCHED messages handled concurrently
// (plausible — IG's feed can advance fast) would otherwise both read the same
// array and the second write clobbers the first's append. Chaining every call
// through one promise serializes them so each read sees the prior write.
let appendQueue: Promise<unknown> = Promise.resolve();

export function appendRecord(
  record: ReelRecord,
): Promise<{ reelCount: number; record: ReelRecord }> {
  const result = appendQueue.then(async () => {
    const data = await getAll({ reel_records: [], reelCount: 0 });
    const records = data.reel_records || [];
    records.push(record);
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    const reelCount = (typeof data.reelCount === 'number' ? data.reelCount : 0) + 1;
    await set({ reel_records: records, reelCount });
    return { reelCount, record };
  });
  appendQueue = result.catch(() => {});
  return result;
}

export async function clearAll(): Promise<void> {
  await set({ reel_records: [], reelCount: 0 });
}
