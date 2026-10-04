#!/usr/bin/env node
// PreToolUse hook: refuses a `gh issue|pr|api|release|gist` or `git commit` Bash call whose text
// (or --body-file / -F file) carries a Notion id, a personal link, a local home path, a token
// or an e-mail address. Policy: .claude/rules/public-posts.md
import { readFileSync } from 'node:fs';

const ALLOWED_EMAILS = new Set(['maroomir@gmail.com', 'noreply@anthropic.com']);

const leakPatterns = [
  { label: 'Notion id (32 hex)', regex: /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i },
  {
    label: 'Notion id (UUID)',
    regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  },
  { label: 'Notion link', regex: /notion\.(?:so|site|com)\/(?!<|\?{2,}|…|\.\.\.)[^\s'"`)]+/i },
  { label: 'personal Notion site', regex: /[a-z0-9-]+\.notion\.site/i },
  { label: 'local home path', regex: /(?:\/Users\/|\/home\/|C:\\Users\\)(?!<)[A-Za-z0-9._-]+/ },
  {
    label: 'token',
    regex: /\b(?:ntn_|secret_|sk-|ghp_|gho_|github_pat_|xox[bp]-)[A-Za-z0-9_-]{16,}/,
  },
];

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const publishingCommandPattern =
  /\b(?:gh\s+(?:issue|pr)\s+(?:create|edit|comment|review|close|merge)\b|gh\s+(?:release|gist)\s+(?:create|edit)\b|gh\s+api\b|git\s+commit\b)/;
const apiWritePattern =
  /(?:-X|--method)[\s=]+(?:POST|PATCH|PUT)\b|\s(?:-f|-F|--field|--raw-field)\s+(?!query=)/i;
// NOTE: scratchpad and temp paths carry a session UUID; they are never part of a post.
const tempPathPattern = /\/(?:private\/)?(?:tmp|var\/folders)\/\S*/g;
const bodyFileArgPattern = /(?:--body-file|--notes-file|-F|--file)(?:\s+|=)("[^"]+"|'[^']+'|\S+)/g;

function readStdin() {
  return readFileSync(0, 'utf8');
}

function collectPublishedText(command) {
  const publishedPart = command.slice(command.search(publishingCommandPattern));
  const fileTexts = [];

  for (const match of publishedPart.matchAll(bodyFileArgPattern)) {
    const filePath = match[1].replace(/^['"]|['"]$/g, '');
    if (filePath === '-') continue;
    try {
      fileTexts.push(readFileSync(filePath, 'utf8'));
    } catch {
      // NOTE: `-F key=value` on `gh api` is a field, not a file; nothing to read.
    }
  }

  const commandText = publishedPart.replace(bodyFileArgPattern, '').replace(tempPathPattern, '');
  return [commandText, ...fileTexts].join('\n');
}

function findLeaks(text) {
  const leaks = leakPatterns.filter(({ regex }) => regex.test(text)).map(({ label }) => label);
  const foreignEmails = [...text.matchAll(emailPattern)].map(([email]) => email.toLowerCase());
  if (foreignEmails.some((email) => !ALLOWED_EMAILS.has(email))) leaks.push('e-mail address');
  return leaks;
}

const input = JSON.parse(readStdin());
const command = input.tool_input?.command ?? '';

function isPublishingCommand(command) {
  const start = command.search(publishingCommandPattern);
  if (start < 0) return false;
  const publishedPart = command.slice(start);
  if (!/^gh\s+api\b/.test(publishedPart)) return true;
  if (/^gh\s+api\s+graphql\b/.test(publishedPart)) return /\bmutation\b/.test(publishedPart);
  return apiWritePattern.test(publishedPart);
}

if (isPublishingCommand(command)) {
  const leaks = findLeaks(collectPublishedText(command));
  if (leaks.length > 0) {
    process.stderr.write(
      `공개 글에 개인정보가 들어 있어 막았습니다: ${leaks.join(', ')}.\n` +
        `'<Notion 페이지 URL>', '<id>', '~/…' 같은 자리표시자로 가린 뒤 다시 올리세요 ` +
        `(.claude/rules/public-posts.md).\n`,
    );
    process.exit(2);
  }
}
