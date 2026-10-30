# Store screenshots

`dashboard-demo.png` and `settings-demo.png` are 1280×800 captures of the
actual packaged extension. The visible banner explicitly identifies the
data as synthetic. No Instagram account or private viewing history is used.

Regenerate after UI changes with:

```sh
npm run build
node scripts/store-assets.mjs
```

These images demonstrate the interface; they do not establish classifier
accuracy or intervention effectiveness. Keep the disclosure visible in the
store listing. Store submission and review are separate from building assets.
