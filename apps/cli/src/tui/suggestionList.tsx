import { Box, Text } from 'ink';
import React from 'react';

import { measureWidth, padEndToWidth, truncateToWidth } from '@/terminal/width';

import type { InputSuggestion } from '@/tui/session';
import { useTuiTheme, type TuiTheme } from '@/tui/tuiTheme';

const visibleRows: number = 8;
const summaryPaddingColumns: number = 8;
const maximumTextWidth: number = 32;

export interface SuggestionListProps {
  readonly suggestions: readonly InputSuggestion[];
  readonly selectedIndex: number;
  readonly columns: number;
}

export function selectVisibleWindow(total: number, selectedIndex: number): [number, number] {
  const start: number = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleRows / 2)),
    Math.max(0, total - visibleRows),
  );
  return [start, Math.min(total, start + visibleRows)];
}

export function SuggestionList(props: SuggestionListProps): React.ReactElement {
  const theme: TuiTheme = useTuiTheme();
  const [start, end] = selectVisibleWindow(props.suggestions.length, props.selectedIndex);
  const textWidth: number = Math.min(
    maximumTextWidth,
    Math.max(...props.suggestions.map((suggestion) => measureWidth(suggestion.text))),
  );
  const summaryWidth: number = Math.max(0, props.columns - textWidth - summaryPaddingColumns);
  const hasMore: boolean = props.suggestions.length > visibleRows;

  return (
    <Box flexDirection="column" paddingX={2}>
      {props.suggestions.slice(start, end).map((suggestion, offset) => {
        const isSelected: boolean = start + offset === props.selectedIndex;
        return (
          <Text key={suggestion.line} color={isSelected ? theme.accent : undefined}>
            {isSelected ? '▸ ' : '  '}
            {padEndToWidth(truncateToWidth(suggestion.text, textWidth), textWidth)}
            {'  '}
            <Text color={theme.muted}>{truncateToWidth(suggestion.summary, summaryWidth)}</Text>
          </Text>
        );
      })}
      <Text color={theme.muted}>
        {'  ↑↓ 선택 · Tab 확정 · Esc 닫기'}
        {hasMore ? `  (${props.selectedIndex + 1}/${props.suggestions.length})` : ''}
      </Text>
    </Box>
  );
}
