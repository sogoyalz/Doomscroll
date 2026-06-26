// Settings page: toggle LLM/on-device classification, manage stored data.
//
// Also doubles as the host for the on-device ML classifier: transformers.js
// needs a DOM context to load its WASM model, which an MV3 service worker
// can't reliably provide, so this page loads the model and answers
// classification requests relayed from the background worker while open.

import { getAll, set, clearAll } from '../lib/storage.js';
import { toCSV, downloadCSV } from '../lib/csv.js';
import { MESSAGE_TYPES } from '../lib/types.js';
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

async function setUpMLClassifier(mlStatus: HTMLElement) {
  const { classify, preload } = await import('../classification/transformersClassifier.js');

  mlStatus.textContent = 'Loading on-device model… (first time only, a few MB download)';
  try {
    await preload();
  } catch (err) {
    mlStatus.textContent = 'Failed to load on-device model — falling back to other classifiers.';
    console.error('transformersClassifier preload failed', err);
    return;
  }
  mlStatus.textContent = 'On-device model ready.';

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== MESSAGE_TYPES.ML_CLASSIFY_REQUEST) return false;
    classify(msg.text || '')
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });

  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ML_CLASSIFIER_READY }).catch(() => {});
}

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

  if (useMLEl.checked) setUpMLClassifier(mlStatus);

  useLLMEl.addEventListener('change', syncLLMFieldsVisibility);
  useMLEl.addEventListener('change', () => {
    if (useMLEl.checked) setUpMLClassifier(mlStatus);
    else mlStatus.textContent = '';
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
