export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Splits text into chunks each within Telegram's message length limit (AC-06). Prefers to break
// on newlines so message structure survives; a single line longer than the limit is hard-split.
// Every returned chunk satisfies chunk.length <= maxLength.
export function splitText(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of text.split('\n')) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    flush();

    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    for (let offset = 0; offset < line.length; offset += maxLength) {
      const slice = line.slice(offset, offset + maxLength);
      if (slice.length === maxLength) {
        chunks.push(slice);
      } else {
        current = slice;
      }
    }
  }

  flush();

  return chunks;
}
