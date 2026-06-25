chrome.runtime.onInstalled.addListener((details) => {
    console.log('InstaReel Tracker v5.1 installed — reason:', details.reason);
    chrome.storage.local.get(['reelCount','reel_records'], data => {
      const defaults = {};
      if (data.reelCount === undefined) defaults.reelCount = 0;
      if (!Array.isArray(data.reel_records)) defaults.reel_records = [];
      if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
    });
  });