import { test as base, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const test = base.extend({
  notificationsGranted: [false, { option: true }],
});

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
  await expect(page.locator('[data-reel-code]').first()).toHaveAttribute(
    'data-reel-code',
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

test.beforeEach(async ({ notificationsGranted }) => {
  profile = await mkdtemp(join(tmpdir(), 'doomscroll-browser-'));
  const extracted = join(profile, 'packaged-extension');
  // Test exactly what users receive, rather than only the build directory.
  execFileSync('unzip', ['-q', resolve(`doomscroll-${version}.zip`), '-d', extracted]);
  const manifestPath = join(extracted, 'manifest.json');
  const packagedManifest = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(packagedManifest);
  expect(manifest.version).toBe(version);
  expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  if (notificationsGranted) {
    // Headless Chromium can't click the native optional-permission prompt. Seed the
    // grant in this disposable profile, then restore the exact ZIP before exercising it.
    expect(manifest.optional_permissions).toContain('notifications');
    manifest.permissions.push('notifications');
    manifest.optional_permissions = manifest.optional_permissions.filter((p) => p !== 'notifications');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await launchProfile();
    await context.close();
    await writeFile(manifestPath, packagedManifest);
  }
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
  await expect(pausedFeed.locator('html')).toHaveAttribute('data-reel-watch', 'off');
  await expect(pausedFeed.locator('[data-reel-code]')).toHaveCount(0);
});

test('reminders can be switched off after their baseline expires', async () => {
  await send('UPDATE_SETTINGS', { interventionEnabled: true });
  await options.reload();
  const toggle = options.getByRole('checkbox', { name: /Allow Doomscroll to interrupt me/ });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  await options.locator('label.toggle').filter({ has: toggle }).click();
  await expect.poll(async () => (await send('GET_SETTINGS')).interventionEnabled).toBe(false);
  await expect(toggle).toBeDisabled();
});

test('a declined desktop notification test leaves automatic reminders and history alone', async () => {
  // The optional-permission dialog is browser UI. Simulate declining it in this page only.
  await options.evaluate(() => {
    chrome.permissions.request = async () => false;
  });
  const button = options.getByRole('button', { name: 'Test desktop notification' });
  await button.click();
  await expect(options.getByRole('status').filter({ hasText: 'Allow the notification permission' })).toBeVisible();
  await expect(button).toBeEnabled();
  expect((await send('GET_SETTINGS')).interventionEnabled).toBe(false);
  expect(await send('GET_INTERVENTION_LOG')).toHaveLength(0);
});

test('real content scripts record scrolling, extract audio, and respect SPA privacy exclusions', async () => {
  await send('UPDATE_SETTINGS', { debugHud: true });
  const page = await feed();
  await page.waitForTimeout(400); // Exercise the real 250ms dwell threshold.
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(1);
  await expect(page.locator('#reel-diag')).toContainText(
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
  await expect(page.locator('#reel-diag')).toContainText(
    'reels: 2  saved: 2  skipped: 0  unconfirmed: 0',
  );
  expect((await events()).map((view) => view.reelShortcode).sort()).toEqual([
    'SYNTHETIC00',
    'SYNTHETIC02',
  ]);
  await page.evaluate(() => history.pushState({}, '', '/accounts/edit/'));
  await advance(page, 1);
  await page.waitForTimeout(1200);
  expect(await events()).toHaveLength(2);
  const accounts = await context.newPage();
  await accounts.goto('https://www.instagram.com/accounts/edit/');
  await expect(accounts.locator('[data-reel-code]')).toHaveCount(0);
  await expect(accounts.locator('#reel-diag')).toHaveCount(0);
  expect(await events()).toHaveLength(2);
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

async function seedBaselineAndSession(now) {
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
}
async function seedSadRun(now, from, to) {
  for (let i = from; i < to; i++)
    await send('REEL_VIEW_LOGGED', {
      id: `run-${i}`,
      reelShortcode: `run-${i}`,
      sessionId: 'synthetic-session',
      startedAt: now - (40 - i) * 6000,
      endedAt: now - (40 - i) * 6000 + 5000,
      watchDurationMs: 5000,
      captionText: 'crying again tonight, feeling so lonely',
      hashtags: ['sad'],
      audioName: null,
      authorHandle: 'synthetic_creator',
    });
}

test('popup shows whether automatic reminders are off, enabled, or paused', async () => {
  await seedBaselineAndSession(Date.now());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(popup.getByText('Automatic reminders are off.', { exact: false })).toBeVisible();
  await send('UPDATE_SETTINGS', { interventionEnabled: true });
  await popup.reload();
  await expect(popup.getByText('Automatic reminders are on', { exact: false })).toBeVisible();
  await popup.getByRole('button', { name: 'Pause tracking' }).click();
  await expect(popup.getByText('Automatic reminders are paused', { exact: false })).toBeVisible();
});
/** Scrolls to a reel and waits until the view that just ended is stored. */
async function watchNext(page, index) {
  const before = (await events()).length;
  await page.waitForTimeout(400);
  await advance(page, index);
  await expect.poll(async () => (await events()).length).toBeGreaterThan(before);
}

test('interruptions stay silent when off, then escalate once per level in the packaged extension', async () => {
  const now = Date.now();
  await seedBaselineAndSession(now);
  await seedSadRun(now, 0, 9);
  const page = await feed();

  // Switched off (the default): a qualifying run is logged but never shown.
  await watchNext(page, 1);
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await send('GET_INTERVENTION_LOG')).toHaveLength(0);
  const [latest] = await send('GET_DETECTION_LOG', { limit: 1 });
  expect(latest).toMatchObject({ detected: true, category: 'sad', wouldHaveActed: false });

  // Switched on, but the run's category is not one the user watches.
  await send('UPDATE_SETTINGS', { interventionEnabled: true, watchedCategories: ['angry'] });
  await watchNext(page, 2);
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await send('GET_INTERVENTION_LOG')).toHaveLength(0);

  // Watching sad: the next reel in the run earns the overlay, with no delay.
  await send('UPDATE_SETTINGS', { watchedCategories: ['sad'] });
  await watchNext(page, 1);
  const keep = page.getByRole('button', { name: /Keep scrolling/ });
  await expect(keep).toBeEnabled();
  await keep.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let log = await send('GET_INTERVENTION_LOG');
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ level: 'overlay', outcome: 'bypassed', category: 'sad' });
  expect(log[0].deliveredAt).toBeGreaterThan(0);

  // The same level does not fire twice in one session.
  await watchNext(page, 2);
  await page.waitForTimeout(800);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await send('GET_INTERVENTION_LOG')).toHaveLength(1);

  // A run long enough for the block level escalates to the delayed prompt.
  const stored = (await events()).length;
  await seedSadRun(now, 9, 9 + (19 - stored));
  await watchNext(page, 1);
  await expect(keep).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Take a break' })).toBeEnabled();
  log = await send('GET_INTERVENTION_LOG');
  expect(log).toHaveLength(2);
  expect(log[0]).toMatchObject({ level: 'block', outcome: 'pending' });
  expect(log[0].streak).toBeGreaterThanOrEqual(20);
});

test.describe('with desktop notification permission', () => {
  test.use({ notificationsGranted: true });

  test('a sample and an automatic reminder both reach the Chrome notifications API', async () => {
    expect(await options.evaluate(() => chrome.permissions.contains({ permissions: ['notifications'] }))).toBe(true);
    const active = () => options.evaluate(async () => Object.keys(await chrome.notifications.getAll()));
    await options.getByRole('button', { name: 'Test desktop notification' }).click();
    await expect(options.getByText('Chrome accepted the test notification.', { exact: false })).toBeVisible();
    const samples = await active();
    expect(samples).toHaveLength(1);
    expect(await send('GET_INTERVENTION_LOG')).toHaveLength(0);
    expect((await send('GET_SETTINGS')).interventionEnabled).toBe(false);
    await options.evaluate((id) => chrome.notifications.clear(id), samples[0]);

    const now = Date.now();
    await seedBaselineAndSession(now);
    await options.reload();
    await options.locator('label.toggle').filter({ hasText: 'Allow Doomscroll to interrupt me' }).click();
    await expect.poll(async () => (await send('GET_SETTINGS')).interventionEnabled).toBe(true);
    await seedSadRun(now, 0, 7);
    const page = await feed();
    await watchNext(page, 1);
    await expect.poll(active).toHaveLength(1);
    const [reminder] = await active();
    expect(reminder).not.toBe(samples[0]);
    await watchNext(page, 2);
    const rows = await send('GET_INTERVENTION_LOG');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: 'notify', category: 'sad', streak: 8 });
    expect(rows[0].deliveredAt).toBeGreaterThan(0);
    expect(await active()).toEqual([reminder]);
  });
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

test('numeric media IDs in the new Instagram player layout remain stable while scrolling', async () => {
  const page = await feed();
  await page.evaluate(() => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (const [i, el] of [...document.querySelectorAll('[data-reel]')].entries()) {
      const shortcode = 'SYNTHETIC0' + i;
      const id = [...shortcode].reduce((n, c) => n * 64n + BigInt(alphabet.indexOf(c)), 0n);
      el.querySelector('video').__reactFiber$fixture = {
        memoizedProps: { mediaId: String(id) },
        return: null,
      };
      el.removeAttribute('data-reel-code');
    }
  });
  await expect(page.locator('[data-reel="1"]')).toHaveAttribute(
    'data-reel-code',
    'SYNTHETIC01',
  );
  await advance(page, 1);
  await page.waitForTimeout(400);
  await advance(page, 2);
  await expect
    .poll(async () => (await events()).some((e) => e.reelShortcode === 'SYNTHETIC01'))
    .toBe(true);
});

test('human topic and tone reviews persist through reload and appear in export', async () => {
  const page = await feed();
  await page.waitForTimeout(400);
  await advance(page, 1);
  await expect.poll(async () => (await events()).length).toBe(1);
  await page.close();
  await options.reload();
  await options.locator('.session-head').first().click();
  await options.locator('.reel-review summary').first().click();
  const review = options.locator('.reel-review').first();
  await expect(review).toContainText('Suggested tone: sad');
  await review.getByLabel('Correct topic').selectOption('music');
  await review.getByLabel('Correct tone').selectOption('romantic');
  await review.getByRole('button', { name: 'Save review' }).click();
  await expect(review.getByRole('status')).toHaveText('Saved review');
  await options.reload();
  await options.locator('.session-head').first().click();
  await options.locator('.reel-review summary').first().click();
  await expect(options.getByLabel('Correct topic').first()).toHaveValue('music');
  await expect(options.getByLabel('Correct tone').first()).toHaveValue('romantic');
  expect((await send('EXPORT_DATA', { which: 'reels' })).csv).toContain(
    '"music","romantic","","sad"',
  );
});

test('bundled trained model classifies new views without a network service', async () => {
  test.setTimeout(180000);
  const engine = options.getByRole('combobox', { name: /Engine/ });
  await engine.selectOption('local-ml');
  await expect
    .poll(async () => (await send('GET_SETTINGS')).classificationMode)
    .toBe('local-ml');
  const requests = [];
  context.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  const now = Date.now();
  await send('REEL_VIEW_LOGGED', {
    id: 'model-smoke',
    reelShortcode: 'MODELSMOKE',
    sessionId: 'model-session',
    startedAt: now,
    endedAt: now + 2000,
    watchDurationMs: 2000,
    captionText: 'Trying on three different dresses for tonight',
    hashtags: [],
    audioName: 'Romantic love song',
    authorHandle: 'synthetic_creator',
  });
  const [event] = await events();
  expect(event.classificationDetails?.engine).toBe('deberta-nli-q8-v1');
  expect(event.classificationDetails?.topic).toBe('fashion');
  expect(event.classificationDetails?.tone).toBeNull();
  expect(event.category).toBe('fashion');
  await send('REEL_VIEW_LOGGED', {
    id: 'model-music',
    reelShortcode: 'MODELMUSIC',
    sessionId: 'model-session',
    startedAt: now + 3000,
    endedAt: now + 5000,
    watchDurationMs: 2000,
    captionText: 'Playing the violin on stage with the orchestra ❤️',
    hashtags: [],
    audioName: 'Romantic love song',
    authorHandle: 'synthetic_creator',
  });
  const music = (await events()).find((row) => row.id === 'model-music');
  expect(music.classificationDetails).toMatchObject({
    engine: 'deberta-nli-q8-v1',
    topic: 'music',
    tone: null,
  });
  expect(requests).toEqual([]);
  const exported = await send('EXPORT_DATA', { which: 'reels' });
  expect(exported.csv).toContain('deberta-nli-q8-v1');
  await options.reload();
  await expect(engine).toHaveValue('local-ml');
});

test('welcome survives empty daily summaries and retires after the first view', async () => {
  await send('GET_STATS', { range: 'today' });
  await options.reload();
  await expect(options.locator('.welcome')).toBeVisible();
  const page = await feed();
  await watchNext(page, 1);
  await options.reload();
  await expect(options.getByLabel('Record the reels I watch')).toBeVisible();
  await expect(options.locator('.welcome')).toHaveCount(0);
});

for (const landing of ['/direct/inbox/', '/accounts/edit/']) {
  test('starts tracking after leaving ' + landing + ' without a document reload', async () => {
    const page = await context.newPage();
    await page.goto('https://www.instagram.com' + landing);
    await page.waitForTimeout(1200);
    await expect(page.locator('[data-reel-watch], [data-reel-code]')).toHaveCount(0);
    expect(await events()).toHaveLength(0);
    await page.evaluate(() => history.pushState({}, '', '/reels/synthetic/'));
    await expect(page.locator('[data-reel-code]').first()).toHaveAttribute('data-reel-code', 'SYNTHETIC00');
    await watchNext(page, 1);
    expect(await events()).toHaveLength(1);
  });
}
