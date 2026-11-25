import { useState } from 'react';
import { classifyDimensions } from '@shared/classifier.js';
import { TOPIC_CATEGORIES, CHARGED_CATEGORIES } from '@shared/taxonomy.js';
import { send } from '@shared/client.js';
import type { ReelEvent } from '@shared/types.js';

export function ReelReview({ reel }: { reel: ReelEvent }) {
  const predicted = reel.classificationDetails ?? classifyDimensions(reel);
  const [topic, setTopic] = useState(reel.review?.topic ?? (reel.review?.topicAbstention === 'other' ? '__other' : ''));
  const [tone, setTone] = useState(reel.review?.tone ?? (reel.review?.toneAbstention === 'other' ? '__other' : ''));
  const [status, setStatus] = useState(reel.review ? 'Saved review' : '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await send('REVIEW_REEL', { id: reel.id,
        topic: topic === '__other' ? null : topic || null, tone: tone === '__other' ? null : tone || null,
        topicAbstention: topic === '__other' ? 'other' : 'unsure',
        toneAbstention: tone === '__other' ? 'other' : 'unsure',
      });
      setStatus('Saved review');
    } catch {
      setStatus('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="reel-review">
      <summary>
        {reel.authorHandle ? `@${reel.authorHandle}: ` : ''}
        {(reel.captionText || 'No caption').slice(0, 100)}
      </summary>
      <p>{reel.captionText}</p>
      <p>
        Hashtags: {reel.hashtags.join(' ') || 'None'} · Audio: {reel.audioName || 'Unknown'}
      </p>
      {/^[A-Za-z0-9_-]{5,30}$/.test(reel.reelShortcode) && (
        <a
          href={`https://www.instagram.com/reel/${reel.reelShortcode}/`}
          target="_blank"
          rel="noreferrer"
        >
          Watch reel to review
        </a>
      )}
      <p>
        Engine: {reel.classificationDetails?.engine ?? 'local-rules'}{' '}
        {reel.classificationDetails?.status === 'fallback'
          ? '(model unavailable; rules fallback)'
          : ''}
      </p>
      {status === 'Saved review' && <p>
        Suggested topic: <strong>{predicted.topic ?? 'Uncertain'}</strong> · Suggested tone:{' '}
        <strong>{predicted.tone ?? 'Uncertain'}</strong>
      </p>}
      <p>Review after watching. Choose “Other” when the label you need is missing.</p>
      <label>
        Correct topic{' '}
        <select
          value={topic}
          disabled={busy}
          onChange={(e) => {
            setTopic(e.target.value);
            setStatus('Unsaved');
          }}
        >
          <option value="">Unsure</option>
          <option value="__other">Other</option>
          {TOPIC_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>{' '}
      <label>
        Correct tone{' '}
        <select
          value={tone}
          disabled={busy}
          onChange={(e) => {
            setTone(e.target.value);
            setStatus('Unsaved');
          }}
        >
          <option value="">Unsure</option>
          <option value="__other">Other</option>
          {CHARGED_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>{' '}
      <button className="action" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save review'}
      </button>
      <span role="status"> {status}</span>
    </details>
  );
}
