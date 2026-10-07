// The golden run compares what the CLI wrote against a committed snapshot. Both sides pass through
// the same normalization, so only what the engine chose to write counts — not when, and not the
// ids it minted. Snapshots are stored raw (a frozen one is reopened as a workspace, and a file with
// `<timestamp>` in a date field would not parse).

const volatilePatterns = [
  // An ISO timestamp, also the tail of one that a context window cut in half.
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>'],
  [/\b\d{2}:\d{2}\.\d{3}Z/g, '<timestamp>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>'],
  [/sha256:[0-9a-f]{64}/g, 'sha256:<hash>'],
  [/storyboard@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, 'storyboard@<version>'],
];

export function normalizeGoldenText(text, replacements = []) {
  let normalized = text;
  for (const [literal, placeholder] of replacements) {
    normalized = normalized.split(literal).join(placeholder);
  }
  for (const [pattern, placeholder] of volatilePatterns) {
    normalized = normalized.replace(pattern, placeholder);
  }
  return normalized;
}

const textExtensions = new Set(['.md', '.json', '.yaml', '.yml', '.card', '.txt', '.gitignore']);

export function isTextFile(filePath) {
  const dot = filePath.lastIndexOf('.');
  const extension = dot === -1 ? '' : filePath.slice(dot);
  return textExtensions.has(extension) || filePath.endsWith('/.gitignore');
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split('\n').length;
}

// `actual` and `expected` map a relative path to a Buffer. The verdict per path is one of
// `identical`, `changed`, `added` (only in actual) or `removed` (only in expected).
export function compareGoldenFiles(actual, expected, replacements = []) {
  const paths = [...new Set([...actual.keys(), ...expected.keys()])].sort();
  const entries = [];

  for (const filePath of paths) {
    const actualBytes = actual.get(filePath);
    const expectedBytes = expected.get(filePath);

    if (actualBytes === undefined) {
      entries.push({ path: filePath, verdict: 'removed' });
      continue;
    }
    if (expectedBytes === undefined) {
      entries.push({ path: filePath, verdict: 'added' });
      continue;
    }

    if (!isTextFile(filePath)) {
      entries.push({ path: filePath, verdict: actualBytes.equals(expectedBytes) ? 'identical' : 'changed' });
      continue;
    }

    const actualText = normalizeGoldenText(actualBytes.toString('utf8'), replacements);
    const expectedText = normalizeGoldenText(expectedBytes.toString('utf8'), replacements);
    if (actualText === expectedText) {
      entries.push({ path: filePath, verdict: 'identical' });
    } else {
      entries.push({
        path: filePath,
        verdict: 'changed',
        detail: `${countLines(expectedText)} → ${countLines(actualText)} lines`,
      });
    }
  }

  return entries;
}

export function formatGoldenReport(scenarioId, entries, allowedPaths = []) {
  const differing = entries.filter((entry) => entry.verdict !== 'identical');
  const lines = [];

  for (const entry of differing) {
    const isAllowed = allowedPaths.includes(entry.path);
    const mark = isAllowed ? '~' : '✗';
    const detail = entry.detail === undefined ? '' : `  (${entry.detail})`;
    lines.push(`  ${mark} ${entry.verdict.padEnd(9)} ${entry.path}${detail}`);
  }

  const identical = entries.length - differing.length;
  const header = `${scenarioId}: ${identical} identical, ${differing.length} differing`;
  return [header, ...lines].join('\n');
}

export function hasUnexpectedDifference(entries, allowedPaths = []) {
  return entries.some((entry) => entry.verdict !== 'identical' && !allowedPaths.includes(entry.path));
}
