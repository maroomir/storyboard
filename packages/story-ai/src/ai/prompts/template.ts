// A Mustache subset for prompt resources: `{{name}}` inserts a value verbatim (no escaping — prompts
// are plain text), `{{#name}}…{{/name}}` renders once for a truthy value or once per item of an
// array, `{{^name}}…{{/name}}` renders when the value is missing, empty or false, `{{> name}}`
// inserts a partial the calling module rendered in code, and `{{! … }}` is a comment. A tag that
// stands alone on its line takes the whole line with it, so conditional lines join exactly as a
// filtered `lines.join('\n')` would.

export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly TemplateValue[]
  | { readonly [key: string]: TemplateValue };

export type TemplateView = { readonly [key: string]: TemplateValue };

export type TemplatePartials = { readonly [name: string]: string };

type Node =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'partial'; readonly name: string; readonly standalone: boolean }
  | {
      readonly kind: 'section';
      readonly name: string;
      readonly inverted: boolean;
      readonly body: Node[];
    };

interface Tag {
  readonly sigil: '' | '#' | '^' | '/' | '>' | '!';
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly standalone: boolean;
}

const tagPattern = /\{\{\s*([#^/>!]?)\s*([^}]*?)\s*\}\}/g;

function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

// Widens a tag's span to the whole line when nothing but whitespace shares the line with it.
function scanTags(template: string): Tag[] {
  const tags: Tag[] = [];

  for (const match of template.matchAll(tagPattern)) {
    const sigil = match[1] as Tag['sigil'];
    const name = match[2] ?? '';
    let start = match.index ?? 0;
    let end = start + match[0].length;
    let standalone = false;

    if (sigil !== '') {
      const lineStart = template.lastIndexOf('\n', start - 1) + 1;
      const lineEndIndex = template.indexOf('\n', end);
      const lineEnd = lineEndIndex === -1 ? template.length : lineEndIndex;

      if (isBlank(template.slice(lineStart, start)) && isBlank(template.slice(end, lineEnd))) {
        standalone = true;
        start = lineStart;
        end = lineEndIndex === -1 ? lineEnd : lineEnd + 1;
      }
    }

    tags.push({ sigil, name, start, end, standalone });
  }

  return tags;
}

export class TemplateSyntaxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TemplateSyntaxError';
  }
}

function parse(template: string): Node[] {
  const tags = scanTags(template);
  const root: Node[] = [];
  const stack: { readonly name: string; readonly nodes: Node[] }[] = [{ name: '', nodes: root }];
  let cursor = 0;

  const current = (): Node[] => (stack[stack.length - 1] as { nodes: Node[] }).nodes;

  for (const tag of tags) {
    if (tag.start > cursor) {
      current().push({ kind: 'text', text: template.slice(cursor, tag.start) });
    }
    cursor = tag.end;

    switch (tag.sigil) {
      case '':
        current().push({ kind: 'variable', name: tag.name });
        break;
      case '>':
        current().push({ kind: 'partial', name: tag.name, standalone: tag.standalone });
        break;
      case '!':
        break;
      case '#':
      case '^': {
        const section: Node = {
          kind: 'section',
          name: tag.name,
          inverted: tag.sigil === '^',
          body: [],
        };
        current().push(section);
        stack.push({ name: tag.name, nodes: section.body });
        break;
      }
      case '/': {
        const open = stack.pop();

        if (open === undefined || stack.length === 0 || open.name !== tag.name) {
          throw new TemplateSyntaxError(`닫는 태그가 맞지 않습니다: {{/${tag.name}}}`);
        }
        break;
      }
    }
  }

  if (stack.length !== 1) {
    throw new TemplateSyntaxError(
      `닫히지 않은 섹션: {{#${(stack.pop() as { name: string }).name}}}`,
    );
  }

  if (cursor < template.length) {
    root.push({ kind: 'text', text: template.slice(cursor) });
  }

  return root;
}

function lookup(contexts: readonly TemplateValue[], name: string): TemplateValue {
  if (name === '.') {
    return contexts[contexts.length - 1];
  }

  const [head, ...rest] = name.split('.');

  for (let depth = contexts.length - 1; depth >= 0; depth -= 1) {
    const context = contexts[depth];

    if (
      context !== null &&
      typeof context === 'object' &&
      !Array.isArray(context) &&
      head !== undefined &&
      head in context
    ) {
      let value: TemplateValue = (context as TemplateView)[head];

      for (const key of rest) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return undefined;
        }
        value = (value as TemplateView)[key];
      }

      return value;
    }
  }

  return undefined;
}

function isTruthy(value: TemplateValue): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null && value !== false && value !== '';
}

function stringify(value: TemplateValue): string {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return '';
  }

  if (typeof value === 'object') {
    return Array.isArray(value) ? value.map(stringify).join('') : '';
  }

  return String(value);
}

function renderNodes(
  nodes: readonly Node[],
  contexts: readonly TemplateValue[],
  partials: TemplatePartials,
): string {
  let output = '';

  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        output += node.text;
        break;
      case 'variable':
        output += stringify(lookup(contexts, node.name));
        break;
      case 'partial': {
        const partial = partials[node.name];

        if (partial === undefined) {
          throw new TemplateSyntaxError(`정의되지 않은 partial: {{> ${node.name}}}`);
        }

        // A standalone partial line yields nothing at all when the partial is empty, so an optional
        // block leaves no blank line behind.
        if (partial.length > 0) {
          output += node.standalone ? `${partial}\n` : partial;
        }
        break;
      }
      case 'section': {
        const value = lookup(contexts, node.name);

        if (node.inverted) {
          if (!isTruthy(value)) {
            output += renderNodes(node.body, contexts, partials);
          }
          break;
        }

        if (!isTruthy(value)) {
          break;
        }

        const items = Array.isArray(value) ? value : [value];

        for (const item of items) {
          output += renderNodes(node.body, [...contexts, item], partials);
        }
        break;
      }
    }
  }

  return output;
}

export function renderTemplate(
  template: string,
  view: TemplateView,
  partials: TemplatePartials = {},
): string {
  return renderNodes(parse(template), [view], partials);
}
