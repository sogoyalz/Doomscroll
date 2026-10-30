# Live capture validation — 30 October 2026

Scope: one consenting user's logged-in desktop Chrome Reels surface. The
candidate was loaded locally; no viewing exports, captions, handles, reel IDs,
feed screenshots, or React field values are included in this report.

## Findings and fixes

- A fresh page confirmed the candidate alone was running. Prior reload logs
  retained entries from an older copy, so fresh-page checks were used to avoid
  attributing stale messages to the current build.
- The 30-level React ancestry search returned `no-code` on live player stacks.
  Starting at the media/player and raising the bounded search to 120 levels
  restored `bridge: ok` and fiber-derived reel IDs. Shared ancestors and cycles
  are skipped. Unit and packaged-browser fixtures now include a 60-level stack.
- Temporary field-name-only diagnostics helped investigate the failure. They
  were removed from the final source and release package.

## Fully audited sample

Ten controlled next-reel transitions were observed after at least 650ms dwell
per view, above the 250ms minimum. The diagnostic counter was allowed to settle
before reading each result.

| Observation                                                | Result                              |
| ---------------------------------------------------------- | ----------------------------------- |
| Controlled transitions                                     | 10                                  |
| Completed-view counter increase                            | 10                                  |
| Fiber-derived identity on captured rows                    | 10 of 10                            |
| Missing extraction when visible caption/audio was observed | None observed in the audited sample |
| Bridge status during the sample                            | `ok`                                |

This is a functional smoke sample, not a statistical accuracy estimate. Audio
and caption support counts were not retained, so no per-field precision or
recall percentage is claimed.

## Extended run and limits

The HUD reached 61 total completed views during the broader run. The automation
session timed out before returning the full extended per-view record; the
extended run is therefore excluded from the fully audited sample above. A
rapid preliminary run was also excluded because sub-minimum dwell can
legitimately omit a view.

The HUD counts capture before persistence acknowledgement. The popup's starting
stored count was not supplied, so live IndexedDB count reconciliation is still
unverified. Transactional persistence, retries, duplicate delivery, export,
deletion, and intervention controls pass packaged-browser and integration tests
with synthetic data. They are not represented here as completed live tests.

This session does not complete the full live acceptance matrix, multi-user beta,
minimum-version runtime test, or an effectiveness study. See
`release-readiness.md` and `beta-acceptance.md` for the remaining gates.
