import { env, pipeline, type ZeroShotClassificationPipeline } from '@huggingface/transformers';
import {
  MODEL_ID,
  TOPIC_LABELS,
  TONE_LABELS,
  modelResult,
  modelText,
  type ModelScores,
} from '@shared/model-labels.js';
import { createSerialQueue } from '@shared/serial.js';
import type { ClassifierInput } from '@shared/classifier.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.numThreads = 1;
wasm.proxy = false;
wasm.wasmPaths = chrome.runtime.getURL('runtime/');
let ready: Promise<ZeroShotClassificationPipeline> | undefined;
function load() {
  return (ready ??= pipeline('zero-shot-classification', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
  }).catch((error) => {
    ready = undefined;
    throw error;
  }));
}
const serial = createSerialQueue();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'doomscroll-model' || sender.id !== chrome.runtime.id || sender.tab)
    return false;
  void serial(async () => {
    const input = message.input as ClassifierInput;
    if (
      !input ||
      !Array.isArray(input.hashtags) ||
      !(input.captionText === null || typeof input.captionText === 'string')
    )
      throw new Error('Invalid model input');
    const text = modelText(input);
    if (!text) return null;
    const classifier = await load();
    const topic = (await classifier(text, Object.values(TOPIC_LABELS), {
      hypothesis_template: 'This text is about {}.',
      multi_label: false,
    })) as ModelScores;
    const tone = (await classifier(text, Object.values(TONE_LABELS), {
      hypothesis_template: 'This text is about {}.',
      multi_label: false,
    })) as ModelScores;
    return modelResult(topic, tone);
  }).then(
    (data) => respond({ ok: true, data }),
    () => respond({ ok: false, error: 'Local model inference failed' }),
  );
  return true;
});
