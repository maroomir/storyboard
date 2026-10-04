import { useInput } from 'ink';
import { useState } from 'react';

export interface LineEditorOptions {
  readonly isActive: boolean;
  // The whole input line each suggestion would leave behind when taken.
  readonly suggestions: readonly string[];
  readonly onSubmit: (line: string) => void;
  readonly onExit: () => void;
}

export interface LineEditorState {
  readonly value: string;
  readonly cursor: number;
  readonly selectedSuggestion: number;
  // Suggestions exist and Esc has not closed them since the last edit.
  readonly isSuggestionOpen: boolean;
}

// A small line editor on top of Ink's key stream: ↑/↓ move through the open suggestion list or
// the history, Tab takes a suggestion, Esc closes the list and then clears the line, Ctrl+C
// leaves. Enough for a prompt; not a text area.
export function useLineEditor(options: LineEditorOptions): LineEditorState {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const isSuggestionOpen = options.suggestions.length > 0 && !isDismissed;

  const replace = (next: string): void => {
    setValue(next);
    setCursor(next.length);
    setSelectedSuggestion(0);
    setIsDismissed(false);
  };

  const edit = (next: string, nextCursor: number): void => {
    setValue(next);
    setCursor(nextCursor);
    setSelectedSuggestion(0);
    setIsDismissed(false);
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        options.onExit();
        return;
      }

      if (key.escape) {
        if (isSuggestionOpen) {
          setIsDismissed(true);
          return;
        }
        replace('');
        setHistoryIndex(undefined);
        return;
      }

      if (key.tab && isSuggestionOpen) {
        replace(options.suggestions[selectedSuggestion] ?? options.suggestions[0] ?? value);
        return;
      }

      if (key.upArrow) {
        if (isSuggestionOpen && options.suggestions.length > 1) {
          setSelectedSuggestion(
            (index) => (index + options.suggestions.length - 1) % options.suggestions.length,
          );
          return;
        }
        if (history.length === 0) {
          return;
        }
        const nextIndex =
          historyIndex === undefined ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        replace(history[nextIndex] ?? '');
        return;
      }

      if (key.downArrow) {
        if (isSuggestionOpen && options.suggestions.length > 1) {
          setSelectedSuggestion((index) => (index + 1) % options.suggestions.length);
          return;
        }
        if (historyIndex === undefined) {
          return;
        }
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) {
          setHistoryIndex(undefined);
          replace('');
          return;
        }
        setHistoryIndex(nextIndex);
        replace(history[nextIndex] ?? '');
        return;
      }

      if (key.return) {
        const line = value;
        if (line.trim().length > 0) {
          setHistory((previous) => [...previous, line]);
        }
        setHistoryIndex(undefined);
        replace('');
        options.onSubmit(line);
        return;
      }

      if (key.leftArrow) {
        setCursor((position) => Math.max(0, position - 1));
        return;
      }

      if (key.rightArrow) {
        setCursor((position) => Math.min(value.length, position + 1));
        return;
      }

      if (key.backspace || key.delete) {
        if (cursor === 0) {
          return;
        }
        edit(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        edit(value.slice(0, cursor) + input + value.slice(cursor), cursor + input.length);
      }
    },
    { isActive: options.isActive },
  );

  return { value, cursor, selectedSuggestion, isSuggestionOpen };
}
