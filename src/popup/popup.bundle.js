(() => {
  // src/lib/storage.js
  var DEFAULTS = {
    reelCount: 0,
    reel_records: [],
    settings: { useLLM: false }
  };
  function getAll(keys = DEFAULTS) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (data) => resolve(data));
    });
  }

  // src/classification/rules.js
  var MOOD_DEFS = {
    happy: {
      words: [
        "happy",
        "joy",
        "smile",
        "celebrate",
        "cute",
        "adorable",
        "delight",
        "glad",
        "cheerful",
        "positive"
      ],
      emojis: ["\u{1F60A}", "\u{1F601}", "\u{1F603}", "\u{1F604}", "\u{1F607}", "\u{1F31E}", "\u{1F970}", "\u2728", "\u{1F308}", "\u{1F642}"]
    },
    calm: {
      words: [
        "relax",
        "calm",
        "chill",
        "soothing",
        "lofi",
        "aesthetic",
        "nature",
        "rain",
        "meditation",
        "breathe",
        "ocean",
        "forest",
        "peace",
        "serene"
      ],
      emojis: ["\u{1F60C}", "\u{1F33F}", "\u{1F30A}", "\u{1F327}\uFE0F", "\u{1F9D8}", "\u{1F54A}\uFE0F", "\u{1F305}", "\u{1F319}", "\u2601\uFE0F", "\u{1F375}", "\u{1FAB7}"]
    },
    sad: {
      words: [
        "sad",
        "cry",
        "tears",
        "heartbroken",
        "lonely",
        "alone",
        "breakup",
        "depress",
        "pain",
        "miss you",
        "grief",
        "lost",
        "down"
      ],
      emojis: ["\u{1F62D}", "\u{1F622}", "\u{1F494}", "\u{1F61E}", "\u{1F614}", "\u2639\uFE0F", "\u{1F629}", "\u{1F63F}", "\u{1F327}\uFE0F", "\u{1F5A4}"]
    },
    angry: {
      words: [
        "angry",
        "rage",
        "drama",
        "fight",
        "exposed",
        "rant",
        "argument",
        "furious",
        "hate",
        "triggered",
        "annoyed",
        "mad"
      ],
      emojis: ["\u{1F92C}", "\u{1F621}", "\u{1F620}", "\u{1F47F}", "\u{1F4A2}", "\u{1F525}", "\u{1F624}", "\u{1F6AB}"]
    },
    funny: {
      words: [
        "funny",
        "comedy",
        "meme",
        "prank",
        "joke",
        "troll",
        "lol",
        "lmao",
        "rofl",
        "humor",
        "hilarious",
        "haha",
        "skit",
        "bit"
      ],
      emojis: ["\u{1F602}", "\u{1F923}", "\u{1F639}", "\u{1F606}", "\u{1F605}", "\u{1F643}", "\u{1F921}", "\u{1F61C}", "\u{1F61D}"]
    },
    romantic: {
      words: [
        "love",
        "romance",
        "couple",
        "date",
        "kiss",
        "crush",
        "valentine",
        "romantic",
        "relationship"
      ],
      emojis: ["\u{1F618}", "\u2764\uFE0F", "\u{1F496}", "\u{1F495}", "\u{1F60D}", "\u{1F498}", "\u{1F49E}", "\u{1F493}", "\u{1F48B}", "\u{1F339}", "\u{1F970}"]
    },
    motivational: {
      words: [
        "motivation",
        "inspire",
        "discipline",
        "mindset",
        "productivity",
        "you can do it",
        "hustle",
        "grind",
        "success",
        "focus",
        "goal",
        "never give up"
      ],
      emojis: ["\u{1F4AA}", "\u{1F525}", "\u{1F680}", "\u{1F3C6}", "\u{1F64C}", "\u{1F31F}", "\u{1F4C8}", "\u2728"]
    },
    fitness: {
      words: [
        "gym",
        "workout",
        "fitness",
        "abs",
        "cardio",
        "pushup",
        "deadlift",
        "squat",
        "transformation",
        "calories",
        "training",
        "exercise"
      ],
      emojis: ["\u{1F3CB}\uFE0F\u200D\u2642\uFE0F", "\u{1F3CB}\uFE0F\u200D\u2640\uFE0F", "\u{1F4AA}", "\u{1F938}", "\u{1F3C3}", "\u{1F6B4}", "\u{1F957}", "\u{1F966}", "\u{1F95A}"]
    },
    educational: {
      words: [
        "tutorial",
        "how to",
        "guide",
        "learn",
        "tips",
        "hack",
        "study",
        "coding",
        "programming",
        "python",
        "math",
        "engineering",
        "facts",
        "explained",
        "lesson"
      ],
      emojis: ["\u{1F4DA}", "\u{1F9E0}", "\u{1F52C}", "\u{1F4DD}", "\u{1F4A1}", "\u{1F4BB}", "\u{1F4D6}", "\u270F\uFE0F", "\u{1F9EE}", "\u{1F5A5}\uFE0F"]
    },
    music: {
      words: [
        "song",
        "lyrics",
        "track",
        "music",
        "cover",
        "guitar",
        "piano",
        "beat",
        "sing",
        "remix"
      ],
      emojis: ["\u{1F3B5}", "\u{1F3B6}", "\u{1F3A4}", "\u{1F3A7}", "\u{1F3BC}", "\u{1F3B9}", "\u{1F941}", "\u{1F3B7}", "\u{1F3BA}", "\u{1F3B8}", "\u{1FA95}"]
    },
    food: {
      words: [
        "recipe",
        "cook",
        "kitchen",
        "food",
        "eat",
        "delicious",
        "tasty",
        "restaurant",
        "yummy",
        "snack",
        "dish",
        "meal"
      ],
      emojis: ["\u{1F354}", "\u{1F35F}", "\u{1F355}", "\u{1F957}", "\u{1F372}", "\u{1F369}", "\u{1F36A}", "\u{1F34E}", "\u{1F951}", "\u{1F35C}", "\u{1F958}", "\u{1F363}"]
    },
    gaming: {
      words: [
        "game",
        "gaming",
        "gamer",
        "pubg",
        "fortnite",
        "valorant",
        "gta",
        "minecraft",
        "ranked",
        "esports",
        "play",
        "controller"
      ],
      emojis: ["\u{1F3AE}", "\u{1F579}\uFE0F", "\u{1F4BB}", "\u2328\uFE0F", "\u{1F5B1}\uFE0F", "\u{1F3C6}", "\u{1F525}"]
    }
  };
  var MOOD_ORDER = Object.keys(MOOD_DEFS);
  var MOOD_BUCKETS = {
    hype: ["funny", "motivational", "fitness", "gaming"],
    chill: ["calm", "music", "food", "educational"],
    emotional: ["happy", "sad", "angry", "romantic"],
    neutral: ["undetectable"]
  };
  var MOOD_BUCKET_ORDER = ["hype", "chill", "emotional", "neutral"];
  var MOOD_TO_BUCKET = Object.fromEntries(
    Object.entries(MOOD_BUCKETS).flatMap(([bucket, moods]) => moods.map((m) => [m, bucket]))
  );
  function bucketForMood(mood) {
    return MOOD_TO_BUCKET[mood] || "neutral";
  }

  // src/lib/stats.js
  var MOOD_KEYS = [
    "happy",
    "calm",
    "sad",
    "angry",
    "funny",
    "romantic",
    "motivational",
    "fitness",
    "educational",
    "music",
    "food",
    "gaming",
    "undetectable"
  ];
  var MIN_SANE_MS = 1e3;
  var MAX_SANE_MS = 10 * 6e4;
  var BINGE_GAP_MS = 2 * 60 * 1e3;
  function sanitizeRecords(records) {
    return (records || []).map((r) => ({
      ...r,
      watchedMs: Number(r.watchedMs) || 0,
      ts: Number(r.ts ?? r.time) || 0,
      mood: r.mood || "undetectable",
      caption: r.caption || ""
    }));
  }
  function filterSane(records) {
    return records.filter((r) => r.watchedMs >= MIN_SANE_MS && r.watchedMs <= MAX_SANE_MS);
  }
  function filterByRange(records, range, now = Date.now()) {
    if (range === "all") return records;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (range === "today") {
      return records.filter((r) => r.ts >= start.getTime());
    }
    if (range === "week") {
      const weekStart = start.getTime() - 6 * 24 * 60 * 60 * 1e3;
      return records.filter((r) => r.ts >= weekStart);
    }
    return records;
  }
  function mean(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function countByMood(records) {
    const counts = Object.fromEntries(MOOD_KEYS.map((m) => [m, 0]));
    for (const r of records) counts[r.mood] = (counts[r.mood] ?? 0) + 1;
    return counts;
  }
  function topCategories(counts, limit = 4) {
    return Object.entries(counts).filter(([mood]) => mood !== "undetectable").sort((a, b) => b[1] - a[1]).slice(0, limit).map(([mood, count]) => ({ mood, count }));
  }
  function countByMoodBucket(records) {
    const counts = Object.fromEntries(MOOD_BUCKET_ORDER.map((b) => [b, 0]));
    for (const r of records) {
      const bucket = bucketForMood(r.mood);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
  }
  function moodBucketPercentages(records) {
    const counts = countByMoodBucket(records);
    const total = records.length;
    return MOOD_BUCKET_ORDER.map((bucket) => ({
      bucket,
      count: counts[bucket],
      pct: total ? Math.round(counts[bucket] / total * 100) : 0
    }));
  }
  function longestBinge(records) {
    if (!records.length) return 0;
    const sorted = [...records].sort((a, b) => a.ts - b.ts);
    let longest = 0;
    let runStart = sorted[0].ts - sorted[0].watchedMs;
    let runEnd = sorted[0].ts;
    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i];
      const reelStart = r.ts - r.watchedMs;
      if (reelStart - runEnd <= BINGE_GAP_MS) {
        runEnd = r.ts;
      } else {
        longest = Math.max(longest, runEnd - runStart);
        runStart = reelStart;
        runEnd = r.ts;
      }
    }
    longest = Math.max(longest, runEnd - runStart);
    return longest;
  }
  function recentRecords(records, limit = 3) {
    return [...records].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
  function buildDashboard(rawRecords, range = "all", now = Date.now()) {
    const all = sanitizeRecords(rawRecords);
    const records = filterByRange(all, range, now);
    const sane = filterSane(records);
    const watchTimes = sane.map((r) => r.watchedMs);
    const counts = countByMood(records);
    const totalWatchedMs = sane.reduce((sum, r) => sum + r.watchedMs, 0);
    return {
      range,
      totalReels: records.length,
      totalWatchedMs,
      longestBingeMs: longestBinge(sane),
      avgWatchMs: mean(watchTimes),
      medianWatchMs: median(watchTimes),
      byType: topCategories(counts),
      moodBuckets: moodBucketPercentages(records),
      recent: recentRecords(records)
    };
  }

  // src/lib/messages.js
  var MESSAGE_TYPES = {
    REEL_WATCHED: "REEL_WATCHED"
  };

  // src/popup/popup.js
  var MOOD_LABELS = {
    happy: "Happy",
    calm: "Calm",
    sad: "Sad",
    angry: "Angry",
    funny: "Comedy",
    romantic: "Romantic",
    motivational: "Motivational",
    fitness: "Fitness",
    educational: "Tech",
    music: "Music",
    food: "Food",
    gaming: "Gaming",
    undetectable: "Undetectable"
  };
  var TYPE_COLORS = {
    happy: "#f2b94e",
    calm: "#3dd6a5",
    sad: "#6e9eff",
    angry: "#ff5b5b",
    funny: "#ff7a45",
    romantic: "#ff6e9c",
    motivational: "#f2b94e",
    fitness: "#3dd6a5",
    educational: "#4e9eff",
    music: "#b07aa1",
    food: "#e0a13a",
    gaming: "#9c9c9c",
    undetectable: "#6b6b6b"
  };
  var BUCKET_LABELS = { hype: "Hype", chill: "Chill", emotional: "Emotional", neutral: "Neutral" };
  var RANGE_LABELS = {
    today: "Today you've doomscrolled",
    week: "This week you've doomscrolled",
    all: "Overall you've doomscrolled"
  };
  function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1e3);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor(totalSeconds % 3600 / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }
  function formatShort(ms) {
    const totalSeconds = Math.round(ms / 1e3);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    return `${Math.round(totalSeconds / 60)}m`;
  }
  function renderTypeBars(container, byType) {
    const maxCount = Math.max(1, ...byType.map((t) => t.count));
    container.innerHTML = byType.map(({ mood, count }) => {
      const pct = Math.round(count / maxCount * 100);
      const color = TYPE_COLORS[mood] || "#6b6b6b";
      return `
        <li>
          <span class="bar-label">${MOOD_LABELS[mood] || mood}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
          <span class="bar-count">${count}</span>
        </li>`;
    }).join("");
  }
  function renderMoodPills(container, moodBuckets) {
    container.innerHTML = moodBuckets.map(
      ({ bucket, pct }) => `
        <span class="pill pill-${bucket}">${BUCKET_LABELS[bucket]} \xB7 <span class="pct">${pct}%</span></span>`
    ).join("");
  }
  function renderRecent(container, records) {
    if (!records.length) {
      container.innerHTML = '<li class="recent-empty">No reels tracked yet.</li>';
      return;
    }
    container.innerHTML = records.map((r) => {
      const color = TYPE_COLORS[r.mood] || "#6b6b6b";
      const title = r.caption || r.contextSample || "Untitled reel";
      const seconds = Math.round(r.watchedMs / 1e3);
      return `
        <li>
          <span class="recent-thumb" style="color:${color}"></span>
          <span class="recent-info">
            <div class="recent-title">${title}</div>
            <div class="recent-meta">${seconds}s</div>
          </span>
          <span class="recent-badge" style="background:${color}22;color:${color}">${MOOD_LABELS[r.mood] || r.mood}</span>
        </li>`;
    }).join("");
  }
  document.addEventListener("DOMContentLoaded", () => {
    const headlineLabel = document.getElementById("headlineLabel");
    const headlineValue = document.getElementById("headlineValue");
    const totalReelsEl = document.getElementById("totalReels");
    const longestBingeEl = document.getElementById("longestBinge");
    const avgPerReelEl = document.getElementById("avgPerReel");
    const typeBarsEl = document.getElementById("typeBars");
    const moodPillsEl = document.getElementById("moodPills");
    const recentListEl = document.getElementById("recentList");
    const exportBtn = document.getElementById("export");
    const rangeTabs = document.getElementById("rangeTabs");
    let currentRange = "today";
    function render(dashboard) {
      headlineLabel.textContent = RANGE_LABELS[dashboard.range];
      headlineValue.textContent = formatDuration(dashboard.totalWatchedMs);
      totalReelsEl.textContent = dashboard.totalReels;
      longestBingeEl.textContent = dashboard.longestBingeMs ? formatShort(dashboard.longestBingeMs) : "0m";
      avgPerReelEl.textContent = dashboard.avgWatchMs ? formatShort(dashboard.avgWatchMs) : "0s";
      renderTypeBars(typeBarsEl, dashboard.byType);
      renderMoodPills(moodPillsEl, dashboard.moodBuckets);
      renderRecent(recentListEl, dashboard.recent);
    }
    async function refresh() {
      const data = await getAll({ reel_records: [] });
      const dashboard = buildDashboard(data.reel_records || [], currentRange);
      render(dashboard);
    }
    rangeTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".range-tab");
      if (!btn) return;
      currentRange = btn.dataset.range;
      rangeTabs.querySelectorAll(".range-tab").forEach((t) => {
        t.setAttribute("aria-selected", String(t === btn));
      });
      refresh();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.reel_records || changes.reelCount)) refresh();
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === MESSAGE_TYPES.REEL_WATCHED) refresh();
    });
    exportBtn.addEventListener("click", async () => {
      const data = await getAll({ reel_records: [] });
      const records = data.reel_records || [];
      if (!records.length) {
        alert("No data to export");
        return;
      }
      const escapeCSV = (v) => '"' + (v ?? "").toString().replace(/"/g, '""') + '"';
      const header = [
        "src",
        "watchedMs",
        "ts",
        "mood",
        "moodScore",
        "moodTerms",
        "caption",
        "contextSample"
      ].join(",");
      const lines = records.map(
        (r) => [
          escapeCSV(r.src),
          r.watchedMs ?? "",
          r.ts ?? "",
          escapeCSV(r.mood ?? "undetectable"),
          r.moodScore ?? "",
          escapeCSV((r.moodTerms || []).join(" ")),
          escapeCSV(r.caption ?? ""),
          escapeCSV(r.contextSample ?? "")
        ].join(",")
      );
      const csv = [header, ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "insta_reel_data.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
    refresh();
  });
})();
//# sourceMappingURL=popup.bundle.js.map
