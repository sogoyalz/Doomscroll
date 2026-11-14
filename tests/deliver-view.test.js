import { describe, expect, it, vi } from 'vitest';
import { deliverReelView } from '../src/shared/deliver-view.ts';

const event = {
  id: 'view-1',
  reelShortcode: 'Dbv6giIR-kt',
  sessionId: 'doomscroll:unassigned',
  startedAt: 0,
  endedAt: 1000,
  watchDurationMs: 1000,
  captionText: null,
  hashtags: [],
  audioName: null,
  authorHandle: null,
};

describe('deliverReelView', () => {
  it('sends the view before the local save has finished', async () => {
    let release = () => {};
    const keep = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const send = vi.fn(() => Promise.resolve({ queued: true }));

    const pending = deliverReelView(event, keep, send);

    expect(send).toHaveBeenCalledWith(event);
    expect(keep).toHaveBeenCalledWith(event);
    release();
    await expect(pending).resolves.toEqual({ stored: true, result: { queued: true } });
  });
});
