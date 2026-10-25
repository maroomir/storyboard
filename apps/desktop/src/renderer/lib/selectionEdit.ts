export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export function hasSelection(selection: TextSelection | undefined): selection is TextSelection {
  return selection !== undefined && selection.end > selection.start;
}

export function replaceSelection(
  body: string,
  selection: TextSelection,
  original: string,
  replacement: string,
): string | undefined {
  if (body.slice(selection.start, selection.end) === original) {
    return body.slice(0, selection.start) + replacement + body.slice(selection.end);
  }

  const index: number = body.indexOf(original);

  if (index === -1 || body.indexOf(original, index + 1) !== -1) {
    return undefined;
  }

  return body.slice(0, index) + replacement + body.slice(index + original.length);
}
