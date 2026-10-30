/** Serializes read-modify-write operations within a worker lifetime. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}
