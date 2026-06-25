// Thin wrapper around chrome.storage.local so the rest of the codebase never
// touches the chrome.* API directly (makes it mockable in tests).

const DEFAULTS = {
  reelCount: 0,
  reel_records: [],
  settings: { useLLM: false },
};

export function getAll(keys = DEFAULTS) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

export function set(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

export function onChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') callback(changes);
  });
}

export async function initDefaults() {
  const data = await getAll(['reelCount', 'reel_records', 'settings']);
  const patch = {};
  if (data.reelCount === undefined) patch.reelCount = DEFAULTS.reelCount;
  if (!Array.isArray(data.reel_records)) patch.reel_records = DEFAULTS.reel_records;
  if (!data.settings) patch.settings = DEFAULTS.settings;
  if (Object.keys(patch).length) await set(patch);
}

export async function appendRecord(record) {
  const data = await getAll({ reel_records: [], reelCount: 0 });
  const records = data.reel_records || [];
  records.push(record);
  const reelCount = (typeof data.reelCount === 'number' ? data.reelCount : 0) + 1;
  await set({ reel_records: records, reelCount });
  return { reelCount, record };
}

export async function clearAll() {
  await set({ reel_records: [], reelCount: 0 });
}
