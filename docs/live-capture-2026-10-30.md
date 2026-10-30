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

## Follow-up: live save acknowledgements

After installing commit `c33776a`, a fresh consenting user's Chrome Reels tab
showed the new separate capture and save counters. A rapid preliminary sample
was excluded because it did not enforce minimum dwell. Its settled baseline
was one captured view and one confirmed save.

Ten subsequent controlled next-reel transitions used 800ms dwell before each
transition and 800ms to settle replies afterwards. Each transition incremented
both counters by exactly one, ending at 11 captures and 11 confirmed saves.
All ten observations had zero skipped and zero unconfirmed views, `bridge: ok`,
and no fallback identities in the rolling diagnostic rows. The validation tab
was closed afterwards to prevent additional test views.

The save count advances only after a successful worker response following the
IndexedDB transaction and persistence bookkeeping. This verifies live save
acknowledgement for the sample. It is still not an independent read of the
popup's stored total or a test of worker restart recovery on the live feed.
No private feed content, identifiers, screenshots, or exports were retained.
