import { useInput } from 'ink';
import { useState } from 'react';

export interface LineEditorOptions {
  readonly isActive: boolean;
  readonly suggestions: readonly string[];
  readonly onSubmit: (line: string) => void;
  readonly onExit: () => void;
}

export interface LineEditorState {
  readonly value: string;
  readonly cursor: number;
  readonly selectedSuggestion: number;
}

// A small line editor on top of Ink's key stream: history with ↑/↓, suggestion pick with Tab,
// Esc clears, Ctrl+C leaves. Enough for a prompt; not a text area.
export function useLineEditor(options: LineEditorOptions): LineEditorState {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  const replace = (next: string): void => {
    setValue(next);
    setCursor(next.length);
    setSelectedSuggestion(0);
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        options.onExit();
        return;
      }

      if (key.escape) {
        replace('');
        setHistoryIndex(undefined);
        return;
      }

      if (key.tab && options.suggestions.length > 0) {
        const picked = options.suggestions[selectedSuggestion] ?? options.suggestions[0] ?? '';
        replace(`${picked} `);
        return;
      }

      if (key.upArrow) {
        if (options.suggestions.length > 1) {
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
        if (options.suggestions.length > 1) {
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
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
        setSelectedSuggestion(0);
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        setValue(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
        setSelectedSuggestion(0);
      }
    },
    { isActive: options.isActive },
  );

  return { value, cursor, selectedSuggestion };
}
