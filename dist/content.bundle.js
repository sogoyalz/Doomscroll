(() => {
  // src/content/reelDetector.js
  var VISIBILITY_THRESHOLD = 0.65;
  var MIN_WATCH_MS = 1e3;
  var CLAMP_MAX_MS = 10 * 60 * 1e3;
  function createReelDetector(onWatched, onVisible) {
    const videoState = /* @__PURE__ */ new WeakMap();
    const now = () => Date.now();
    function handleEntry(entry) {
      const video = entry.target;
      if (!video) return;
      let state = videoState.get(video);
      if (!state) {
        state = { watching: false, start: null, recorded: false };
        videoState.set(video, state);
      }
      const isVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;
      if (isVisible && !state.watching) {
        state.watching = true;
        state.start = now();
        if (onVisible) onVisible(video);
      } else if (!isVisible && state.watching) {
        const watchedMs = now() - (state.start ?? now());
        state.watching = false;
        state.start = null;
        if (watchedMs >= MIN_WATCH_MS && !state.recorded) {
          state.recorded = true;
          const safeWatched = Math.max(0, Math.min(watchedMs, CLAMP_MAX_MS));
          onWatched(video, safeWatched);
        }
      }
      videoState.set(video, state);
    }
    const observer = new IntersectionObserver((entries) => entries.forEach(handleEntry), {
      threshold: [VISIBILITY_THRESHOLD]
    });
    function observeVideo(video) {
      try {
        if (!videoState.has(video)) {
          videoState.set(video, { watching: false, start: null, recorded: false });
          observer.observe(video);
        }
      } catch {
      }
    }
    function scanAndObserve(root = document) {
      root.querySelectorAll("video").forEach(observeVideo);
    }
    function disconnect() {
      observer.disconnect();
    }
    return { scanAndObserve, disconnect, _videoState: videoState };
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
  var UI_NOISE = [
    "like",
    "comment",
    "share",
    "save",
    "follow",
    "following",
    "reels",
    "audio",
    "view all comments",
    "send message",
    "suggested",
    "more options",
    "report"
  ];
  var MOOD_BUCKETS = {
    hype: ["funny", "motivational", "fitness", "gaming"],
    chill: ["calm", "music", "food", "educational"],
    emotional: ["happy", "sad", "angry", "romantic"],
    neutral: ["undetectable"]
  };
  var MOOD_TO_BUCKET = Object.fromEntries(
    Object.entries(MOOD_BUCKETS).flatMap(([bucket, moods]) => moods.map((m) => [m, bucket]))
  );

  // src/content/domScraper.js
  var normalizeText = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
  function extractContextText(video) {
    try {
      const article = video.closest('article, div[role="dialog"], div[role="presentation"]') || video.parentElement || document.body;
      const candidates = [];
      const selectors = [
        "h1",
        "h2",
        "h3",
        "figcaption",
        "span:not([role])",
        "div:not([role])",
        'a[href]:not([role="button"])'
      ];
      for (const sel of selectors) {
        const list = article.querySelectorAll(sel);
        for (let i = 0; i < list.length && candidates.length < 60; i++) {
          const el = list[i];
          if (el.closest('nav,[role="button"],button,[aria-hidden="true"]')) continue;
          const txt = (el.innerText || "").trim();
          if (!txt) continue;
          candidates.push(txt);
        }
        if (candidates.length >= 60) break;
      }
      let text = candidates.join(" ");
      text += " " + (video.getAttribute("aria-label") || "");
      text = text.replace(/#[\w]+/g, (s) => s.slice(1));
      let parts = text.split(/\s*[|•·\n\r]+\s*| {2,}/g).filter(Boolean);
      parts = parts.filter((p) => {
        const s = normalizeText(p);
        if (s.length < 2) return false;
        if (UI_NOISE.some((x) => s.includes(x))) return false;
        return true;
      });
      return normalizeText(parts.join(" ")).slice(0, 800);
    } catch {
      return "";
    }
  }
  function extractCaption(contextText, maxLen = 80) {
    const text = (contextText || "").trim();
    if (!text) return "";
    if (text.length <= maxLen) return text;
    const truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "\u2026";
  }
  function isLikelyReel(video) {
    try {
      if (!video) return false;
      if (location.pathname && location.pathname.startsWith("/reels")) return true;
      const src = (video.currentSrc || video.src || "").toLowerCase();
      if (src.includes("/reel") || src.includes("/reels") || src.includes("/video/")) return true;
      if (video.closest('a[href*="/reel/"], a[href*="/reels/"], a[href*="/sound/"], a[href*="/audio/"]'))
        return true;
      if (video.closest('article, div[role="dialog"], div[role="presentation"]')) return true;
    } catch {
    }
    return false;
  }

  // src/lib/messages.js
  var MESSAGE_TYPES = {
    REEL_WATCHED: "REEL_WATCHED"
  };

  // src/content/content.js
  (() => {
    console.log("InstaReel Tracker content script starting");
    const contextTextByVideo = /* @__PURE__ */ new WeakMap();
    function handleVisible(video) {
      if (!isLikelyReel(video)) return;
      contextTextByVideo.set(video, extractContextText(video));
    }
    function handleWatched(video, watchedMs) {
      if (!isLikelyReel(video)) return;
      const contextText = contextTextByVideo.get(video) ?? extractContextText(video);
      const record = {
        src: video.currentSrc || video.src || "",
        watchedMs,
        ts: Date.now(),
        contextText,
        contextSample: contextText.slice(0, 200),
        caption: extractCaption(contextText)
      };
      try {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.REEL_WATCHED, record });
      } catch {
      }
    }
    const detector = createReelDetector(handleWatched, handleVisible);
    detector.scanAndObserve();
    const mo = new MutationObserver(() => detector.scanAndObserve());
    mo.observe(document.body, { childList: true, subtree: true });
    const heartbeat = setInterval(() => detector.scanAndObserve(), 2e3);
    window.addEventListener("beforeunload", () => {
      detector.disconnect();
      mo.disconnect();
      clearInterval(heartbeat);
    });
    window.__InstaReelTracker = detector;
  })();
})();
//# sourceMappingURL=content.bundle.js.map
