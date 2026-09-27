export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export function hasSelection(selection: TextSelection | undefined): selection is TextSelection {
  return selection !== undefined && selection.end > selection.start;
}

// Applies an accepted AI proposal to the draft. The selection is re-found by its text when the body
// moved under it (an autosave echo, a reload), and the edit is refused when the text is gone, so a
// proposal never lands on the wrong sentence.
export function replaceSelection(
  body: string,
  selection: TextSelection,
  original: string,
  replacement: string,
): string | undefined {
  if (body.slice(selection.start, selection.end) === original) {
    return body.slice(0, selection.start) + replacement + body.slice(selection.end);
  }

  const index = body.indexOf(original);

  if (index === -1 || body.indexOf(original, index + 1) !== -1) {
    return undefined;
  }

  return body.slice(0, index) + replacement + body.slice(index + original.length);
}
