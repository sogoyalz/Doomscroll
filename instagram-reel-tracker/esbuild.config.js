import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const entryPoints = {
  'content.bundle': 'src/content/content.js',
  'service-worker.bundle': 'src/background/service-worker.js',
};

// popup.js / options.js are loaded as page scripts (not MV3 service workers),
// so they bundle into their own folders next to their html.
const pageEntryPoints = {
  'src/popup/popup.bundle': 'src/popup/popup.js',
  'src/options/options.bundle': 'src/options/options.js',
};

const sharedOptions = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
};

async function build() {
  const ctxDist = await esbuild.context({
    ...sharedOptions,
    entryPoints,
    outdir: 'dist',
  });
  const ctxPages = await esbuild.context({
    ...sharedOptions,
    entryPoints: pageEntryPoints,
    outbase: '.',
    outdir: '.',
  });

  if (watch) {
    await Promise.all([ctxDist.watch(), ctxPages.watch()]);
    console.log('Watching for changes...');
  } else {
    await ctxDist.rebuild();
    await ctxPages.rebuild();
    await ctxDist.dispose();
    await ctxPages.dispose();
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
