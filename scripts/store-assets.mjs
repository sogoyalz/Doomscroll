// Capture the actual packaged UI with explicitly disclosed synthetic data.
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'doomscroll-store-demo-'));
const extension = resolve('dist');
const output = resolve('store-assets');
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/options/index.html`);
  await page.getByLabel('Record the reels I watch').waitFor();
  await page.evaluate(async () => {
    const now = Date.now();
    const examples = [
      ['new standup skit, try not to laugh', 'meme'],
      ['crying again tonight, feeling so lonely', 'sad'],
      ['weekend trip to the mountains', 'wanderlust'],
      ['so happy and grateful today, best day', 'blessed'],
      ['easy paneer recipe for dinner', 'streetfood'],
      ['quick python coding tutorial', 'programming'],
    ];
    for (let i = 0; i < 48; i++) {
      const [captionText, tag] = examples[i % examples.length];
      const startedAt = now - (49 - i) * 20_000;
      const response = await chrome.runtime.sendMessage({
        type: 'REEL_VIEW_LOGGED',
        payload: {
          id: `demo-${i}`,
          reelShortcode: `DEMO${i}`,
          sessionId: 'demonstration-session',
          startedAt,
          endedAt: startedAt + 12_000,
          watchDurationMs: 12_000,
          captionText,
          hashtags: [tag],
          audioName: null,
          authorHandle: 'demo_creator',
        },
      });
      if (!response?.ok) throw new Error('Demo event could not be recorded');
    }
  });
  async function label(target) {
    await target.evaluate(() => {
      const banner = document.createElement('div');
      banner.textContent = 'DEMONSTRATION — SYNTHETIC DATA • No personal viewing history';
      banner.style.cssText =
        'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#17261f;color:#fff;padding:12px;text-align:center;font:14px system-ui;';
      document.body.append(banner);
    });
  }
  await page.reload();
  await page.getByLabel('Record the reels I watch').waitFor();
  await label(page);
  await page.screenshot({ path: join(output, 'settings-demo.png') });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
  await popup.getByRole('heading', { name: 'Doomscroll' }).waitFor();
  await popup.evaluate(() => {
    document.body.style.margin = '30px auto';
  });
  await label(popup);
  await popup.screenshot({ path: join(output, 'dashboard-demo.png') });
  console.log('Saved two 1280×800 screenshots of the packaged UI using synthetic data only.');
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
