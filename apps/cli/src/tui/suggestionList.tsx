import { Box, Text } from 'ink';
import React from 'react';

import { measureWidth, padEndToWidth, truncateToWidth } from '@/terminal/width';

import type { InputSuggestion } from './session';

// Enough rows to see the neighbourhood of the selection without pushing the log off the screen.
const visibleRows = 8;
const maximumTextWidth = 32;

export interface SuggestionListProps {
  readonly suggestions: readonly InputSuggestion[];
  readonly selectedIndex: number;
  readonly columns: number;
}

// The window scrolls with the selection, so ↓ past the last visible row keeps it in view.
export function selectVisibleWindow(total: number, selectedIndex: number): [number, number] {
  const start = Math.min(
    Math.max(0, selectedIndex - Math.floor(visibleRows / 2)),
    Math.max(0, total - visibleRows),
  );
  return [start, Math.min(total, start + visibleRows)];
}

export function SuggestionList(props: SuggestionListProps): React.ReactElement {
  const [start, end] = selectVisibleWindow(props.suggestions.length, props.selectedIndex);
  const textWidth = Math.min(
    maximumTextWidth,
    Math.max(...props.suggestions.map((suggestion) => measureWidth(suggestion.text))),
  );
  // Two columns of padding, the marker and the gap before the summary.
  const summaryWidth = Math.max(0, props.columns - textWidth - 8);
  const hasMore = props.suggestions.length > visibleRows;

  return (
    <Box flexDirection="column" paddingX={2}>
      {props.suggestions.slice(start, end).map((suggestion, offset) => {
        const isSelected = start + offset === props.selectedIndex;
        return (
          <Text key={suggestion.line} color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '▸ ' : '  '}
            {padEndToWidth(truncateToWidth(suggestion.text, textWidth), textWidth)}
            {'  '}
            <Text color="gray">{truncateToWidth(suggestion.summary, summaryWidth)}</Text>
          </Text>
        );
      })}
      <Text color="gray">
        {'  ↑↓ 선택 · Tab 확정 · Esc 닫기'}
        {hasMore ? `  (${props.selectedIndex + 1}/${props.suggestions.length})` : ''}
      </Text>
    </Box>
  );
}
