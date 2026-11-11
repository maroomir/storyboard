export function normalizeCardListText(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('ko')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function isSameStatementText(left: string, right: string): boolean {
  return normalizeCardListText(left) === normalizeCardListText(right);
}
