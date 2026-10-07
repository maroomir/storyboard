// The BVT tables name files by glob so a row survives a rename inside its folder. Only the forms
// the tables use are supported — `**`, `*`, `?` and `{a,b}` — which keeps this free of a dependency
// the release job would otherwise have to trust.

function escapeRegExp(text) {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function globToRegExp(pattern) {
  let source = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (pattern.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 3;
    } else if (pattern.startsWith('**', index)) {
      source += '.*';
      index += 2;
    } else if (char === '*') {
      source += '[^/]*';
      index += 1;
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else if (char === '{') {
      const close = pattern.indexOf('}', index);
      if (close === -1) {
        throw new Error(`Unclosed brace in glob: ${pattern}`);
      }
      const choices = pattern.slice(index + 1, close).split(',').map(escapeRegExp);
      source += `(?:${choices.join('|')})`;
      index = close + 1;
    } else {
      source += escapeRegExp(char);
      index += 1;
    }
  }

  return new RegExp(`^${source}$`);
}

export function matchesGlob(pattern, filePath) {
  return globToRegExp(pattern).test(filePath);
}

export function matchesAnyGlob(patterns, filePath) {
  return patterns.some((pattern) => matchesGlob(pattern, filePath));
}

export function filterByGlobs(patterns, filePaths) {
  return filePaths.filter((filePath) => matchesAnyGlob(patterns, filePath));
}
