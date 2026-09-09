// The one place this extension navigates the user's page.
//
// A separate module for two reasons. It is the only line of code here with a
// side effect on where the user *is* rather than on what they see, which is
// worth being able to find. And jsdom refuses to let `location.assign` be
// stubbed, so with the call inlined the guarantee that a break actually leaves
// the feed cannot be tested — and that guarantee has already regressed once,
// by being placed behind a message whose failure skipped it.

/** Sends the page somewhere. Same origin; the caller decides where. */
export function goTo(url: string): void {
  location.assign(url);
}
