// Keyword/emoji tables for the heuristic (v1) classifier.

export const MOOD_DEFS = {
  happy: {
    words: ['happy', 'joy', 'smile', 'celebrate', 'cute', 'adorable', 'delight', 'glad', 'cheerful', 'positive'],
    emojis: ['😊', '😁', '😃', '😄', '😇', '🌞', '🥰', '✨', '🌈', '🙂'],
  },
  calm: {
    words: ['relax', 'calm', 'chill', 'soothing', 'lofi', 'aesthetic', 'nature', 'rain', 'meditation', 'breathe', 'ocean', 'forest', 'peace', 'serene'],
    emojis: ['😌', '🌿', '🌊', '🌧️', '🧘', '🕊️', '🌅', '🌙', '☁️', '🍵', '🪷'],
  },
  sad: {
    words: ['sad', 'cry', 'tears', 'heartbroken', 'lonely', 'alone', 'breakup', 'depress', 'pain', 'miss you', 'grief', 'lost', 'down'],
    emojis: ['😭', '😢', '💔', '😞', '😔', '☹️', '😩', '😿', '🌧️', '🖤'],
  },
  angry: {
    words: ['angry', 'rage', 'drama', 'fight', 'exposed', 'rant', 'argument', 'furious', 'hate', 'triggered', 'annoyed', 'mad'],
    emojis: ['🤬', '😡', '😠', '👿', '💢', '🔥', '😤', '🚫'],
  },
  funny: {
    words: ['funny', 'comedy', 'meme', 'prank', 'joke', 'troll', 'lol', 'lmao', 'rofl', 'humor', 'hilarious', 'haha', 'skit', 'bit'],
    emojis: ['😂', '🤣', '😹', '😆', '😅', '🙃', '🤡', '😜', '😝'],
  },
  romantic: {
    words: ['love', 'romance', 'couple', 'date', 'kiss', 'crush', 'valentine', 'romantic', 'relationship'],
    emojis: ['😘', '❤️', '💖', '💕', '😍', '💘', '💞', '💓', '💋', '🌹', '🥰'],
  },
  motivational: {
    words: ['motivation', 'inspire', 'discipline', 'mindset', 'productivity', 'you can do it', 'hustle', 'grind', 'success', 'focus', 'goal', 'never give up'],
    emojis: ['💪', '🔥', '🚀', '🏆', '🙌', '🌟', '📈', '✨'],
  },
  fitness: {
    words: ['gym', 'workout', 'fitness', 'abs', 'cardio', 'pushup', 'deadlift', 'squat', 'transformation', 'calories', 'training', 'exercise'],
    emojis: ['🏋️‍♂️', '🏋️‍♀️', '💪', '🤸', '🏃', '🚴', '🥗', '🥦', '🥚'],
  },
  educational: {
    words: ['tutorial', 'how to', 'guide', 'learn', 'tips', 'hack', 'study', 'coding', 'programming', 'python', 'math', 'engineering', 'facts', 'explained', 'lesson'],
    emojis: ['📚', '🧠', '🔬', '📝', '💡', '💻', '📖', '✏️', '🧮', '🖥️'],
  },
  music: {
    words: ['song', 'lyrics', 'track', 'music', 'cover', 'guitar', 'piano', 'beat', 'sing', 'remix'],
    emojis: ['🎵', '🎶', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕'],
  },
  food: {
    words: ['recipe', 'cook', 'kitchen', 'food', 'eat', 'delicious', 'tasty', 'restaurant', 'yummy', 'snack', 'dish', 'meal'],
    emojis: ['🍔', '🍟', '🍕', '🥗', '🍲', '🍩', '🍪', '🍎', '🥑', '🍜', '🥘', '🍣'],
  },
  gaming: {
    words: ['game', 'gaming', 'gamer', 'pubg', 'fortnite', 'valorant', 'gta', 'minecraft', 'ranked', 'esports', 'play', 'controller'],
    emojis: ['🎮', '🕹️', '💻', '⌨️', '🖱️', '🏆', '🔥'],
  },
};

export const MOOD_ORDER = Object.keys(MOOD_DEFS);

export const WORD_WEIGHT = 1.4;
export const EMOJI_WEIGHT = 1.0;

// UI chrome/noise to strip out of scraped caption text before scoring.
export const UI_NOISE = [
  'like', 'comment', 'share', 'save', 'follow', 'following', 'reels', 'audio',
  'view all comments', 'send message', 'suggested', 'more options', 'report',
];
