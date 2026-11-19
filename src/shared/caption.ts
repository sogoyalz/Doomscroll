// Caption cleanup shared by the page extractor and both classifiers.
// Kept separate so the content script does not bundle the word lists.

/**
 * Instagram collapses long captions to a first line followed by "… more".
 * That suffix is interface text, not the creator's words, and stored history
 * still contains it, so it is removed wherever a caption is read.
 */
export function cleanCaption(caption: string | null): string | null {
  if (caption == null) return null;
  const cleaned = caption.replace(/\s*(?:…|\.\.\.)\s*more\s*$/iu, '').trim();
  return cleaned || null;
}
