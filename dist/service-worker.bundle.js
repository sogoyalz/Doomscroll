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
  function set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }
  async function initDefaults() {
    const data = await getAll(["reelCount", "reel_records", "settings"]);
    const patch = {};
    if (data.reelCount === void 0) patch.reelCount = DEFAULTS.reelCount;
    if (!Array.isArray(data.reel_records)) patch.reel_records = DEFAULTS.reel_records;
    if (!data.settings) patch.settings = DEFAULTS.settings;
    if (Object.keys(patch).length) await set(patch);
  }
  async function appendRecord(record) {
    const data = await getAll({ reel_records: [], reelCount: 0 });
    const records = data.reel_records || [];
    records.push(record);
    const reelCount = (typeof data.reelCount === "number" ? data.reelCount : 0) + 1;
    await set({ reel_records: records, reelCount });
    return { reelCount, record };
  }

  // src/lib/messages.js
  var MESSAGE_TYPES = {
    REEL_WATCHED: "REEL_WATCHED"
  };

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
  var WORD_WEIGHT = 1.4;
  var EMOJI_WEIGHT = 1;
  var MOOD_BUCKETS = {
    hype: ["funny", "motivational", "fitness", "gaming"],
    chill: ["calm", "music", "food", "educational"],
    emotional: ["happy", "sad", "angry", "romantic"],
    neutral: ["undetectable"]
  };
  var MOOD_TO_BUCKET = Object.fromEntries(
    Object.entries(MOOD_BUCKETS).flatMap(([bucket, moods]) => moods.map((m) => [m, bucket]))
  );

  // src/classification/classifier.js
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function buildMatchers() {
    const matchers = {};
    for (const mood of MOOD_ORDER) {
      const def = MOOD_DEFS[mood];
      const wordMatchers = (def.words || []).map((w) => ({
        type: "word",
        re: new RegExp(`\\b${escapeRegExp(w)}\\b`, "gi"),
        raw: w,
        weight: WORD_WEIGHT
      }));
      const emojiMatchers = (def.emojis || []).map((e) => ({
        type: "emoji",
        re: new RegExp(escapeRegExp(e), "g"),
        raw: e,
        weight: EMOJI_WEIGHT
      }));
      matchers[mood] = [...wordMatchers, ...emojiMatchers];
    }
    return matchers;
  }
  var MOOD_MATCHERS = buildMatchers();
  function classify(text) {
    if (!text) return { mood: "undetectable", score: 0, matched: {}, wordHits: {}, emojiHits: {} };
    const scores = {};
    const wordHits = {};
    const emojiHits = {};
    const matched = {};
    for (const mood of MOOD_ORDER) {
      let score = 0;
      let wHits = 0;
      let eHits = 0;
      matched[mood] = [];
      for (const { type, re, weight, raw } of MOOD_MATCHERS[mood]) {
        const matches = text.match(re);
        if (matches && matches.length) {
          if (type === "word") wHits += matches.length;
          else eHits += matches.length;
          score += weight * matches.length;
          matched[mood].push(raw);
        }
      }
      if (mood === "gaming" && wHits === 0 && eHits < 2) {
        score = 0;
        matched[mood] = [];
      }
      if (mood === "funny" && wHits === 0 && eHits > 0) {
        score += 0.1;
      }
      scores[mood] = score;
      wordHits[mood] = wHits;
      emojiHits[mood] = eHits;
    }
    let bestMood = "undetectable";
    let best = { score: 0, w: 0, total: 0 };
    for (const mood of MOOD_ORDER) {
      const s = scores[mood];
      const w = wordHits[mood];
      const total = wordHits[mood] + emojiHits[mood];
      const better = s > best.score || s === best.score && w > best.w || s === best.score && w === best.w && total > best.total;
      if (better) {
        bestMood = mood;
        best = { score: s, w, total };
      }
    }
    if (best.score <= 0) return { mood: "undetectable", score: 0, matched: {}, wordHits, emojiHits };
    return { mood: bestMood, score: best.score, matched, wordHits, emojiHits };
  }

  // src/classification/llmClassifier.js
  var DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
  var MODEL = "claude-haiku-4-5";
  async function classify2(text, { apiKey, endpoint = DEFAULT_ENDPOINT } = {}) {
    if (!text) return { mood: "undetectable", score: 0, matched: {}, wordHits: {}, emojiHits: {} };
    if (!apiKey) {
      throw new Error("llmClassifier.classify requires an Anthropic API key");
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required for calling the Messages API directly from a browser-extension
        // context (the API blocks browser-origin requests as a CSRF guard by default).
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 20,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { mood: { type: "string", enum: MOOD_ORDER } },
              required: ["mood"],
              additionalProperties: false
            }
          }
        },
        messages: [
          {
            role: "user",
            content: `Classify the dominant mood of this Instagram Reel caption/context text. Caption: ${text.slice(0, 800)}`
          }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`llmClassifier request failed: ${response.status}`);
    }
    const data = await response.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) {
      throw new Error("llmClassifier received no text block in response");
    }
    const { mood } = JSON.parse(textBlock.text);
    return { mood, score: 1, matched: {}, wordHits: {}, emojiHits: {} };
  }

  // src/background/messageHandlers.js
  async function classifyText(text) {
    const { settings } = await getAll({ settings: { useLLM: false } });
    if (settings?.useLLM && settings?.llmApiKey) {
      try {
        return await classify2(text, {
          apiKey: settings.llmApiKey,
          endpoint: settings.llmEndpoint
        });
      } catch (err) {
        console.warn("LLM classification failed, falling back to heuristic classifier", err);
      }
    }
    return classify(text);
  }
  var handlers = {
    async [MESSAGE_TYPES.REEL_WATCHED](message) {
      const { contextText, ...rest } = message.record;
      const { mood, score, matched } = await classifyText(contextText);
      const record = {
        ...rest,
        mood,
        moodScore: score,
        moodTerms: matched[mood] || []
      };
      const { reelCount, record: savedRecord } = await appendRecord(record);
      return { reelCount, record: savedRecord };
    }
  };
  function handleMessage(message, _sender, sendResponse) {
    const handler = handlers[message?.type];
    if (!handler) return false;
    handler(message).then((result) => sendResponse({ ok: true, ...result })).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // src/background/service-worker.js
  chrome.runtime.onInstalled.addListener((details) => {
    console.log("InstaReel Tracker installed \u2014 reason:", details.reason);
    initDefaults();
  });
  chrome.runtime.onMessage.addListener(handleMessage);
})();
//# sourceMappingURL=service-worker.bundle.js.map
