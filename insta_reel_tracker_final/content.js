// content.js
(() => {
    console.log('InstaReel Tracker content script starting');
  
    const VISIBILITY_THRESHOLD = 0.65;
    const MIN_WATCH_MS = 1000; // 1s minimum to count as viewed
    const videoState = new WeakMap();
    const now = () => Date.now();
  
    // ---------- Mood classification (words + extended emojis, word/emoji-aware scoring) ----------
    const MOOD_DEFS = {
      happy: {
        words: ['happy','joy','smile','celebrate','cute','adorable','delight','glad','cheerful','positive'],
        emojis: ['😊','😁','😃','😄','😇','🌞','🥰','✨','🌈','🙂']
      },
      calm: {
        words: ['relax','calm','chill','soothing','lofi','aesthetic','nature','rain','meditation','breathe','ocean','forest','peace','serene'],
        emojis: ['😌','🌿','🌊','🌧️','🧘','🕊️','🌅','🌙','☁️','🍵','🪷']
      },
      sad: {
        words: ['sad','cry','tears','heartbroken','lonely','alone','breakup','depress','pain','miss you','grief','lost','down'],
        emojis: ['😭','😢','💔','😞','😔','☹️','😩','😿','🌧️','🖤']
      },
      angry: {
        words: ['angry','rage','drama','fight','exposed','rant','argument','furious','hate','triggered','annoyed','mad'],
        emojis: ['🤬','😡','😠','👿','💢','🔥','😤','🚫']
      },
  
      // NEW: Funny as its own mood
      funny: {
        words: ['funny','comedy','meme','prank','joke','troll','lol','lmao','rofl','humor','hilarious','haha','skit','bit'],
        emojis: ['😂','🤣','😹','😆','😅','🙃','🤡','😜','😝']
      },
  
      romantic: {
        words: ['love','romance','couple','date','kiss','crush','valentine','romantic','relationship'],
        emojis: ['😘','❤️','💖','💕','😍','💘','💞','💓','💋','🌹','🥰']
      },
      motivational: {
        words: ['motivation','inspire','discipline','mindset','productivity','you can do it','hustle','grind','success','focus','goal','never give up'],
        emojis: ['💪','🔥','🚀','🏆','🙌','🌟','📈','✨']
      },
      fitness: {
        words: ['gym','workout','fitness','abs','cardio','pushup','deadlift','squat','transformation','calories','training','exercise'],
        emojis: ['🏋️‍♂️','🏋️‍♀️','💪','🤸','🏃','🚴','🥗','🥦','🥚']
      },
      educational: {
        words: ['tutorial','how to','guide','learn','tips','hack','study','coding','programming','python','math','engineering','facts','explained','lesson'],
        emojis: ['📚','🧠','🔬','📝','💡','💻','📖','✏️','🧮','🖥️']
      },
      music: {
        words: ['song','lyrics','track','music','cover','guitar','piano','beat','sing','remix'],
        emojis: ['🎵','🎶','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕']
      },
      food: {
        words: ['recipe','cook','kitchen','food','eat','delicious','tasty','restaurant','yummy','snack','dish','meal'],
        emojis: ['🍔','🍟','🍕','🥗','🍲','🍩','🍪','🍎','🥑','🍜','🥘','🍣']
      },
      gaming: {
        words: ['game','gaming','gamer','pubg','fortnite','valorant','gta','minecraft','ranked','esports','play','controller'],
        emojis: ['🎮','🕹️','💻','⌨️','🖱️','🏆','🔥'] // guard below requires 2+ if no word hits
      }
    };
    const MOOD_ORDER = Object.keys(MOOD_DEFS);
  
    // scoring weights
    const WORD_W = 1.4;   // words slightly stronger than emojis
    const EMOJI_W = 1.0;
  
    // UI noise to filter from extracted text
    const UI_NOISE = [
      'like','comment','share','save','follow','following','reels','audio',
      'view all comments','send message','suggested','more options','report'
    ];
  
    function escRE(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  
    function buildMatchers() {
      const m = {};
      for (const mood of MOOD_ORDER) {
        const def = MOOD_DEFS[mood];
        const wordMatchers = (def.words || []).map(w => {
          const re = new RegExp(`\\b${escRE(w)}\\b`, 'gi');
          return { type: 'word', re, raw: w, w: WORD_W };
        });
        const emojiMatchers = (def.emojis || []).map(e => {
          const re = new RegExp(escRE(e), 'g');
          return { type: 'emoji', re, raw: e, w: EMOJI_W };
        });
        m[mood] = [...wordMatchers, ...emojiMatchers];
      }
      return m;
    }
    const MOOD_MATCHERS = buildMatchers();
  
    const normalizeText = t => (t || '').toLowerCase().replace(/\s+/g,' ').trim();
  
    // Keep only likely caption text, exclude buttons/controls and typical UI labels
    function extractContextText(video){
      try {
        const article = video.closest('article, div[role="dialog"], div[role="presentation"]') || video.parentElement || document.body;
  
        const candidates = [];
        const selectors = [
          'h1','h2','h3','figcaption',
          'span:not([role])','div:not([role])',
          'a[href]:not([role="button"])'
        ];
        for (const sel of selectors) {
          const list = article.querySelectorAll(sel);
          for (let i=0; i<list.length && candidates.length < 60; i++) {
            const el = list[i];
            if (el.closest('nav,[role="button"],button,[aria-hidden="true"]')) continue;
            const txt = (el.innerText || '').trim();
            if (!txt) continue;
            candidates.push(txt);
          }
          if (candidates.length >= 60) break;
        }
  
        let text = candidates.join(' ');
        text += ' ' + (video.getAttribute('aria-label') || '');
        text = text.replace(/#[\w]+/g, s => s.slice(1));
  
        let parts = text.split(/\s*[|•·\n\r]+\s*| {2,}/g).filter(Boolean);
        parts = parts.filter(p => {
          const s = normalizeText(p);
          if (s.length < 2) return false;
          if (UI_NOISE.some(x => s.includes(x))) return false;
          return true;
        });
        return normalizeText(parts.join(' ')).slice(0, 800);
      } catch { return ''; }
    }
  
    // return detailed scores so we can apply category-specific guards/ties
    function classifyMood(text){
      if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };
  
      const scores = {};
      const wordHits = {};
      const emojiHits = {};
      const matched = {};
  
      for (const mood of MOOD_ORDER) {
        let score = 0, wHits = 0, eHits = 0;
        matched[mood] = [];
        for (const {type, re, w, raw} of MOOD_MATCHERS[mood]) {
          const matches = text.match(re);
          if (matches && matches.length) {
            if (type === 'word') wHits += matches.length;
            else eHits += matches.length;
            score += w * matches.length;
            matched[mood].push(raw);
          }
        }
        // category-specific guard: avoid single-emoji gaming false positives
        if (mood === 'gaming' && wHits === 0 && eHits < 2) {
          score = 0; matched[mood] = [];
        }
        // funny vs happy: if only emojis and both tie, prefer funny (😂/🤣 strongly imply humor)
        if ((mood === 'happy' || mood === 'funny') && wHits === 0) {
          // small bonus for 'funny' to win emoji-only ties
          if (mood === 'funny') score += 0.1;
        }
  
        scores[mood] = score;
        wordHits[mood] = wHits;
        emojiHits[mood] = eHits;
      }
  
      // choose best with better tie-breaking:
      // 1) higher score, 2) more word hits, 3) more total hits
      let bestMood = 'undetectable';
      let best = { score: 0, w: 0, total: 0 };
      for (const mood of MOOD_ORDER) {
        const s = scores[mood];
        const w = wordHits[mood];
        const t = wordHits[mood] + emojiHits[mood];
        const better =
          (s > best.score) ||
          (s === best.score && w > best.w) ||
          (s === best.score && w === best.w && t > best.total);
        if (better) {
          bestMood = mood;
          best = { score: s, w, total: t };
        }
      }
  
      if (best.score <= 0) return { mood: 'undetectable', score: 0, matched: {}, wordHits, emojiHits };
      return { mood: bestMood, score: best.score, matched, wordHits, emojiHits };
    }
    // ---------------------------------------------------------------
  
    function isLikelyReel(video){
      try {
        if (!video) return false;
        if (location.pathname && location.pathname.startsWith('/reels')) return true;
        const src = (video.currentSrc || video.src || '').toLowerCase();
        if (src.includes('/reel') || src.includes('/reels') || src.includes('/video/')) return true;
        if (video.closest('a[href*="/reel/"], a[href*="/reels/"], a[href*="/sound/"], a[href*="/audio/"]')) return true;
        if (video.closest('article, div[role="dialog"], div[role="presentation"]')) return true;
      } catch {}
      return false;
    }
  
    function saveRecordAtomically(record, cb){
      chrome.storage.local.get({ reel_records: [], reelCount: 0 }, data => {
        const arr = data.reel_records || [];
        arr.push(record);
        const newCount = (typeof data.reelCount === 'number') ? data.reelCount + 1 : 1;
        chrome.storage.local.set({ reel_records: arr, reelCount: newCount }, () => {
          try { cb && cb(null, { reelCount: newCount, record }); } catch {}
        });
      });
    }
  
    function handleEntry(entry){
      const video = entry.target;
      if (!video) return;
      let state = videoState.get(video);
      if (!state){
        state = { watching: false, start: null, recorded: false };
        videoState.set(video, state);
      }
      const isVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;
  
      if (isVisible && !state.watching){
        state.watching = true;
        state.start = now();
      } else if (!isVisible && state.watching){
        const watchedMs = now() - (state.start || now());
        state.watching = false;
        state.start = null;
  
        if (watchedMs >= MIN_WATCH_MS && !state.recorded && isLikelyReel(video)){
          state.recorded = true;
  
          const contextText = extractContextText(video);
          const { mood, score, matched } = classifyMood(contextText);
  
          // ---- CLAMP: avoid absurd durations (e.g., tab stuck visible) ----
          const CLAMP_MAX = 10 * 60 * 1000; // 10 minutes
          const safeWatched = Math.max(0, Math.min(watchedMs, CLAMP_MAX));
  
          const record = {
            src: video.currentSrc || video.src || '',
            watchedMs: safeWatched,
            ts: now(),
            mood,
            moodScore: score,
            moodTerms: matched[mood] || [],
            contextSample: contextText.slice(0, 200)
          };
  
          saveRecordAtomically(record, (err, meta) => {
            if (err) console.warn('saveRecord error', err);
            try { chrome.runtime.sendMessage({ type: 'reel-viewed', reelCount: meta.reelCount, record: meta.record }); } catch {}
          });
        }
      }
      videoState.set(video, state);
    }
  
    const observer = new IntersectionObserver((entries) => entries.forEach(handleEntry), { threshold: [VISIBILITY_THRESHOLD] });
  
    function observeVideo(video){
      try {
        if (!videoState.has(video)){
          videoState.set(video, { watching:false, start:null, recorded:false });
          observer.observe(video);
        }
      } catch {}
    }
  
    function scanAndObserve(){ document.querySelectorAll('video').forEach(observeVideo); }
  
    const mo = new MutationObserver(scanAndObserve);
    scanAndObserve();
    mo.observe(document.body, { childList: true, subtree: true });
  
    // Heartbeat: rescan every 2s (SPA safety net)
    setInterval(() => { try { scanAndObserve(); } catch {} }, 2000);
  
    window.addEventListener('beforeunload', () => { try { observer.disconnect(); mo.disconnect(); } catch {} });
  
    window.__InstaReelTracker = { scanAndObserve, _videoState: videoState };
  })();