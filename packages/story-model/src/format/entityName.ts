export function normalizeEntityName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('ko').replace(/\s+/g, ' ');
}
