import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const entryPoints = {
  'content.bundle': 'src/content/content.ts',
  'service-worker.bundle': 'src/background/service-worker.ts',
  'popup.bundle': 'src/popup/popup.ts',
  'options.bundle': 'src/options/options.ts',
};

async function build() {
  const ctx = await esbuild.context({
    entryPoints,
    outdir: 'dist',
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    sourcemap: true,
    minify: true,
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
