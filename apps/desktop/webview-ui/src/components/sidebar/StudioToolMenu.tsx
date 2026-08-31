import React from 'react';

import type { StudioToolEntry } from '@webview/lib/studioTools';

export function StudioToolMenu({
  candidates,
  activeIndex,
  hasSelection,
  onPick,
}: {
  readonly candidates: readonly StudioToolEntry[];
  readonly activeIndex: number;
  readonly hasSelection: boolean;
  readonly onPick: (entry: StudioToolEntry) => void;
}): React.ReactElement | null {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <ul
      className="m-0 mb-2 flex list-none flex-col gap-0.5 rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editorWidget-background)] p-1"
      aria-label="도구 목록"
    >
      {candidates.map((entry, index) => (
        <li key={entry.tool}>
          <button
            type="button"
            className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs ${
              index === activeIndex
                ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]'
                : 'text-[var(--vscode-foreground)]'
            }`}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(entry);
            }}
          >
            <span className="font-medium">/{entry.command}</span>
            <span className="opacity-70">{entry.label}</span>
            <span className="ml-auto shrink-0 opacity-50">
              {entry.needsSelection && !hasSelection ? '구간 미선택' : entry.hint}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
