// Settings page: toggle LLM classification on/off, manage stored data.

import { getAll, set, clearAll } from '../lib/storage.js';

const DEFAULT_SETTINGS = { useLLM: false, llmEndpoint: '', llmApiKey: '' };

document.addEventListener('DOMContentLoaded', async () => {
  const useLLMEl = document.getElementById('useLLM');
  const llmFields = document.getElementById('llmFields');
  const endpointEl = document.getElementById('llmEndpoint');
  const apiKeyEl = document.getElementById('llmApiKey');
  const saveBtn = document.getElementById('save');
  const saveStatus = document.getElementById('saveStatus');
  const exportBtn = document.getElementById('export');
  const clearBtn = document.getElementById('clear');

  function syncLLMFieldsVisibility() {
    llmFields.hidden = !useLLMEl.checked;
  }

  const data = await getAll({ settings: DEFAULT_SETTINGS });
  const settings = { ...DEFAULT_SETTINGS, ...data.settings };
  useLLMEl.checked = !!settings.useLLM;
  endpointEl.value = settings.llmEndpoint || '';
  apiKeyEl.value = settings.llmApiKey || '';
  syncLLMFieldsVisibility();

  useLLMEl.addEventListener('change', syncLLMFieldsVisibility);

  saveBtn.addEventListener('click', async () => {
    await set({
      settings: {
        useLLM: useLLMEl.checked,
        llmEndpoint: endpointEl.value.trim(),
        llmApiKey: apiKeyEl.value.trim(),
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
    const escapeCSV = (v) => '"' + (v ?? '').toString().replace(/"/g, '""') + '"';
    const header = [
      'src',
      'watchedMs',
      'ts',
      'mood',
      'moodScore',
      'moodTerms',
      'contextSample',
    ].join(',');
    const lines = records.map((r) =>
      [
        escapeCSV(r.src),
        r.watchedMs ?? '',
        r.ts ?? '',
        escapeCSV(r.mood ?? 'undetectable'),
        r.moodScore ?? '',
        escapeCSV((r.moodTerms || []).join(' ')),
        escapeCSV(r.contextSample ?? ''),
      ].join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'insta_reel_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Clear all stored reel data?')) return;
    await clearAll();
  });
});
