// Entry point for the background service worker ("the brain" — never sees
// the page, pure logic): message router + lifecycle events.

import { initDefaults } from '../lib/storage.js';
import { handleMessage } from './messageHandlers.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Doomscroll installed — reason:', details.reason);
  initDefaults();
});

chrome.runtime.onMessage.addListener(handleMessage);
