// Popup entry ("the face" — quick glance dashboard): reads storage, renders stats.

import { getAll } from '../lib/storage.js';
import { buildDashboard, type Dashboard, type TimeRange } from '../lib/stats.js';
import { MESSAGE_TYPES } from '../lib/types.js';
import type { Mood, MoodBucket, ReelRecord } from '../lib/types.js';

const MOOD_LABELS: Record<Mood, string> = {
  happy: 'Happy',
  calm: 'Calm',
  sad: 'Sad',
  angry: 'Angry',
  funny: 'Comedy',
  romantic: 'Romantic',
  motivational: 'Motivational',
  fitness: 'Fitness',
  educational: 'Tech',
  music: 'Music',
  food: 'Food',
  gaming: 'Gaming',
  undetectable: 'Undetectable',
};

const TYPE_COLORS: Record<Mood, string> = {
  happy: '#f2b94e',
  calm: '#3dd6a5',
  sad: '#6e9eff',
  angry: '#ff5b5b',
  funny: '#ff7a45',
  romantic: '#ff6e9c',
  motivational: '#f2b94e',
  fitness: '#3dd6a5',
  educational: '#4e9eff',
  music: '#b07aa1',
  food: '#e0a13a',
  gaming: '#9c9c9c',
  undetectable: '#6b6b6b',
};

const BUCKET_LABELS: Record<MoodBucket, string> = {
  hype: 'Hype',
  chill: 'Chill',
  emotional: 'Emotional',
  neutral: 'Neutral',
};

const RANGE_LABELS: Record<TimeRange, string> = {
  today: "Today you've doomscrolled",
  week: "This week you've doomscrolled",
  all: "Overall you've doomscrolled",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatShort(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.round(totalSeconds / 60)}m`;
}

function renderTypeBars(container: HTMLElement, byType: Dashboard['byType']) {
  const maxCount = Math.max(1, ...byType.map((t) => t.count));
  container.innerHTML = byType
    .map(({ mood, count }) => {
      const pct = Math.round((count / maxCount) * 100);
      const color = TYPE_COLORS[mood] || '#6b6b6b';
      return `
        <li>
          <span class="bar-label">${MOOD_LABELS[mood] || mood}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
          <span class="bar-count">${count}</span>
        </li>`;
    })
    .join('');
}

function renderMoodPills(container: HTMLElement, moodBuckets: Dashboard['moodBuckets']) {
  container.innerHTML = moodBuckets
    .map(
      ({ bucket, pct }) => `
        <span class="pill pill-${bucket}">${BUCKET_LABELS[bucket]} · <span class="pct">${pct}%</span></span>`,
    )
    .join('');
}

function renderRecent(container: HTMLElement, records: ReelRecord[]) {
  if (!records.length) {
    container.innerHTML = '<li class="recent-empty">No reels tracked yet.</li>';
    return;
  }
  container.innerHTML = records
    .map((r) => {
      const color = TYPE_COLORS[r.mood] || '#6b6b6b';
      const title = r.caption || r.contextSample || 'Untitled reel';
      const seconds = Math.round(r.watchedMs / 1000);
      return `
        <li>
          <span class="recent-thumb" style="color:${color}"></span>
          <span class="recent-info">
            <div class="recent-title">${title}</div>
            <div class="recent-meta">${seconds}s</div>
          </span>
          <span class="recent-badge" style="background:${color}22;color:${color}">${MOOD_LABELS[r.mood] || r.mood}</span>
        </li>`;
    })
    .join('');
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el as T;
}

document.addEventListener('DOMContentLoaded', () => {
  const headlineLabel = getEl('headlineLabel');
  const headlineValue = getEl('headlineValue');
  const totalReelsEl = getEl('totalReels');
  const longestBingeEl = getEl('longestBinge');
  const avgPerReelEl = getEl('avgPerReel');
  const typeBarsEl = getEl('typeBars');
  const moodPillsEl = getEl('moodPills');
  const recentListEl = getEl('recentList');
  const exportBtn = getEl('export');
  const rangeTabs = getEl('rangeTabs');

  let currentRange: TimeRange = 'today';

  function render(dashboard: Dashboard) {
    headlineLabel.textContent = RANGE_LABELS[dashboard.range];
    headlineValue.textContent = formatDuration(dashboard.totalWatchedMs);
    totalReelsEl.textContent = String(dashboard.totalReels);
    longestBingeEl.textContent = dashboard.longestBingeMs
      ? formatShort(dashboard.longestBingeMs)
      : '0m';
    avgPerReelEl.textContent = dashboard.avgWatchMs ? formatShort(dashboard.avgWatchMs) : '0s';

    renderTypeBars(typeBarsEl, dashboard.byType);
    renderMoodPills(moodPillsEl, dashboard.moodBuckets);
    renderRecent(recentListEl, dashboard.recent);
  }

  async function refresh() {
    const data = await getAll({ reel_records: [] });
    const dashboard = buildDashboard(data.reel_records || [], currentRange);
    render(dashboard);
  }

  rangeTabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.range-tab');
    if (!btn) return;
    currentRange = btn.dataset.range as TimeRange;
    rangeTabs.querySelectorAll('.range-tab').forEach((t) => {
      t.setAttribute('aria-selected', String(t === btn));
    });
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.reel_records || changes.reelCount)) refresh();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MESSAGE_TYPES.REEL_WATCHED) refresh();
  });

  exportBtn.addEventListener('click', async () => {
    const data = await getAll({ reel_records: [] });
    const records = data.reel_records || [];
    if (!records.length) {
      alert('No data to export');
      return;
    }
    const escapeCSV = (v: unknown) => '"' + (v ?? '').toString().replace(/"/g, '""') + '"';
    const header = [
      'src',
      'watchedMs',
      'ts',
      'mood',
      'moodScore',
      'moodTerms',
      'caption',
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
        escapeCSV(r.caption ?? ''),
        escapeCSV(r.contextSample ?? ''),
      ].join(','),
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'doomscroll_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  refresh();
});
