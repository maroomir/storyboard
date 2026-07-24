export const manuscriptExportFormats = ['md', 'txt'] as const;
export type ManuscriptExportFormat = (typeof manuscriptExportFormats)[number];

export function toPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/\*\*/g, '')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/`/g, ''),
    )
    .join('\n');
}

export function renderManuscriptExport(markdown: string, format: ManuscriptExportFormat): string {
  return format === 'txt' ? toPlainText(markdown) : markdown;
}
