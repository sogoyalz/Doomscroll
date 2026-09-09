// Term tables for the rules classifier.
//
// Two tiers (see taxonomy.ts):
//   - CHARGED categories are emotional registers and drive detection.
//   - TOPIC categories name the rest of the feed so ordinary content
//     (comedy, food, cricket, music, dance…) does not fall into `neutral`.
//
// `neutral` has no table: it is the answer when there was text and nothing in
// either tier matched. `unclassified` (no text at all) is separate again.
//
// Tuning is expected and cheap: edit a table, bump LEXICON_VERSION, reload —
// reclassifyIfLexiconChanged() re-labels all stored history and rebuilds
// aggregates. Judge every edit with `node scripts/eval.mjs eval labeled.csv`,
// not by whether the popup looks nicer.
//
// Terms are lowercase. `words` match whole tokens only (so "ex" can't fire
// inside "example"); `phrases` match on word boundaries. Devanagari and other
// non-Latin words are supported — the tokenizer keeps combining marks.

import { CHARGED_CATEGORIES, TOPIC_CATEGORIES, type Category } from './taxonomy.js';

/**
 * Bump on any edit below to re-label stored history on next load.
 *
 * Also bump it when the classifier's *scoring* changes, not only these tables:
 * stored labels are just as stale either way, and this is the only mechanism
 * that re-derives them. v4 is a scoring change — the general vocabulary now
 * applies to hashtags, so terms that previously scored nothing when written
 * with a '#' are readable in history too.
 */
export const LEXICON_VERSION = 4;

export type ClassifiableCategory = Exclude<Category, 'neutral'>;

export interface CategoryLexicon {
  /** Single tokens, matched whole-word. */
  words: string[];
  /** Multi-word sequences, matched on word boundaries. */
  phrases: string[];
  /** Matched against the reel's hashtags, without the leading '#'. */
  hashtags: string[];
  emoji: string[];
}

// ── charged tier ─────────────────────────────────────────────────────────
// Emotional registers. Hinglish/Devanagari terms are included because the
// feed's captions and audio titles are frequently Hindi; audio counts at half
// weight, so a song title alone will not over-trigger these.

const CHARGED: Record<(typeof CHARGED_CATEGORIES)[number], CategoryLexicon> = {
  joyful: {
    words: [
      'happy', 'happiness', 'joy', 'joyful', 'smile', 'smiling', 'cheerful',
      'grateful', 'gratitude', 'blessed', 'excited', 'delighted', 'wholesome',
      'cute', 'adorable', 'celebration', 'celebrating', 'khushi', 'khush',
    ],
    phrases: ['good vibes', 'best day', 'made my day', 'so happy', 'happy tears'],
    hashtags: [
      'happy', 'joy', 'wholesome', 'cute', 'goodvibes', 'smile', 'feelgood',
      'grateful', 'blessed', 'positivevibes',
    ],
    emoji: ['😊', '😄', '😁', '🥳', '🎉', '🥰', '☺️'],
  },

  sad: {
    words: [
      'sad', 'sadness', 'crying', 'cry', 'tears', 'depressed', 'depression',
      'lonely', 'loneliness', 'grief', 'grieving', 'mourning', 'numb',
      'hopeless', 'despair', 'sorrow', 'miserable', 'unhappy',
      // Natural-language sadness that carries no obvious keyword — the biggest
      // charged-recall gap found on a real feed.
      'empty', 'emptiness', 'hurt', 'hurts', 'hurting', 'aching', 'broken',
      'drained', 'worthless', 'heartache', 'lost', 'alone', 'pain', 'painful',
      // Hinglish
      'udaas', 'tanha', 'tanhai', 'akela', 'akeli', 'dard', 'gham', 'dukh',
      'dukhi', 'aansu', 'rona', 'suna',
      // Devanagari
      'उदास', 'तनहा', 'अकेला', 'दर्द', 'ग़म', 'गम', 'दुख', 'आँसू', 'रोना',
    ],
    phrases: [
      'i miss', 'miss you', 'feeling low', 'not okay', 'falling apart',
      'so alone', 'nobody cares', 'want to disappear', 'dil dukhta',
      'why does it hurt', 'always hurt', 'so empty', 'feel nothing',
      'suna suna',
    ],
    hashtags: [
      'sad', 'sadvibes', 'depression', 'depressed', 'lonely', 'crying',
      'sadedit', 'sadsongs', 'grief', 'emptiness', 'sadstatus', 'sadshayari',
    ],
    emoji: ['😢', '😭', '🥺', '😞', '😔', '🖤'],
  },

  // The loop most worth catching, kept distinct from `sad` so it is not
  // hidden inside a broader bucket.
  breakup: {
    words: [
      'breakup', 'heartbreak', 'heartbroken', 'ex', 'exes', 'cheated',
      'cheating', 'betrayal', 'betrayed', 'closure', 'situationship',
      'unrequited', 'dumped', 'divorce',
      // Hinglish
      'dhoka', 'dhokha', 'bewafa', 'bewafai', 'judai', 'juda', 'breakup',
      // Devanagari
      'धोखा', 'बेवफ़ा', 'बेवफा', 'जुदाई', 'जुदा',
    ],
    phrases: [
      'break up', 'broke up', 'broken heart', 'moving on', 'move on',
      'he left me', 'she left me', 'they left me', 'left me', 'get over you',
      'get over him', 'get over her', 'toxic relationship', 'we are over',
      'should have stayed', 'still not over', 'toota dil', 'breakup shayari',
    ],
    hashtags: [
      'breakup', 'heartbreak', 'heartbroken', 'ex', 'movingon',
      'situationship', 'situationships', 'toxicrelationship', 'brokenheart',
      'breakupsongs', 'dhoka', 'bewafa', 'breakupshayari',
    ],
    emoji: ['💔', '🥀'],
  },

  anxious: {
    words: [
      'anxiety', 'anxious', 'panic', 'overthinking', 'overthink', 'stressed',
      'stress', 'worried', 'worry', 'insomnia', 'spiraling', 'overwhelmed',
      'dread', 'nervous', 'burnout', 'restless',
      // Hinglish
      'chinta', 'ghabrahat', 'pareshan', 'tension',
      'चिंता', 'घबराहट', 'परेशान',
    ],
    phrases: [
      'cant sleep', "can't sleep", 'panic attack', 'racing thoughts',
      'on edge', 'freaking out', 'what if',
    ],
    hashtags: [
      'anxiety', 'anxious', 'panicattack', 'overthinking', 'stressed',
      'burnout', 'mentalhealth', 'insomnia',
    ],
    emoji: ['😰', '😨', '😬', '😥'],
  },

  angry: {
    words: [
      'angry', 'anger', 'rage', 'furious', 'mad', 'outraged', 'outrageous',
      'disgusting', 'unacceptable', 'rant', 'injustice', 'infuriating',
      'livid', 'hate',
      // Hinglish
      'gussa', 'gusse', 'naraz', 'नाराज़', 'गुस्सा',
    ],
    phrases: [
      'fed up', 'sick of', 'had enough', 'so done with', 'this is why',
      'bahut hua', 'bas ab', 'ab bas',
    ],
    hashtags: ['angry', 'rage', 'rant', 'furious', 'outrage', 'fedup'],
    emoji: ['😡', '🤬', '😤'],
  },

  motivational: {
    words: [
      'motivation', 'motivated', 'motivational', 'discipline', 'disciplined',
      'grind', 'hustle', 'mindset', 'success', 'goals', 'consistency',
      'focus', 'ambition', 'transform', 'achieve', 'productivity',
      // Hinglish
      'mehnat', 'safalta', 'sangharsh', 'josh', 'himmat',
      'मेहनत', 'सफलता', 'संघर्ष', 'हिम्मत',
    ],
    phrases: [
      'never give up', 'keep going', 'self improvement', 'level up',
      'no excuses', 'show up', 'one percent better', 'get after it',
    ],
    hashtags: [
      'motivation', 'motivational', 'discipline', 'mindset', 'success',
      'selfimprovement', 'grindset', 'hustle', 'goals', 'growthmindset',
    ],
    emoji: ['💪', '🚀', '🎯'],
  },

  // Bare "love"/#love are deliberately absent — the most overloaded tokens on
  // the platform. The phrases carry the meaning without the false positives.
  romantic: {
    words: [
      'romance', 'romantic', 'boyfriend', 'girlfriend', 'husband', 'wife',
      'crush', 'soulmate', 'anniversary', 'valentine', 'adore',
      // Hinglish — the clear ones; broad song-words rely on half-weight audio
      'pyaar', 'pyar', 'mohabbat', 'ishq', 'sanam', 'dilbar',
      'प्यार', 'मोहब्बत', 'इश्क़', 'इश्क',
    ],
    phrases: [
      'date night', 'in love', 'love you', 'my love', 'my person',
      'couple goals', 'forever with', 'love story', 'meri jaan',
    ],
    hashtags: [
      'couple', 'couplegoals', 'relationship', 'romantic', 'boyfriend',
      'girlfriend', 'anniversary', 'lovestory', 'pyaar', 'mohabbat',
    ],
    emoji: ['❤️', '😍', '💕', '💖', '💑', '💏'],
  },
};

// ── topic tier ───────────────────────────────────────────────────────────
// Names the non-emotional majority of a feed. Broader is fine here: a topic
// false positive never triggers intervention, it only keeps a reel out of
// `neutral`. Several tables are mined from the pre-rewrite lexicon (commit
// 25009a6).

const TOPICS: Record<(typeof TOPIC_CATEGORIES)[number], CategoryLexicon> = {
  comedy: {
    words: [
      'comedy', 'meme', 'memes', 'prank', 'joke', 'jokes', 'troll', 'lol',
      'lmao', 'rofl', 'haha', 'skit', 'standup', 'satire', 'parody', 'funny',
      'hilarious', 'humor', 'humour', 'roast', 'relatable',
    ],
    phrases: ['try not to laugh', 'caught on camera', 'wait for it'],
    hashtags: [
      'comedy', 'meme', 'memes', 'funny', 'lol', 'standup', 'prank', 'jokes',
      'comedyreels', 'relatable', 'funnyvideos', 'trending',
    ],
    emoji: ['😂', '🤣', '😹', '🤡'],
  },

  music: {
    words: [
      'song', 'songs', 'lyrics', 'track', 'music', 'cover', 'guitar', 'piano',
      'beat', 'sing', 'singer', 'singing', 'remix', 'melody', 'rap', 'rapper',
      'album', 'concert', 'gaana', 'geet',
    ],
    phrases: ['new song', 'full song', 'official audio', 'live performance'],
    hashtags: [
      'music', 'song', 'singer', 'cover', 'guitar', 'rap', 'lyrics', 'remix',
      'newmusic', 'bollywoodmusic', 'singing', 'musician',
    ],
    emoji: ['🎵', '🎶', '🎤', '🎧', '🎼', '🎹', '🥁', '🎸'],
  },

  dance: {
    // No bare "step"/"steps"/"moves" — too generic ("next step", "career
    // moves"). Dance intent comes from the unambiguous words + phrases.
    words: [
      'dance', 'dancing', 'dancer', 'choreography', 'choreo', 'reelitfeelit',
      'nach', 'nachna', 'bhangra', 'garba',
    ],
    phrases: ['dance cover', 'dance challenge', 'learn this dance', 'dance moves'],
    hashtags: [
      'dance', 'dancer', 'choreography', 'dancereels', 'dancechallenge',
      'bhangra', 'garba', 'dancevideo', 'trendingdance',
    ],
    emoji: ['💃', '🕺', '👯'],
  },

  food: {
    words: [
      'recipe', 'cook', 'cooking', 'kitchen', 'food', 'foodie', 'eat', 'eating',
      'delicious', 'tasty', 'restaurant', 'yummy', 'snack', 'dish', 'meal',
      'khana', 'nashta', 'chai', 'paneer', 'biryani', 'masala',
    ],
    phrases: ['street food', 'easy recipe', 'food review', 'how to make'],
    hashtags: [
      'food', 'foodie', 'recipe', 'cooking', 'streetfood', 'foodreels',
      'foodlover', 'homecooking', 'indianfood', 'baking', 'dessert',
    ],
    emoji: ['🍔', '🍟', '🍕', '🍲', '🍩', '🍜', '🥘', '🍣', '🧁', '☕'],
  },

  fitness: {
    words: [
      'gym', 'workout', 'fitness', 'abs', 'cardio', 'pushup', 'deadlift',
      'squat', 'transformation', 'calories', 'training', 'exercise', 'reps',
      'muscle', 'protein', 'bodybuilding', 'yoga', 'gymrat',
    ],
    phrases: ['leg day', 'gym motivation', 'home workout', 'weight loss'],
    hashtags: [
      'gym', 'workout', 'fitness', 'gymmotivation', 'bodybuilding', 'fit',
      'yoga', 'fitnessreels', 'weightloss', 'gymrat',
    ],
    emoji: ['🏋️', '🤸', '🏃', '🚴', '🧘'],
  },

  sports: {
    words: [
      'cricket', 'football', 'soccer', 'goal', 'match', 'tournament', 'ipl',
      'worldcup', 'batting', 'bowling', 'wicket', 'sixer', 'kohli', 'messi',
      'ronaldo', 'nba', 'basketball', 'kabaddi', 'hockey', 'sports',
    ],
    phrases: ['last over', 'match highlights', 'man of the match'],
    hashtags: [
      'cricket', 'football', 'ipl', 'sports', 'worldcup', 'messi', 'ronaldo',
      'kohli', 'nba', 'sportsreels', 'highlights',
    ],
    emoji: ['⚽', '🏏', '🏀', '🏆', '⚾', '🥅'],
  },

  tech: {
    words: [
      'tech', 'coding', 'programming', 'python', 'javascript', 'developer',
      'software', 'ai', 'gadget', 'iphone', 'android', 'laptop', 'startup',
      'tutorial', 'guide', 'hack', 'productivity', 'engineering', 'explained',
    ],
    phrases: ['how to', 'tech review', 'coding tips', 'ai tools'],
    hashtags: [
      'tech', 'coding', 'programming', 'developer', 'ai', 'gadgets', 'startup',
      'techreels', 'python', 'techtips', 'technology',
    ],
    emoji: ['💻', '🧠', '🤖', '📱', '⌨️', '🖥️'],
  },

  fashion: {
    words: [
      'fashion', 'outfit', 'ootd', 'style', 'styling', 'grwm', 'makeup',
      'skincare', 'haul', 'lookbook', 'aesthetic', 'thrift', 'wardrobe',
      'saree', 'kurta', 'lehenga', 'jewellery', 'jewelry', 'runway', 'vogue',
      'couture', 'designer',
    ],
    phrases: ['get ready with me', 'outfit of the day', 'styling tips'],
    hashtags: [
      'fashion', 'ootd', 'style', 'grwm', 'makeup', 'skincare', 'fashionreels',
      'outfit', 'aesthetic', 'sareelove', 'fashionista', 'vogue', 'vogueworld',
      'runway',
    ],
    emoji: ['👗', '👠', '💄', '👛', '🕶️'],
  },

  travel: {
    words: [
      'travel', 'travelling', 'traveling', 'trip', 'vacation', 'wanderlust',
      'adventure', 'mountains', 'beach', 'hiking', 'trek', 'trekking', 'goa',
      'himalayas', 'manali', 'flight', 'roadtrip', 'explore', 'passport',
    ],
    phrases: ['travel diaries', 'places to visit', 'hidden gem', 'road trip'],
    hashtags: [
      'travel', 'wanderlust', 'travelreels', 'adventure', 'mountains',
      'beach', 'trekking', 'travelgram', 'roadtrip', 'explore',
    ],
    emoji: ['✈️', '🏔️', '🏖️', '🗺️', '🎒', '🏕️'],
  },

  gaming: {
    words: [
      'game', 'gaming', 'gamer', 'pubg', 'bgmi', 'fortnite', 'valorant', 'gta',
      'minecraft', 'ranked', 'esports', 'controller', 'gameplay', 'freefire',
      'clutch', 'noob', 'streamer',
    ],
    phrases: ['game play', 'best moments', 'ranked match'],
    hashtags: [
      'gaming', 'gamer', 'pubg', 'bgmi', 'valorant', 'freefire', 'esports',
      'gameplay', 'gamingreels', 'streamer',
    ],
    emoji: ['🎮', '🕹️'],
  },

  pets: {
    words: [
      'dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'pet', 'pets', 'doggo',
      'paws', 'meow', 'woof', 'rescue', 'adopt', 'kitty', 'pupper',
    ],
    phrases: ['adopt dont shop', 'pet parent', 'cutest dog'],
    hashtags: [
      'dog', 'cat', 'puppy', 'pets', 'petsofinstagram', 'dogsofinstagram',
      'catsofinstagram', 'petreels', 'doggo', 'kitten',
    ],
    emoji: ['🐶', '🐱', '🐾', '🐕', '🐈', '🐰'],
  },

  art: {
    words: [
      'art', 'artist', 'drawing', 'painting', 'sketch', 'sketching', 'doodle',
      'craft', 'diy', 'illustration', 'calligraphy', 'sculpture', 'artwork',
      'handmade', 'resin', 'pottery',
    ],
    phrases: ['art process', 'time lapse', 'satisfying art', 'diy craft'],
    hashtags: [
      'art', 'artist', 'drawing', 'painting', 'sketch', 'diy', 'craft',
      'artwork', 'artreels', 'handmade', 'illustration',
    ],
    emoji: ['🎨', '🖌️', '✏️', '🖍️'],
  },

  // TV, film, anime, K-pop, celebrity/fandom. Added from the real feed's
  // neutral misses — House of the Dragon, One Piece, BTS, and friends were
  // the single biggest coherent bucket falling into `neutral`.
  entertainment: {
    words: [
      'series', 'season', 'episode', 'movie', 'film', 'trailer', 'cast',
      'character', 'drama', 'anime', 'manga', 'netflix', 'webseries',
      'bollywood', 'hollywood', 'kdrama', 'kpop', 'celebrity', 'actor',
      'actress', 'cinema', 'cinephile', 'ott', 'アニメ',
    ],
    phrases: [
      'house of the dragon', 'game of thrones', 'one piece', 'new episode',
      'official trailer', 'behind the scenes', 'box office',
    ],
    hashtags: [
      'houseofthedragon', 'hotd', 'gameofthrones', 'targaryen', 'onepiece',
      'anime', 'manga', 'kdrama', 'kpop', 'bts', 'netflix', 'marvel', 'dc',
      'webseries', 'bollywood', 'hollywood', 'movie', 'series', 'cinephile',
      'cinephilecommunity', 'daemontargaryen', 'rhaenyratargaryen',
      'gameofthronesedit', 'animeedit',
    ],
    emoji: ['🎬', '🍿', '🎞️', '📺'],
  },
};

export const LEXICON: Record<ClassifiableCategory, CategoryLexicon> = {
  ...CHARGED,
  ...TOPICS,
};

/**
 * Tie-break order, most specific first, and — crucially — charged before
 * topics. Position decides the winner when two categories score identically;
 * this is behaviour, not presentation. Charged outranks topic on a tie so a
 * reel that is emotionally charged AND on a topic (a heartbreak song, a
 * motivational gym clip) is counted for what detection cares about. Within
 * charged, the negative-loop categories lead because a missed negative loop
 * is the failure that matters.
 */
export const TIE_BREAK_ORDER: ClassifiableCategory[] = [
  'breakup',
  'angry',
  'anxious',
  'sad',
  'romantic',
  'motivational',
  'joyful',
  // topics
  'comedy',
  'music',
  'dance',
  'food',
  'fitness',
  'sports',
  'tech',
  'fashion',
  'travel',
  'gaming',
  'pets',
  'art',
  'entertainment',
];
