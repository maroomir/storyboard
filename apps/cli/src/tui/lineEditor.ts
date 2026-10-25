import { useInput, type Key } from 'ink';
import { useRef, useState } from 'react';

export interface LineEditorOptions {
  readonly isActive: boolean;
  readonly suggestions: readonly string[];
  readonly onSubmit: (line: string) => void;
  readonly onExit: () => void;
  readonly onToggleOutput?: () => void;
}

export interface HistorySearch {
  readonly query: string;
  readonly matchIndex?: number;
  readonly match?: string;
}

interface EditorLine {
  readonly value: string;
  readonly cursor: number;
}

export interface LineEditorState {
  readonly value: string;
  readonly cursor: number;
  readonly selectedSuggestion: number;
  readonly isSuggestionOpen: boolean;
  readonly search?: HistorySearch;
}

export function findHistoryMatch(
  history: readonly string[],
  query: string,
  beforeIndex: number = history.length,
): number | undefined {
  for (let index: number = Math.min(beforeIndex, history.length) - 1; index >= 0; index -= 1) {
    if ((history[index] ?? '').includes(query)) {
      return index;
    }
  }

  return undefined;
}

export function useLineEditor(options: LineEditorOptions): LineEditorState {
  const [line, setLine] = useState<EditorLine>({ value: '', cursor: 0 });
  const lineAheadOfRenderForKeyHandler: React.MutableRefObject<EditorLine> = useRef(line);
  const setLineNow = (next: EditorLine): void => {
    lineAheadOfRenderForKeyHandler.current = next;
    setLine(next);
  };
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(undefined);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [search, setSearch] = useState<HistorySearch | undefined>(undefined);
  const isSuggestionOpen: boolean =
    options.suggestions.length > 0 && !isDismissed && search === undefined;

  const searchFor = (query: string, beforeIndex?: number): void => {
    const matchIndex: number | undefined = findHistoryMatch(history, query, beforeIndex);
    setSearch(
      matchIndex === undefined ? { query } : { query, matchIndex, match: history[matchIndex] },
    );
  };

  const handleSearchKey = (current: HistorySearch, input: string, key: Key): void => {
    if (key.escape) {
      setSearch(undefined);
    } else if (key.return) {
      setSearch(undefined);
      if (current.match !== undefined) {
        replace(current.match);
      }
    } else if (key.ctrl && input === 'r') {
      searchFor(current.query, current.matchIndex);
    } else if (key.backspace || key.delete) {
      searchFor(current.query.slice(0, -1));
    } else if (input.length > 0 && !key.ctrl && !key.meta) {
      searchFor(current.query + input);
    }
  };

  const replace = (next: string): void => {
    setLineNow({ value: next, cursor: next.length });
    setSelectedSuggestion(0);
    setIsDismissed(false);
  };

  const edit = (next: string, nextCursor: number): void => {
    setLineNow({ value: next, cursor: nextCursor });
    setSelectedSuggestion(0);
    setIsDismissed(false);
  };

  useInput(
    (input, key) => {
      const { value, cursor } = lineAheadOfRenderForKeyHandler.current;
      if (key.ctrl && input === 'c') {
        options.onExit();
        return;
      }

      if (search !== undefined) {
        handleSearchKey(search, input, key);
        return;
      }

      if (key.ctrl && input === 'r') {
        searchFor('');
        return;
      }

      if (key.ctrl && input === 'o') {
        options.onToggleOutput?.();
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
        const nextIndex: number =
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
        const nextIndex: number = historyIndex + 1;
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
        const line: string = value;
        if (line.trim().length > 0) {
          setHistory((previous) => [...previous, line]);
        }
        setHistoryIndex(undefined);
        replace('');
        options.onSubmit(line);
        return;
      }

      if (key.leftArrow) {
        setLineNow({ value, cursor: Math.max(0, cursor - 1) });
        return;
      }

      if (key.rightArrow) {
        setLineNow({ value, cursor: Math.min(value.length, cursor + 1) });
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

  return {
    value: line.value,
    cursor: line.cursor,
    selectedSuggestion,
    isSuggestionOpen,
    ...(search === undefined ? {} : { search }),
  };
}
