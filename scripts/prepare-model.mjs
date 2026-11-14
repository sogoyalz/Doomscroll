// Fetch pinned public weights at build time, never from an installed extension.
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
const metadata = JSON.parse(
  await readFile(new URL('./model-assets.json', import.meta.url), 'utf8'),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const [file, expected] of Object.entries(metadata.files)) {
  const target = join('public/models/nli-deberta-v3-xsmall', file);
  let bytes = await readFile(target).catch(() => null);
  if (!bytes || hash(bytes) !== expected) {
    const response = await fetch(
      `https://huggingface.co/${metadata.repository}/resolve/${metadata.revision}/${file}`,
    );
    if (!response.ok) throw new Error(`Model download failed: ${file} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== expected) throw new Error(`Model checksum mismatch: ${file}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
await mkdir('public/runtime', { recursive: true });
for (const suffix of ['.asyncify']) {
  for (const extension of ['mjs', 'wasm']) {
    const name = `ort-wasm-simd-threaded${suffix}.${extension}`;
    await copyFile(
      join('node_modules/onnxruntime-web/dist', name),
      join('public/runtime', name),
    );
  }
}
console.log('Pinned model checksums verified; local WASM runtime prepared.');

// Remove obsolete generated runtimes after switching to the pinned asyncify backend.
for (const suffix of ['', '.jsep']) {
  for (const extension of ['mjs', 'wasm']) {
    await rm(`public/runtime/ort-wasm-simd-threaded${suffix}.${extension}`, { force: true });
  }
}
