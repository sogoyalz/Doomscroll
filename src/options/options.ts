// Settings page: toggle LLM/on-device classification, manage stored data.
//
// The on-device ML classifier no longer runs here — it runs in a background
// offscreen document (see src/offscreen/), so it works whether or not this
// page is open. This page just persists the toggle.

import { getAll, set, clearAll } from '../lib/storage.js';
import { toCSV, downloadCSV } from '../lib/csv.js';
import type { Settings } from '../lib/types.js';

const DEFAULT_SETTINGS: Settings = {
  useLLM: false,
  llmEndpoint: '',
  llmApiKey: '',
  useMLClassifier: false,
};

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el as T;
}

const ML_ENABLED_NOTE =
  'On-device model runs in the background when enabled. First use downloads a few MB.';

document.addEventListener('DOMContentLoaded', async () => {
  const useLLMEl = getEl<HTMLInputElement>('useLLM');
  const llmFields = getEl('llmFields');
  const endpointEl = getEl<HTMLInputElement>('llmEndpoint');
  const apiKeyEl = getEl<HTMLInputElement>('llmApiKey');
  const useMLEl = getEl<HTMLInputElement>('useMLClassifier');
  const mlStatus = getEl('mlStatus');
  const saveBtn = getEl('save');
  const saveStatus = getEl('saveStatus');
  const exportBtn = getEl('export');
  const clearBtn = getEl('clear');

  function syncLLMFieldsVisibility() {
    llmFields.hidden = !useLLMEl.checked;
  }

  const data = await getAll({ settings: DEFAULT_SETTINGS });
  const settings = { ...DEFAULT_SETTINGS, ...data.settings };
  useLLMEl.checked = !!settings.useLLM;
  endpointEl.value = settings.llmEndpoint || '';
  apiKeyEl.value = settings.llmApiKey || '';
  useMLEl.checked = !!settings.useMLClassifier;
  syncLLMFieldsVisibility();

  mlStatus.textContent = useMLEl.checked ? ML_ENABLED_NOTE : '';

  useLLMEl.addEventListener('change', syncLLMFieldsVisibility);
  useMLEl.addEventListener('change', () => {
    mlStatus.textContent = useMLEl.checked ? ML_ENABLED_NOTE : '';
  });

  saveBtn.addEventListener('click', async () => {
    await set({
      settings: {
        useLLM: useLLMEl.checked,
        llmEndpoint: endpointEl.value.trim(),
        llmApiKey: apiKeyEl.value.trim(),
        useMLClassifier: useMLEl.checked,
      },
    });
    saveStatus.textContent = 'Saved.';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 2000);
  });

  exportBtn.addEventListener('click', async () => {
    const { reel_records: records = [] } = await getAll({ reel_records: [] });
    if (!records.length) {
      alert('No data to export');
      return;
    }
    const header = ['src', 'watchedMs', 'ts', 'mood', 'moodScore', 'moodTerms', 'contextSample'];
    const rows = records.map((r) => [
      r.src ?? '',
      r.watchedMs ?? '',
      r.ts ?? '',
      r.mood ?? 'undetectable',
      r.moodScore ?? '',
      (r.moodTerms || []).join(' '),
      r.contextSample ?? '',
    ]);
    downloadCSV(toCSV(header, rows), 'doomscroll_data.csv');
  });

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all stored reel data?')) return;
    await clearAll();
  });
});
