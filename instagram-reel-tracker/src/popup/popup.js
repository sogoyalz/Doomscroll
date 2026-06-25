// Popup entry ("the face" — quick glance dashboard): reads storage, renders stats.
// Pure Canvas pie (no Chart.js).

import { getAll, clearAll } from '../lib/storage.js';
import { MOOD_KEYS, buildSummary } from '../lib/stats.js';

let pieCtx;
const pieSize = 260; // css pixels

const MOOD_LABELS = ['Happy', 'Calm', 'Sad', 'Angry', 'Funny', 'Romantic', 'Motivational', 'Fitness', 'Educational', 'Music', 'Food', 'Gaming', 'Undetectable'];

const COLORS = [
  '#4e79a7', // Happy
  '#f28e2b', // Calm
  '#e15759', // Sad
  '#76b7b2', // Angry
  '#00bcd4', // Funny
  '#b07aa1', // Romantic
  '#59a14f', // Motivational
  '#edc949', // Fitness
  '#af7aa1', // Educational
  '#ff9da7', // Music
  '#9c755f', // Food
  '#bab0ab', // Gaming
  '#8a8d91', // Undetectable
];
const SLICE_BORDER = '#ffffff';
const SLICE_BORDER_WIDTH = 2;

const msToSec = (ms) => (ms / 1000).toFixed(1) + 's';
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function setupHiDPICanvas(canvas, cssSize) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = cssSize * ratio;
  canvas.height = cssSize * ratio;
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function clearCanvas(ctx, size) {
  ctx.clearRect(0, 0, size, size);
}

function drawEmptyPie(ctx, size) {
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f5f5';
  ctx.fill();
  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#777';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('No data', cx, cy);
}

function drawPie(ctx, values, colors, size) {
  clearCanvas(ctx, size);
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) {
    drawEmptyPie(ctx, size);
    return;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  let start = -Math.PI / 2;

  values.forEach((v, i) => {
    if (v <= 0) return;
    const angle = (v / total) * Math.PI * 2;
    const end = start + angle;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.lineWidth = SLICE_BORDER_WIDTH;
    ctx.strokeStyle = SLICE_BORDER;
    ctx.stroke();

    start = end;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,.08)';
  ctx.stroke();
}

function renderLegend(legendEl, counts, total) {
  const rows = MOOD_KEYS.map((k, idx) => {
    const n = counts[k] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const color = COLORS[idx % COLORS.length];
    return `<li><span class="dot" style="background:${color}"></span>${MOOD_LABELS[idx]} — <strong>${n}</strong> (${pct}%)</li>`;
  });
  legendEl.innerHTML = rows.join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const totalEl = document.getElementById('total');
  const last1mEl = document.getElementById('last1m');
  const last1hEl = document.getElementById('last1h');
  const last24El = document.getElementById('last24');
  const avgEl = document.getElementById('avg');
  const topMoodEl = document.getElementById('topMood');

  const refreshBtn = document.getElementById('refresh');
  const exportBtn = document.getElementById('export');
  const clearBtn = document.getElementById('clear');

  const canvas = document.getElementById('moodChart');
  const legendEl = document.getElementById('moodLegend');

  pieCtx = setupHiDPICanvas(canvas, pieSize);

  function updateUIFromRecords(rawRecords) {
    const summary = buildSummary(rawRecords);

    totalEl.textContent = summary.total;
    last1mEl.textContent = summary.last1m;
    last1hEl.textContent = summary.last1h;
    last24El.textContent = summary.last24h;
    avgEl.textContent = summary.meanWatchMs ? msToSec(summary.meanWatchMs) : '—';
    avgEl.title = `Mean: ${summary.meanWatchMs ? msToSec(summary.meanWatchMs) : '—'}\nMedian: ${summary.medianWatchMs ? msToSec(summary.medianWatchMs) : '—'}`;
    topMoodEl.textContent = summary.total ? `Top mood: ${titleCase(summary.topMood)} (${summary.topMoodPct}%)` : '';

    const data = MOOD_KEYS.map((m) => summary.moodCounts[m] || 0);
    drawPie(pieCtx, data, COLORS, pieSize);
    renderLegend(legendEl, summary.moodCounts, summary.total);
  }

  async function refresh() {
    const data = await getAll({ reel_records: [] });
    updateUIFromRecords(data.reel_records || []);
  }

  refreshBtn.addEventListener('click', refresh);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.reel_records || changes.reelCount)) refresh();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'REEL_WATCHED') refresh();
  });

  exportBtn.addEventListener('click', async () => {
    const data = await getAll({ reel_records: [] });
    const records = data.reel_records || [];
    if (!records.length) {
      alert('No data to export');
      return;
    }
    const escapeCSV = (v) => '"' + (v ?? '').toString().replace(/"/g, '""') + '"';
    const header = ['src', 'watchedMs', 'ts', 'mood', 'moodScore', 'moodTerms', 'contextSample'].join(',');
    const lines = records.map((r) => [
      escapeCSV(r.src), r.watchedMs ?? '', r.ts ?? '',
      escapeCSV(r.mood ?? 'undetectable'), r.moodScore ?? '',
      escapeCSV((r.moodTerms || []).join(' ')), escapeCSV(r.contextSample ?? ''),
    ].join(','));
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
    refresh();
  });

  refresh();
});
