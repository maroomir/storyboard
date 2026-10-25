export type NotionRecord = { readonly [key: string]: unknown };

export interface NotionBlockNode {
  readonly block: NotionRecord;
  readonly children: readonly NotionBlockNode[];
}

export type NotionChildReference =
  | { readonly kind: 'page'; readonly id: string; readonly title: string }
  | { readonly kind: 'database'; readonly id: string; readonly title: string };

const notionIdPattern: RegExp = /[0-9a-f]{32}/i;
const listIndent: string = '  ';

export function asNotionRecord(value: unknown): NotionRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as NotionRecord)
    : undefined;
}

function asRecordList(value: unknown): NotionRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record: NotionRecord | undefined = asNotionRecord(item);
        return record === undefined ? [] : [record];
      })
    : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeNotionId(value: string): string {
  return value.replace(/-/g, '').toLowerCase();
}

export function parseNotionPageId(pageUrl: string): string | undefined {
  let url: URL;

  try {
    url = new URL(pageUrl);
  } catch {
    return undefined;
  }

  const peeked: string | null = url.searchParams.get('p');
  const peekedId: RegExpExecArray | null | undefined = peeked === null ? undefined : notionIdPattern.exec(normalizeNotionId(peeked));

  if (peekedId) {
    return peekedId[0].toLowerCase();
  }

  const lastSegment: string = url.pathname.split('/').filter((segment) => segment.length > 0).pop() ?? '';
  const compact: string = normalizeNotionId(lastSegment);

  return compact.length >= 32 && /^[0-9a-f]{32}$/.test(compact.slice(-32))
    ? compact.slice(-32)
    : undefined;
}

export function canonicalNotionPageUrl(pageUrl: string): string {
  const pageId: string | undefined = parseNotionPageId(pageUrl);

  return pageId === undefined ? pageUrl : `https://www.notion.so/${pageId}`;
}

export function isNotionUrl(location: string): boolean {
  try {
    const { protocol, hostname } = new URL(location);
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      /(^|\.)notion\.(so|site|com)$/i.test(hostname)
    );
  } catch {
    return false;
  }
}

export function notionRichText(value: unknown): string {
  return asRecordList(value)
    .map((part) => asText(part.plain_text))
    .join('');
}

function blockType(block: NotionRecord): string {
  return asText(block.type);
}

function blockPayload(block: NotionRecord): NotionRecord {
  return asNotionRecord(block[blockType(block)]) ?? {};
}

function blockText(block: NotionRecord): string {
  return notionRichText(blockPayload(block).rich_text);
}

function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => (line.length > 0 ? `${prefix}${line}` : line));
}

function renderListItem(marker: string, node: NotionBlockNode): string[] {
  return [`${marker} ${blockText(node.block)}`, ...indent(renderNodes(node.children), listIndent)];
}

function renderTableRow(block: NotionRecord): string {
  const cells: unknown[] = Array.isArray(blockPayload(block).cells)
    ? (blockPayload(block).cells as unknown[])
    : [];

  return `| ${cells.map((cell) => notionRichText(cell)).join(' | ')} |`;
}

function renderNode(node: NotionBlockNode): string[] {
  const { block } = node;
  const text: string = blockText(block);
  const children: string[] = renderNodes(node.children);

  switch (blockType(block)) {
    case 'paragraph':
      return [text, ...indent(children, listIndent)];
    case 'heading_1':
      return [`# ${text}`, ...children];
    case 'heading_2':
      return [`## ${text}`, ...children];
    case 'heading_3':
      return [`### ${text}`, ...children];
    case 'bulleted_list_item':
    case 'toggle':
      return renderListItem('-', node);
    case 'numbered_list_item':
      return renderListItem('1.', node);
    case 'to_do':
      return renderListItem(blockPayload(block).checked === true ? '- [x]' : '- [ ]', node);
    case 'quote':
    case 'callout':
      return [`> ${text}`, ...indent(children, '> ')];
    case 'code':
      return ['```', text, '```'];
    case 'divider':
      return ['---'];
    case 'table_row':
      return [renderTableRow(block)];
    case 'table':
    case 'column_list':
    case 'column':
    case 'synced_block':
      return children;
    default:
      return [];
  }
}

function renderNodes(nodes: readonly NotionBlockNode[]): string[] {
  return nodes.flatMap((node) => renderNode(node));
}

export function renderNotionBlocks(nodes: readonly NotionBlockNode[]): string {
  return renderNodes(nodes)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walk(nodes: readonly NotionBlockNode[], visit: (block: NotionRecord) => void): void {
  for (const node of nodes) {
    visit(node.block);
    walk(node.children, visit);
  }
}

export function listNotionChildren(nodes: readonly NotionBlockNode[]): NotionChildReference[] {
  const children: NotionChildReference[] = [];

  walk(nodes, (block) => {
    const type: string = blockType(block);
    const id: string = asText(block.id);

    if ((type === 'child_page' || type === 'child_database') && id.length > 0) {
      children.push({
        kind: type === 'child_page' ? 'page' : 'database',
        id: normalizeNotionId(id),
        title: asText(blockPayload(block).title),
      });
    }
  });

  return children;
}

function linkedIdsInRichText(value: unknown): string[] {
  const ids: string[] = [];

  for (const part of asRecordList(value)) {
    const mention: NotionRecord | undefined = asNotionRecord(part.mention);
    const mentionedPage: NotionRecord | undefined = asNotionRecord(mention?.page);

    if (asText(mention?.type) === 'page' && asText(mentionedPage?.id).length > 0) {
      ids.push(normalizeNotionId(asText(mentionedPage?.id)));
      continue;
    }

    const href: string = asText(part.href);
    const isInternal: boolean = href.startsWith('/') || isNotionUrl(href);
    const linkedId: RegExpExecArray | null = isInternal ? notionIdPattern.exec(normalizeNotionId(href)) : null;

    if (linkedId) {
      ids.push(linkedId[0].toLowerCase());
    }
  }

  return ids;
}

export function listNotionLinkedPageIds(nodes: readonly NotionBlockNode[]): string[] {
  const ids: string[] = [];

  walk(nodes, (block) => {
    const payload: NotionRecord = blockPayload(block);

    if (blockType(block) === 'link_to_page' && asText(payload.page_id).length > 0) {
      ids.push(normalizeNotionId(asText(payload.page_id)));
    }

    ids.push(...linkedIdsInRichText(payload.rich_text));
  });

  return [...new Set(ids)];
}

export function notionPageTitle(page: NotionRecord): string {
  for (const property of Object.values(asNotionRecord(page.properties) ?? {})) {
    const record: NotionRecord | undefined = asNotionRecord(property);

    if (asText(record?.type) === 'title') {
      return notionRichText(record?.title).trim();
    }
  }

  return '';
}

function renderPropertyValue(property: NotionRecord): string {
  const type: string = asText(property.type);
  const value: unknown = property[type];

  switch (type) {
    case 'rich_text':
      return notionRichText(value);
    case 'select':
    case 'status':
      return asText(asNotionRecord(value)?.name);
    case 'multi_select':
      return asRecordList(value)
        .map((option) => asText(option.name))
        .join(', ');
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'checkbox':
      return value === true ? '예' : value === false ? '아니오' : '';
    case 'date':
      return [asText(asNotionRecord(value)?.start), asText(asNotionRecord(value)?.end)]
        .filter((part) => part.length > 0)
        .join(' ~ ');
    case 'url':
      return asText(value);
    default:
      return '';
  }
}

export function renderNotionProperties(page: NotionRecord): string {
  return Object.entries(asNotionRecord(page.properties) ?? {})
    .flatMap(([name, property]) => {
      const record: NotionRecord | undefined = asNotionRecord(property);
      const value: string = record === undefined ? '' : renderPropertyValue(record).trim();

      return value.length > 0 ? [`- ${name}: ${value}`] : [];
    })
    .join('\n');
}
