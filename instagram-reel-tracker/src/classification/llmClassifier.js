// Optional smart classification path. Same interface as classifier.js's
// classify(text) so callers can switch engines without touching call sites.
// Disabled by default; enable via the options page ("settings.useLLM").

export async function classify(text, { apiKey, endpoint } = {}) {
  if (!text) return { mood: 'undetectable', score: 0, matched: {}, wordHits: {}, emojiHits: {} };
  if (!apiKey || !endpoint) {
    throw new Error('llmClassifier.classify requires apiKey and endpoint');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`llmClassifier request failed: ${response.status}`);
  }

  const result = await response.json();
  return {
    mood: result.mood || 'undetectable',
    score: result.score ?? 0,
    matched: result.matched || {},
    wordHits: result.wordHits || {},
    emojiHits: result.emojiHits || {},
  };
}
