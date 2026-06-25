// popup.js — pure Canvas pie (no Chart.js)
let pieCtx, pieSize = 260; // css pixels

document.addEventListener('DOMContentLoaded', () => {
  const totalEl  = document.getElementById('total');
  const last1mEl = document.getElementById('last1m');
  const last1hEl = document.getElementById('last1h');
  const last24El = document.getElementById('last24');
  const avgEl    = document.getElementById('avg');
  const topMoodEl= document.getElementById('topMood');

  const refreshBtn = document.getElementById('refresh');
  const exportBtn  = document.getElementById('export');
  const clearBtn   = document.getElementById('clear');

  const canvas   = document.getElementById('moodChart');
  const legendEl = document.getElementById('moodLegend');

  // Buckets (incl. Funny + Undetectable)
  const MOOD_KEYS   = ['happy','calm','sad','angry','funny','romantic','motivational','fitness','educational','music','food','gaming','undetectable'];
  const MOOD_LABELS = ['Happy','Calm','Sad','Angry','Funny','Romantic','Motivational','Fitness','Educational','Music','Food','Gaming','Undetectable'];

  // Distinct palette (added a bright cyan for Funny)
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
    '#8a8d91'  // Undetectable
  ];
  const SLICE_BORDER = '#ffffff';
  const SLICE_BORDER_WIDTH = 2;

  /* -------- UTILITIES -------- */
  const msToSec = (ms) => (ms/1000).toFixed(1) + 's';
  const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  function sanitizeRecords(records){
    return (records || []).map(r => ({
      ...r,
      watchedMs: Number(r.watchedMs) || 0,
      ts: Number(r.ts ?? r.time) || 0,
      mood: r.mood || 'undetectable'
    }));
  }
  function filterSane(records){
    const MIN = 1_000, MAX = 10 * 60_000; // 1s..10min
    return records.filter(r => r.watchedMs >= MIN && r.watchedMs <= MAX);
  }
  const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const median = arr => {
    if (!arr.length) return 0;
    const s=[...arr].sort((a,b)=>a-b);
    const m=Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
  };

  /* -------- Canvas helpers (hi-DPI safe) -------- */
  function setupHiDPICanvas(canvas, cssSize){
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = cssSize * ratio;
    canvas.height = cssSize * ratio;
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  function clearCanvas(ctx, size){ ctx.clearRect(0, 0, size, size); }

  function drawEmptyPie(ctx, size){
    const r = (size/2) - 6;
    const cx = size/2, cy = size/2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = '#f5f5f5'; ctx.fill();
    ctx.strokeStyle = '#e5e5e5'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#777';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No data', cx, cy);
  }

  function drawPie(ctx, values, colors, size){
    clearCanvas(ctx, size);
    const total = values.reduce((a,b)=>a+b,0);
    if (!total){ drawEmptyPie(ctx, size); return; }

    const cx = size/2, cy = size/2;
    const r  = (size/2) - 6;
    let start = -Math.PI/2; // start at top

    values.forEach((v, i) => {
      if (v <= 0) return;
      const angle = (v/total) * Math.PI*2;
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

    // outer rim
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.stroke();
  }

  function renderLegend(counts, total){
    const rows = MOOD_KEYS.map((k, idx) => {
      const n = counts[k] || 0;
      const pct = total ? Math.round((n/total)*100) : 0;
      const color = COLORS[idx % COLORS.length];
      return `<li><span class="dot" style="background:${color}"></span>${MOOD_LABELS[idx]} — <strong>${n}</strong> (${pct}%)</li>`;
    });
    legendEl.innerHTML = rows.join('');
  }

  /* -------- Data → UI pipeline -------- */
  function updateUIFromRecords(raw){
    const recs = sanitizeRecords(raw);
    const now = Date.now();
    const minMs = 60 * 1000, hourMs = 60 * 60 * 1000, dayMs = 24 * 60 * 60 * 1000;

    const total = recs.length;
    const last1m = recs.filter(r => now - r.ts <= minMs).length;
    const last1h = recs.filter(r => now - r.ts <= hourMs).length;
    const last24 = recs.filter(r => now - r.ts <= dayMs).length;

    totalEl.textContent = total;
    last1mEl.textContent = last1m;
    last1hEl.textContent = last1h;
    last24El.textContent = last24;

    const saneAll = filterSane(recs);
    const meanAll = mean(saneAll.map(r => r.watchedMs));
    const medianAll = median(saneAll.map(r => r.watchedMs));
    avgEl.textContent = meanAll ? msToSec(meanAll) : '—';
    avgEl.title = `Mean: ${meanAll ? msToSec(meanAll) : '—'}\nMedian: ${medianAll ? msToSec(medianAll) : '—'}`;

    // Mood counts
    const counts = Object.fromEntries(MOOD_KEYS.map(m => [m, 0]));
    for (const r of recs) counts[r.mood] = (counts[r.mood] ?? 0) + 1;
    const data = MOOD_KEYS.map(m => counts[m] || 0);

    // Top mood
    const { mood: topMood, n: topN } = Object.entries(counts)
      .reduce((best, [m,n]) => (n > best.n ? {mood:m,n} : best), {mood:'undetectable', n:0});
    topMoodEl.textContent = total ? `Top mood: ${titleCase(topMood)} (${Math.round((topN/total)*100)}%)` : '';

    // Draw pie + legend
    drawPie(pieCtx, data, COLORS, pieSize);
    renderLegend(counts, total);
  }

  function refresh(){
    chrome.storage.local.get({ reel_records: [] }, data => updateUIFromRecords(data.reel_records || []));
  }

  // setup canvas context (hi-DPI)
  pieCtx = setupHiDPICanvas(canvas, pieSize);

  // Buttons + LIVE updates
  refreshBtn.addEventListener('click', refresh);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.reel_records || changes.reelCount)) refresh();
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'reel-viewed') refresh(); });

  // CSV export
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get({ reel_records: [] }, data => {
      const records = data.reel_records || [];
      if (!records.length) { alert('No data to export'); return; }
      const escapeCSV = v => '"' + (v ?? '').toString().replace(/"/g, '""') + '"';
      const header = ['src','watchedMs','ts','mood','moodScore','moodTerms','contextSample'].join(',');
      const lines = records.map(r => [
        escapeCSV(r.src), r.watchedMs ?? '', r.ts ?? '',
        escapeCSV(r.mood ?? 'undetectable'), r.moodScore ?? '',
        escapeCSV((r.moodTerms || []).join(' ')), escapeCSV(r.contextSample ?? '')
      ].join(','));
      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'insta_reel_data.csv'; a.click();
      URL.revokeObjectURL(url);
    });
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all stored reel data?')) return;
    chrome.storage.local.set({ reel_records: [], reelCount: 0 }, () => refresh());
  });

  refresh(); // initial
});