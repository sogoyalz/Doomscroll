import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const entryPoints = {
  'content.bundle': 'src/content/content.ts',
  'service-worker.bundle': 'src/background/service-worker.ts',
};

// popup.ts / options.ts are loaded as page scripts (not MV3 service workers),
// so they bundle into their own folders next to their html.
const pageEntryPoints = {
  'src/popup/popup.bundle': 'src/popup/popup.ts',
  'src/options/options.bundle': 'src/options/options.ts',
};

const sharedOptions = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
  minify: true,
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
