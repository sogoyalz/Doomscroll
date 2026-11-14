import { modelText } from '@shared/model-labels.js';
import type { ClassifierInput } from '@shared/classifier.js';
import type { ClassificationResult } from '@shared/types.js';

let creating: Promise<void> | undefined;
async function ensureDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'src/model/index.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Run the bundled local text model without blocking Instagram or sending reel text to a server.',
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}

export async function classifyWithModel(
  input: ClassifierInput,
): Promise<ClassificationResult | null> {
  const text = modelText(input);
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return null;
  const latin = letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length;
  if (latin / letters.length < 0.7) throw new Error('Unsupported model language');
  await ensureDocument();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ target: 'doomscroll-model', input }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Model timeout')), 20000);
      }),
    ]);
    if (!response?.ok)
      throw new Error(response?.error ?? 'Local model unavailable (no response)');
    return response.data as ClassificationResult | null;
  } catch (error) {
    // Stop timed-out work so it cannot build an unbounded inference queue.
    await chrome.offscreen.closeDocument().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
