export function curlDialogueQuotes(text: string): string {
  return text.replace(/"([^"\n]+)"/g, '“$1”');
}
