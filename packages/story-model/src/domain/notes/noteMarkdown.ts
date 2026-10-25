const wikiLinkPattern: RegExp = /(!?)\[\[([^\]\n]+?)\]\]/g;
const markdownLinkPattern: RegExp = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
const firstHeadingPattern: RegExp = /^#\s+(.+?)\s*$/m;

export function normalizeNoteName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('ko');
}

export function compareNoteNames(left: string, right: string): number {
  return left.normalize('NFC').localeCompare(right.normalize('NFC'), 'ko', { numeric: true });
}

export function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

const notionIdSuffixPattern: RegExp = /\s+[0-9a-f]{32}$/i;

export function stripNotionIdSuffix(name: string): string {
  return name.replace(notionIdSuffixPattern, '');
}

export function extractNoteTitle(body: string, fallbackTitle: string): string {
  const heading: string | undefined = firstHeadingPattern.exec(body)?.[1]?.trim();

  return heading !== undefined && heading.length > 0 ? heading : fallbackTitle;
}

export function extractNoteLinkTargets(body: string): string[] {
  const targets: string[] = [];

  for (const match of body.matchAll(wikiLinkPattern)) {
    const target: string = (match[2] ?? '').split('|')[0]?.split('#')[0]?.trim() ?? '';
    const extension: string | undefined = /\.([A-Za-z0-9]+)$/.exec(target)?.[1]?.toLowerCase();

    if (target.length > 0 && (extension === undefined || extension === 'md')) {
      targets.push(stripMarkdownExtension(target));
    }
  }

  for (const match of body.matchAll(markdownLinkPattern)) {
    const target: string = (match[1] ?? '').split('#')[0] ?? '';

    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || !/\.md$/i.test(target)) {
      continue;
    }

    targets.push(stripMarkdownExtension(safeDecode(target)));
  }

  return [...new Set(targets)];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
