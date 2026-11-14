import type { NewReelEvent } from './types.js';

/**
 * Asks storage and the worker to keep a finished view.
 *
 * Both calls are issued before either is awaited. Waiting for the storage
 * acknowledgement first meant a page that closed in that gap never sent the
 * view, and could also lose the storage write itself.
 */
export async function deliverReelView<T>(
  event: NewReelEvent,
  keep: (event: NewReelEvent) => Promise<unknown>,
  send: (event: NewReelEvent) => Promise<T>,
): Promise<{ stored: boolean; result: T }> {
  const stored = keep(event).then(
    () => true,
    () => false,
  );
  const sent = send(event).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const [kept, delivery] = await Promise.all([stored, sent]);
  if (!delivery.ok) throw delivery.error;
  return { stored: kept, result: delivery.value };
}
