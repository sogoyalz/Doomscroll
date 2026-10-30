# Browser compatibility

The manifest requires Chrome 116 or newer. This is the minimum API level,
not a recommendation to run an old browser instead of a current secure build.

- `chrome.notifications.create()` returns a Promise starting in Chrome 116.
  The intervention path awaits that result before confirming delivery.
  [Chrome notifications API](https://developer.chrome.com/docs/extensions/reference/api/notifications#method-create)
- `chrome.alarms.create()` supports Promises from Chrome 111. Alarms are
  restored when the worker starts because browser restarts can clear them.
  [Chrome alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)

The prior Chrome 111 declaration understated the notification API requirement.
Automated integration tests exercise the packaged ZIP on the Chromium build
installed by the locked Playwright version on macOS and Linux. API availability
review does not substitute for runtime testing on every browser version.
