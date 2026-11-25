import { describe, expect, it } from 'vitest';
import { auditStorePermissions } from '../scripts/lib/store-permissions.mjs';

const manifest = {
  permissions: ['storage', 'alarms', 'offscreen'],
  optional_permissions: ['notifications'],
  host_permissions: ['https://www.instagram.com/*'],
  content_scripts: [
    {
      matches: ['https://www.instagram.com/*'],
    },
  ],
};

const sources = [
  {
    path: 'src/background/index.ts',
    text: 'chrome.storage.local.get(key);\nchrome.alarms.create(name);',
  },
  {
    path: 'src/background/intervene.ts',
    text: 'chrome.notifications.create({ type: "basic" });\nchrome.tabs.sendMessage(id, message);',
  },
];

describe('store permission audit', () => {
  it('accepts the permissions the listing describes', () => {
    expect(auditStorePermissions({ manifest, sources })).toEqual([]);
  });

  it('rejects a permission the extension does not use', () => {
    const problems = auditStorePermissions({
      manifest: { ...manifest, permissions: ['storage', 'alarms', 'tabs'] },
      sources,
    });
    expect(problems.some((problem) => problem.includes('tabs'))).toBe(true);
  });

  it('rejects a network call', () => {
    const problems = auditStorePermissions({
      manifest,
      sources: [
        ...sources,
        { path: 'src/shared/client.ts', text: 'fetch("https://example.test")' },
      ],
    });
    expect(problems.some((problem) => problem.includes('network fetch'))).toBe(true);
  });

  it('ignores a network call that is only mentioned in a comment', () => {
    const problems = auditStorePermissions({
      manifest,
      sources: [
        ...sources,
        { path: 'src/notes.ts', text: '// never call fetch() from this extension' },
      ],
    });
    expect(problems).toEqual([]);
  });

  it('rejects content scripts on other sites', () => {
    const problems = auditStorePermissions({
      manifest: { ...manifest, content_scripts: [{ matches: ['<all_urls>'] }] },
      sources,
    });
    expect(problems.some((problem) => problem.includes('hosts'))).toBe(true);
  });
});
