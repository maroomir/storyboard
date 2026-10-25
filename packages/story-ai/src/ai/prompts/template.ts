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

const tagPattern: RegExp = /\{\{\s*([#^/>!]?)\s*([^}]*?)\s*\}\}/g;

function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

function scanTags(template: string): Tag[] {
  const tags: Tag[] = [];

  for (const match of template.matchAll(tagPattern)) {
    const sigil: Tag['sigil'] = match[1] as Tag['sigil'];
    const name: string = match[2] ?? '';
    let start: number = match.index ?? 0;
    let end: number = start + match[0].length;
    let standalone: boolean = false;

    if (sigil !== '') {
      const lineStart: number = template.lastIndexOf('\n', start - 1) + 1;
      const lineEndIndex: number = template.indexOf('\n', end);
      const lineEnd: number = lineEndIndex === -1 ? template.length : lineEndIndex;

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
  const tags: Tag[] = scanTags(template);
  const root: Node[] = [];
  const stack: OpenSection[] = [{ name: '', nodes: root }];
  let cursor: number = 0;

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
        const open: OpenSection | undefined = stack.pop();

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

  for (let depth: number = contexts.length - 1; depth >= 0; depth -= 1) {
    const context: TemplateValue = contexts[depth];

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
  let renderedText: string = '';

  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        renderedText += node.text;
        break;
      case 'variable':
        renderedText += stringify(lookup(contexts, node.name));
        break;
      case 'partial': {
        const partial: string | undefined = partials[node.name];

        if (partial === undefined) {
          throw new TemplateSyntaxError(`정의되지 않은 partial: {{> ${node.name}}}`);
        }

        if (partial.length > 0) {
          renderedText += node.standalone ? `${partial}\n` : partial;
        }
        break;
      }
      case 'section': {
        const value: TemplateValue = lookup(contexts, node.name);

        if (node.inverted) {
          if (!isTruthy(value)) {
            renderedText += renderNodes(node.body, contexts, partials);
          }
          break;
        }

        if (!isTruthy(value)) {
          break;
        }

        const items: readonly TemplateValue[] = Array.isArray(value) ? value : [value];

        for (const item of items) {
          renderedText += renderNodes(node.body, [...contexts, item], partials);
        }
        break;
      }
    }
  }

  return renderedText;
}

interface OpenSection {
  readonly name: string;
  readonly nodes: Node[];
}

export function renderTemplate(
  template: string,
  view: TemplateView,
  partials: TemplatePartials = {},
): string {
  return renderNodes(parse(template), [view], partials);
}
