import { measureWidth, padEndToWidth, truncateToWidth, wrapToWidth } from './width';

// 박스와 2열 표. 둘 다 줄 배열을 돌려주고 출력은 부르는 쪽이 한다. 칸 계산은 모두 width.ts 를
// 거치므로 한글이 섞여도 오른쪽 변과 둘째 열이 맞는다.

// Below this a frame eats more of the line than it gives back, so the content goes out unframed.
export const minimumBoxWidth = 40;

const maximumBoxWidth = 100;

// When the description column would be narrower than this, it moves under its label instead.
const minimumDescriptionWidth = 24;

export interface BoxOptions {
  // The terminal's columns; the box is as wide as its content needs, never wider than this.
  readonly availableWidth: number;
  readonly title?: string;
  // Sizes the box to this instead of its content, so stacked boxes line up.
  readonly innerWidth?: number;
  // Styles the frame characters, e.g. dimming them. Content keeps its own styling.
  readonly paintFrame?: (text: string) => string;
  readonly paintTitle?: (text: string) => string;
}

export function renderBox(lines: readonly string[], options: BoxOptions): string[] {
  const paintFrame = options.paintFrame ?? identity;
  const paintTitle = options.paintTitle ?? identity;

  if (options.availableWidth < minimumBoxWidth) {
    const body = lines.flatMap((line) => wrapToWidth(line, options.availableWidth));
    return options.title === undefined ? body : [paintTitle(options.title), ...body];
  }

  const widestAllowed = Math.min(options.availableWidth, maximumBoxWidth);
  const titleWidth = options.title === undefined ? 0 : measureWidth(options.title) + 4;
  const contentWidth = Math.max(titleWidth, ...lines.map(measureWidth));
  const innerWidth = Math.min(options.innerWidth ?? contentWidth, widestAllowed - 4);
  // Only an over-wide line is re-wrapped; wrapping trims, which would undo a caller's indentation.
  const body = lines.flatMap((line) =>
    measureWidth(line) <= innerWidth ? [line] : wrapToWidth(line, innerWidth),
  );

  const title =
    options.title === undefined ? '' : ` ${truncateToWidth(options.title, innerWidth - 2)} `;
  const top = `${paintFrame('╭─')}${paintTitle(title)}${paintFrame(
    `${'─'.repeat(innerWidth + 1 - measureWidth(title))}╮`,
  )}`;
  const bottom = paintFrame(`╰${'─'.repeat(innerWidth + 2)}╯`);
  const middle = body.map(
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
  // The label column never grows past this, so one long usage line cannot push every description
  // to the right edge; a longer label puts its description on the next line instead.
  readonly maximumLabelWidth?: number;
  // Fixes the label column, so several tables drawn apart still share one description column.
  readonly labelWidth?: number;
}

// A label column and a description column whose wrapped lines hang under the description start.
export function renderColumns(rows: readonly ColumnRow[], options: ColumnOptions): string[] {
  const indent = ' '.repeat(options.indent ?? 2);
  const gap = options.gap ?? 2;
  const maximumLabelWidth = options.maximumLabelWidth ?? 34;
  const fittingLabels = rows
    .map((row) => measureWidth(row.label))
    .filter((w) => w <= maximumLabelWidth);
  const labelWidth = options.labelWidth ?? Math.max(0, ...fittingLabels);
  const descriptionStart = indent.length + labelWidth + gap;
  const descriptionWidth = options.availableWidth - descriptionStart;

  if (descriptionWidth < minimumDescriptionWidth) {
    return renderStackedRows(rows, indent, options.availableWidth);
  }

  return rows.flatMap((row) => {
    const wrapped = wrapToWidth(row.description, descriptionWidth);
    const hanging = ' '.repeat(descriptionStart);
    const continuation = wrapped.slice(1).map((line) => `${hanging}${line}`);

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
  const descriptionIndent = `${indent}  `;

  return rows.flatMap((row) => [
    ...wrapLabel(row.label, indent, width),
    ...wrapToWidth(row.description, width - descriptionIndent.length).map(
      (line) => `${descriptionIndent}${line}`,
    ),
  ]);
}

// A usage line longer than the terminal wraps with its continuation indented under it.
function wrapLabel(label: string, indent: string, width: number): string[] {
  const continuationIndent = `${indent}  `;

  return wrapToWidth(label, width - continuationIndent.length).map(
    (line, index) => `${index === 0 ? indent : continuationIndent}${line}`,
  );
}

function identity(text: string): string {
  return text;
}
