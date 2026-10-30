# Workspace layout

This folder is the active project and the clean GitHub checkout. Run npm
commands here. Source lives in `src/`, tests in `tests/` and `e2e/`, and the
extension build is `dist/`. Release archives are generated in this folder.

The former `production/` checkout has been moved here. There is no second
active copy. The CSV security fix found in the older labeling tool is included.

`.workspace-backup/` preserves the previous root files, dependencies, build
artifacts, and private Git history locally. It is excluded from Git and
formatting; the push guard also rejects it if accidentally force-added.
Do not push or merge that history into this clean checkout.

In Chrome, load this folder's `dist/` with **Load unpacked**. The former
`production/dist/` path no longer exists.
