# Live layout smoke check — 30 October 2026

Scope: read-only inspection of a logged-in desktop Instagram Reels surface.
No private caption text, handles, reel IDs, messages, screenshots, or exports
are included here. This is a selector/layout check, not a completed release
acceptance test or a study of classifier accuracy.

Observed seven mounted player containers. The nearest author-containing
wrapper around each player had zero height because the player was absolutely
positioned. The first enclosing box with measurable height correctly resolved
all seven containers, with exactly one spanning the viewport midpoint. This
was a tracking blocker in the previous selection rule. The corrected rule is
covered by unit tests and the packaged Chromium fixture.

All seven containers had a caption element and an author link. Six contained
readable audio attribution. For those six, the first matching audio link was
empty; a second matching link contained the artist/track text. This confirms
the need to try every audio candidate, rather than stopping at the first href.
The remaining container had no readable attribution link inside its selected
player box; this observation alone does not classify it as a selector failure.

The check did not install the candidate in the user's browser, validate the
MAIN-world fiber bridge on live Instagram, reconcile recorded view counts,
exercise every navigation/locale/layout, or measure intervention usefulness.
Those remain pending under `release-readiness.md`.
