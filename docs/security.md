# Keeping private data out of GitHub

Keep Instagram account exports, viewing-history exports, browser captures,
cookies, credentials, and private keys outside this repository. Ignore rules
cover common export and secret formats; they do not remove files already in
Git history.

Before publishing, run:

```sh
node scripts/check-sensitive.mjs
node scripts/check-sensitive.mjs HEAD
```

The first command checks tracked working files. The second checks the entire
history reachable from the commit, including deleted files. Reports show
paths and rule names, never matched credential values. These checks cover
common secret formats and private export paths; review unfamiliar data files
manually as well. CI also runs Gitleaks across the published history.

Enable the local push guard for each clone:

```sh
git config core.hooksPath .githooks
```

If a clone has private data in an old commit, publish from a separate clean
clone of GitHub's current history and transfer only reviewed code changes.
Do not force-push the old history or push backup branches. A hook can be
bypassed, so it is a safeguard rather than a guarantee.

If a credential was public, revoke or rotate it before removing it from Git
history. Removing the current file alone does not revoke credentials or
remove copies from old commits, forks, or caches.
