import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

let context, worker, options, extensionId, profile;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}#feed{height:100vh;overflow-y:auto}section{height:100vh;position:relative}
.zero-wrap{height:0}[aria-label="Video player"]{position:absolute;height:70vh}video{width:200px;height:100px}
</style></head><body><div id="feed">${Array.from(
  { length: 3 },
  (_, i) => `
<section data-reel="${i}"><div class="zero-wrap"><div aria-label="Video player"><video preload="none" src="https://media.example.invalid/${i}.mp4"></video></div>
<a aria-label="synthetic_creator reels" href="/synthetic_creator/reels/">synthetic_creator</a>
<div dir="auto">crying again tonight, feeling so lonely <a href="/explore/tags/sad/">#sad</a></div>
<a href="/reels/audio/123/"><span dir="auto">Example Artist · Example Track</span></a></div></section>`,
).join('')}
</div><script>document.querySelectorAll('[data-reel]').forEach((el,i)=>{
el.__reactFiber$fixture={memoizedProps:{},return:null};
let stack={memoizedProps:{media:{code:'SYNTHETIC0'+i}},return:el.__reactFiber$fixture};
for(let depth=0;depth<60;depth++) stack={memoizedProps:{},return:stack};
el.querySelector('video').__reactFiber$fixture=stack;
});</script></body></html>`;

async function send(type, payload = {}) {
  return options.evaluate(
    async ({ type, payload }) => {
      const reply = await chrome.runtime.sendMessage({ type, payload });
      if (!reply?.ok) throw new Error(reply?.error ?? 'No reply');
      return reply.data;
    },
    { type, payload },
  );
}
async function events() {
  return worker.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('doomscroll');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('reelEvents');
          const request = tx.objectStore('reelEvents').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function feed() {
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/reels/synthetic/');
  await expect(page.locator('[data-doomscroll-shortcode]').first()).toHaveAttribute(
    'data-doomscroll-shortcode',
    'SYNTHETIC00',
  );
  return page;
}
async function advance(page, index) {
  await page.evaluate((i) => {
    document.getElementById('feed').scrollTop = innerHeight * i;
  }, index);
}

async function launchProfile() {
  const extension = join(profile, 'packaged-extension');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await context.route('https://www.instagram.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: fixture,
    }),
  );
  await context.route('https://media.example.invalid/**', (route) => route.abort());
  options = await context.newPage();
  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`;
  try {
    await options.goto(optionsUrl);
  } catch (error) {
    // Chrome can restore/open the options page concurrently after relaunch.
    // Accept only a same-destination navigation, then verify the actual UI.
    if (!String(error).includes(`interrupted by another navigation to "${optionsUrl}"`)) {
      throw error;
    }
    await options.waitForURL(optionsUrl, { waitUntil: 'domcontentloaded' });
  }
  await expect(options.getByLabel('Record the reels I watch')).toBeChecked();
}

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'doomscroll-browser-'));
  const extracted = join(profile, 'packaged-extension');
  // Test exactly what users receive, rather than only the build directory.
  execFileSync('unzip', ['-q', resolve(`doomscroll-${version}.zip`), '-d', extracted]);
  const manifest = JSON.parse(readFileSync(join(extracted, 'manifest.json'), 'utf8'));
  expect(manifest.version).toBe(version);
  expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  await launchProfile();
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('packaged popup and settings load with a working pause control', async () => {
  await expect(options.getByLabel('Allow Doomscroll to interrupt me')).toBeDisabled();
  await options.locator('label.toggle').filter({ hasText: 'Record the reels I watch' }).click();
  await expect.poll(async () => (await send('GET_SETTINGS')).trackingEnabled).toBe(false);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(popup.getByRole('heading', { name: 'Doomscroll' })).toBeVisible();
  await expect(popup.locator('body')).not.toContainText('Couldn’t load');
  const pausedFeed = await context.newPage();
  await pausedFeed.goto('https://www.instagram.com/reels/synthetic/');
  await expect(pausedFeed.locator('html')).toHaveAttribute('data-doomscroll-tracking', 'off');
  await expect(pausedFeed.locator('[data-doomscroll-shortcode]')).toHaveCount(0);
});

test('real content scripts record scrolling, extract audio, and respect SPA privacy exclusions', async () => {
  await send('UPDATE_SETTINGS', { debugHud: true });
  const page = await feed();
  await page.waitForTimeout(400); // Exercise the real 250ms dwell threshold.
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(1);
  await expect(page.locator('#doomscroll-hud')).toContainText(
    'reels: 1  saved: 1  skipped: 0  unconfirmed: 0',
  );
  expect((await events())[0]).toMatchObject({
    reelShortcode: 'SYNTHETIC00',
    audioName: 'Example Artist · Example Track',
    category: 'sad',
  });
  await page.evaluate(() => history.pushState({}, '', '/direct/inbox/'));
  await advance(page, 2);
  await page.waitForTimeout(1200); // Includes the privacy-surface heartbeat.
  expect(await events()).toHaveLength(1);
  await page.evaluate(() => history.pushState({}, '', '/reels/synthetic/'));
  await page.waitForTimeout(1200);
  await advance(page, 0);
  await expect.poll(async () => (await events()).length).toBe(2);
  await expect(page.locator('#doomscroll-hud')).toContainText(
    'reels: 2  saved: 2  skipped: 0  unconfirmed: 0',
  );
  expect((await events()).map((view) => view.reelShortcode).sort()).toEqual([
    'SYNTHETIC00',
    'SYNTHETIC02',
  ]);
});

test('the default 20-reel block is delivered and its dismiss delay can always expire', async () => {
  const now = Date.now();
  await options.evaluate(async (now) => {
    const open = indexedDB.open('doomscroll');
    await new Promise((resolve, reject) => {
      open.onsuccess = resolve;
      open.onerror = reject;
    });
    const db = open.result;
    const tx = db.transaction('dailyAggregates', 'readwrite');
    for (let i = 1; i <= 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      tx.objectStore('dailyAggregates').put({
        date: key,
        totalReels: 100,
        totalMinutes: 10,
        avgReelsPerSec: 0.1,
        longestBingeMs: 60_000,
        categoryBreakdown: { joyful: 90, sad: 10 },
      });
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
    await chrome.storage.local.set({
      'doomscroll:session': { id: 'synthetic-session', lastActivityAt: now },
    });
  }, now);
  await send('UPDATE_SETTINGS', { interventionEnabled: true });
  for (let i = 0; i < 19; i++)
    await send('REEL_VIEW_LOGGED', {
      id: `seed-${i}`,
      reelShortcode: `seed-${i}`,
      sessionId: 'synthetic-session',
      startedAt: now - (20 - i) * 6000,
      endedAt: now - (20 - i) * 6000 + 5000,
      watchDurationMs: 5000,
      captionText: 'crying again tonight, feeling so lonely',
      hashtags: ['sad'],
      audioName: null,
      authorHandle: 'synthetic_creator',
    });
  const page = await feed();
  await page.waitForTimeout(400);
  await advance(page, 1);
  const keep = page.getByRole('button', { name: /Keep scrolling/ });
  await expect(keep).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Take a break' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(keep).toBeEnabled({ timeout: 15_000 });
  await keep.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const log = await send('GET_INTERVENTION_LOG');
  expect(log[0]).toMatchObject({ level: 'block', streak: 20, outcome: 'bypassed' });
  expect(log[0].deliveredAt).toBeGreaterThan(0);
});

test('tracking restarts after a persisted page restoration', async () => {
  const page = await feed();
  await page.waitForTimeout(400);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect.poll(async () => (await events()).length).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await page.waitForTimeout(400);
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(2);
});

test('accepting a break leaves the feed and reminds on return', async () => {
  const page = await feed();
  await options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.instagram.com/reels/*' });
    const reply = await chrome.tabs.sendMessage(tab.id, {
      type: 'INTERVENE',
      payload: {
        id: 'synthetic-break',
        level: 'overlay',
        category: 'sad',
        streak: 10,
      },
    });
    if (!reply?.data?.shown) throw new Error('Overlay was not delivered');
  });
  await page.getByRole('button', { name: 'Take a break', exact: true }).click();
  await expect(page).toHaveURL('https://www.instagram.com/');
  await page.goto('https://www.instagram.com/reels/synthetic/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /End it/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('exports recorded views and deletion removes the persisted data', async () => {
  const page = await feed();
  await page.waitForTimeout(400);
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(1);
  const exported = await send('EXPORT_DATA', { which: 'reels' });
  expect(exported.filename).toBe('doomscroll-reels.csv');
  expect(exported.csv).toContain('SYNTHETIC00');
  await send('CLEAR_DATA');
  expect(await events()).toHaveLength(0);
  await options.reload();
  expect((await send('EXPORT_DATA', { which: 'reels' })).csv).not.toContain('SYNTHETIC00');
});

test('browser restart recovers pending views exactly once and restores missing alarms', async () => {
  const page = await feed();
  await page.waitForTimeout(400);
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(1);
  await page.close();
  const original = (await events())[0];
  await options.evaluate(async (event) => {
    const recovered = { ...event, id: 'synthetic-restart-recovery' };
    await chrome.storage.local.set({
      ['doomscroll:pendingView:' + event.id]: { event, queuedAt: Date.now() },
      ['doomscroll:pendingView:' + recovered.id]: { event: recovered, queuedAt: Date.now() },
    });
    await chrome.alarms.clearAll();
  }, original);
  await context.close();
  await launchProfile();
  await expect.poll(async () => (await events()).length).toBe(2);
  expect((await events()).filter((event) => event.id === original.id)).toHaveLength(1);
  expect(
    (await events()).filter((event) => event.id === 'synthetic-restart-recovery'),
  ).toHaveLength(1);
  await expect
    .poll(() =>
      options.evaluate(
        async () =>
          Object.keys(await chrome.storage.local.get(null)).filter((key) =>
            key.startsWith('doomscroll:pendingView:'),
          ).length,
      ),
    )
    .toBe(0);
  expect(
    await options.evaluate(async () =>
      (await chrome.alarms.getAll()).map((alarm) => alarm.name),
    ),
  ).toEqual(expect.arrayContaining(['doomscroll:delivery', 'doomscroll:prune']));
  await send('CLEAR_DATA');
  // Simulate an old content script writing its durable copy after deletion.
  await options.evaluate(async (event) => {
    await chrome.storage.local.set({
      ['doomscroll:pendingView:' + event.id]: { event, queuedAt: Date.now() },
    });
  }, original);
  await context.close();
  await launchProfile();
  await expect
    .poll(() =>
      options.evaluate(
        async () =>
          Object.keys(await chrome.storage.local.get(null)).filter((key) =>
            key.startsWith('doomscroll:pendingView:'),
          ).length,
      ),
    )
    .toBe(0);
  expect(await events()).toHaveLength(0);
});
