const wikiLinkPattern = /(!?)\[\[([^\]\n]+?)\]\]/g;
const markdownLinkPattern = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
const firstHeadingPattern = /^#\s+(.+?)\s*$/m;

// macOS 는 파일 이름을 풀어 쓴 자모(NFD)로 돌려주고 본문 링크는 조합형(NFC)이라, 맞추지 않으면
// 한글 노트 이름이 하나도 이어지지 않는다.
export function normalizeNoteName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('ko');
}

export function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

export function extractNoteTitle(body: string, fallbackTitle: string): string {
  const heading = firstHeadingPattern.exec(body)?.[1]?.trim();

  return heading !== undefined && heading.length > 0 ? heading : fallbackTitle;
}

// The targets a note points at, in reading order and without duplicates: `[[Name]]`,
// `[[folder/Name|label]]`, `[[Name#heading]]` and `[label](other.md)`. An embed of a non-note file
// (`![[map.png]]`) and a web link are not notes, so they are left out.
export function extractNoteLinkTargets(body: string): string[] {
  const targets: string[] = [];

  for (const match of body.matchAll(wikiLinkPattern)) {
    const target = (match[2] ?? '').split('|')[0]?.split('#')[0]?.trim() ?? '';
    const extension = /\.([A-Za-z0-9]+)$/.exec(target)?.[1]?.toLowerCase();

    if (target.length > 0 && (extension === undefined || extension === 'md')) {
      targets.push(stripMarkdownExtension(target));
    }
  }

  for (const match of body.matchAll(markdownLinkPattern)) {
    const target = (match[1] ?? '').split('#')[0] ?? '';

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
