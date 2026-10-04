import { Box, Text, useInput } from 'ink';
import React, { useMemo, useState } from 'react';

import { measureWidth, wrapToWidth } from '@/terminal/width';

import { useTuiTheme } from './tuiTheme';

export interface DraftReaderProps {
  readonly title: string;
  readonly body: string;
  readonly columns: number;
  readonly rows: number;
  readonly onClose: () => void;
}

export type ReaderLineKind = 'dialogue' | 'separator' | 'prose' | 'blank';

// Spoken lines open with a quote; a scene break is a line of only *, - or ~ marks.
export function classifyReaderLine(line: string): ReaderLineKind {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return 'blank';
  }
  if (/^[*\-~·\s]{3,}$/.test(trimmed)) {
    return 'separator';
  }
  return /^["“「『'‘]/.test(trimmed) ? 'dialogue' : 'prose';
}

// Prose counts the way Korean manuscripts do: characters without spaces.
export function countManuscriptCharacters(body: string): number {
  return body.replace(/\s/g, '').length;
}

export interface ReaderLine {
  readonly text: string;
  readonly kind: ReaderLineKind;
}

// Paragraphs wrapped to the reader's width, each wrapped line keeping its paragraph's kind.
export function layoutReaderLines(body: string, width: number): ReaderLine[] {
  return body.split('\n').flatMap((paragraph): ReaderLine[] => {
    const kind = classifyReaderLine(paragraph);
    return kind === 'blank'
      ? [{ text: '', kind }]
      : wrapToWidth(paragraph, width).map((text) => ({ text, kind }));
  });
}

// The rows the reader keeps for its frame, title and key line.
const readerChromeRows = 5;

export function DraftReader(props: DraftReaderProps): React.ReactElement {
  const theme = useTuiTheme();
  const pageRows = Math.max(5, props.rows - readerChromeRows);
  const lines = useMemo(
    () => layoutReaderLines(props.body, Math.max(20, props.columns - 4)),
    [props.body, props.columns],
  );
  const lastTop = Math.max(0, lines.length - pageRows);
  const [top, setTop] = useState(0);
  const scrollTo = (next: number): void => setTop(Math.min(lastTop, Math.max(0, next)));

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      props.onClose();
    } else if (key.downArrow || input === 'j') {
      scrollTo(top + 1);
    } else if (key.upArrow || input === 'k') {
      scrollTo(top - 1);
    } else if (key.pageDown || input === ' ') {
      scrollTo(top + pageRows);
    } else if (key.pageUp || input === 'b') {
      scrollTo(top - pageRows);
    } else if (input === 'g') {
      scrollTo(0);
    } else if (input === 'G') {
      scrollTo(lastTop);
    }
  });

  const colorOf = (kind: ReaderLineKind): string | undefined =>
    kind === 'dialogue' ? theme.accent : kind === 'separator' ? theme.muted : undefined;
  const position = lines.length <= pageRows ? '전체' : `${Math.round((top / lastTop) * 100)}%`;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.muted} paddingX={1}>
      <Text>
        <Text bold>{props.title}</Text>
        <Text color={theme.muted}>
          {' '}
          · {countManuscriptCharacters(props.body).toLocaleString()}자 · {position}
        </Text>
      </Text>
      {lines.slice(top, top + pageRows).map((line, index) => (
        <Text key={`${top + index}`} color={colorOf(line.kind)}>
          {line.kind === 'separator'
            ? ' '.repeat(
                Math.max(0, Math.floor((props.columns - 4 - measureWidth(line.text)) / 2)),
              ) + line.text
            : line.text}
        </Text>
      ))}
      <Text color={theme.muted}>↑↓ 한 줄 · Space/b 한 쪽 · g/G 처음/끝 · q 닫기</Text>
    </Box>
  );
}
