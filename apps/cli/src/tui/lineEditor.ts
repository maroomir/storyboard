import { useInput, type Key } from 'ink';
import { useRef, useState } from 'react';

export interface LineEditorOptions {
  readonly isActive: boolean;
  // The whole input line each suggestion would leave behind when taken.
  readonly suggestions: readonly string[];
  readonly onSubmit: (line: string) => void;
  readonly onExit: () => void;
  // Ctrl+O: show folded output in full, or fold it again.
  readonly onToggleOutput?: () => void;
}

export interface HistorySearch {
  readonly query: string;
  // Index into the history of the line that matches, if any does.
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
  // Suggestions exist and Esc has not closed them since the last edit.
  readonly isSuggestionOpen: boolean;
  // Set while Ctrl+R searches the history.
  readonly search?: HistorySearch;
}

// The newest line containing the query, older than `beforeIndex` when given — Ctrl+R pressed again
// steps back to the previous match, as in a shell.
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

// A small line editor on top of Ink's key stream: ↑/↓ move through the open suggestion list or
// the history, Tab takes a suggestion, Ctrl+R searches the history, Esc closes the list and then
// clears the line, Ctrl+C leaves. Enough for a prompt; not a text area.
export function useLineEditor(options: LineEditorOptions): LineEditorState {
  const [line, setLine] = useState<EditorLine>({ value: '', cursor: 0 });
  // NOTE: Keys can arrive faster than React re-renders and re-subscribes the handler (a CI runner
  // typed `draft show` as `draft how`), so a handler that read the line from its closure would
  // build on a value the previous key already replaced. The handler reads and writes this ref;
  // the state only drives rendering.
  const latestLine: React.MutableRefObject<EditorLine> = useRef(line);
  const setLineNow = (next: EditorLine): void => {
    latestLine.current = next;
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

  // While searching, keys edit the query; Enter takes the match into the line without running it.
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
      const { value, cursor } = latestLine.current;
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
