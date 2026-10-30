import { measureWidth, padEndToWidth, truncateToWidth, wrapToWidth } from '@/terminal/width';

export const minimumBoxWidth: number = 40;

const maximumBoxWidth: number = 100;

const minimumDescriptionWidth: number = 24;

export interface BoxOptions {
  readonly availableWidth: number;
  readonly title?: string;
  readonly innerWidth?: number;
  readonly paintFrame?: (text: string) => string;
  readonly paintTitle?: (text: string) => string;
}

export function renderBox(lines: readonly string[], options: BoxOptions): string[] {
  const paintFrame: (text: string) => string = options.paintFrame ?? identity;
  const paintTitle: (text: string) => string = options.paintTitle ?? identity;

  const wrapOverWide =
    (width: number): ((line: string) => string[]) =>
    (line: string): string[] =>
      measureWidth(line) <= width ? [line] : wrapToWidth(line, width);

  if (options.availableWidth < minimumBoxWidth) {
    const body: string[] = lines.flatMap(wrapOverWide(options.availableWidth));
    return options.title === undefined ? body : [paintTitle(options.title), ...body];
  }

  const widestAllowed: number = Math.min(options.availableWidth, maximumBoxWidth);
  const titleWidth: number = options.title === undefined ? 0 : measureWidth(options.title) + 4;
  const contentWidth: number = Math.max(titleWidth, ...lines.map(measureWidth));
  const innerWidth: number = Math.min(options.innerWidth ?? contentWidth, widestAllowed - 4);
  const body: string[] = lines.flatMap(wrapOverWide(innerWidth));

  const title: string =
    options.title === undefined ? '' : ` ${truncateToWidth(options.title, innerWidth - 2)} `;
  const top: string = `${paintFrame('╭─')}${paintTitle(title)}${paintFrame(
    `${'─'.repeat(innerWidth + 1 - measureWidth(title))}╮`,
  )}`;
  const bottom: string = paintFrame(`╰${'─'.repeat(innerWidth + 2)}╯`);
  const middle: string[] = body.map(
    (line) => `${paintFrame('│')} ${padEndToWidth(line, innerWidth)} ${paintFrame('│')}`,
  );

  return [top, ...middle, bottom];
}

export interface ColumnRow {
  readonly label: string;
  readonly description: string;
}

export interface ColumnOptions {
  readonly availableWidth: number;
  readonly indent?: number;
  readonly gap?: number;
  readonly maximumLabelWidth?: number;
  readonly labelWidth?: number;
}

export function renderColumns(rows: readonly ColumnRow[], options: ColumnOptions): string[] {
  const indent: string = ' '.repeat(options.indent ?? 2);
  const gap: number = options.gap ?? 2;
  const maximumLabelWidth: number = options.maximumLabelWidth ?? 34;
  const fittingLabels: number[] = rows
    .map((row) => measureWidth(row.label))
    .filter((w) => w <= maximumLabelWidth);
  const labelWidth: number = options.labelWidth ?? Math.max(0, ...fittingLabels);
  const descriptionStart: number = indent.length + labelWidth + gap;
  const descriptionWidth: number = options.availableWidth - descriptionStart;

  if (descriptionWidth < minimumDescriptionWidth) {
    return renderStackedRows(rows, indent, options.availableWidth);
  }

  return rows.flatMap((row) => {
    const wrapped: string[] = wrapToWidth(row.description, descriptionWidth);
    const hanging: string = ' '.repeat(descriptionStart);
    const continuation: string[] = wrapped.slice(1).map((line) => `${hanging}${line}`);

    if (measureWidth(row.label) > labelWidth) {
      return [
        ...wrapLabel(row.label, indent, options.availableWidth),
        ...wrapped.map((line) => `${hanging}${line}`),
      ];
    }

    return [
      `${indent}${padEndToWidth(row.label, labelWidth)}${' '.repeat(gap)}${wrapped[0] ?? ''}`,
      ...continuation,
    ];
  });
}

function renderStackedRows(rows: readonly ColumnRow[], indent: string, width: number): string[] {
  const descriptionIndent: string = `${indent}  `;

  return rows.flatMap((row) => [
    ...wrapLabel(row.label, indent, width),
    ...wrapToWidth(row.description, width - descriptionIndent.length).map(
      (line) => `${descriptionIndent}${line}`,
    ),
  ]);
}

function wrapLabel(label: string, indent: string, width: number): string[] {
  const continuationIndent: string = `${indent}  `;

  return wrapToWidth(label, width - continuationIndent.length).map(
    (line, index) => `${index === 0 ? indent : continuationIndent}${line}`,
  );
}

function identity(text: string): string {
  return text;
}
