import { useCallback, useEffect, useRef, useState } from 'react';

import type { DraftDocument } from '@/shared/dto';

import { call, messageOf } from './call';
import { DraftAutosave, type AutosaveState } from './draftAutosave';

export interface DraftEditor {
  readonly document: DraftDocument | undefined;
  readonly text: string;
  readonly saveState: AutosaveState;
  readonly hasConflict: boolean;
  change(text: string): void;
  flush(): Promise<void>;
  replaceWithAiEdit(text: string): Promise<void>;
  keepMine(): void;
  loadDisk(): Promise<void>;
}

// One scene's draft in the editor. Switching scenes flushes the pending save and ends the editing
// session, which is what turns a stretch of typing into one version in the history.
export function useDraftEditor(
  stem: string | undefined,
  changeSequence: number,
  changedStems: readonly string[],
  onError: (message: string) => void,
): DraftEditor {
  const [document, setDocument] = useState<DraftDocument>();
  const [text, setText] = useState('');
  const [saveState, setSaveState] = useState<AutosaveState>('saved');
  const [hasConflict, setConflict] = useState(false);
  const autosave = useRef<DraftAutosave>();

  useEffect(() => {
    if (stem === undefined) {
      setDocument(undefined);
      return;
    }

    let isCurrent = true;

    void call('draft.read', { stem })
      .then((loaded) => {
        if (!isCurrent) {
          return;
        }
        setDocument(loaded);
        setText(loaded.body);
        setConflict(false);
        autosave.current = new DraftAutosave(
          loaded.body,
          async (body) => {
            await call('draft.save', { stem, body, reason: 'autosave' });
          },
          setSaveState,
        );
      })
      .catch((failure: unknown) => onError(messageOf(failure)));

    return () => {
      isCurrent = false;
      const closing = autosave.current;
      autosave.current = undefined;
      void closing
        ?.flush()
        .catch((failure: unknown) => onError(messageOf(failure)))
        .finally(() => {
          closing.dispose();
          void call('draft.endSession', { stem });
        });
    };
  }, [stem]);

  useEffect(() => {
    if (stem === undefined || !changedStems.includes(stem) || autosave.current === undefined) {
      return;
    }

    void call('draft.read', { stem }).then((disk) => {
      const current = autosave.current;
      if (current === undefined) {
        return;
      }

      switch (current.classifyDiskChange(disk.body)) {
        case 'echo':
          setDocument(disk);
          return;
        case 'reload':
          current.acceptDisk(disk.body);
          setDocument(disk);
          setText(disk.body);
          return;
        case 'conflict':
          setConflict(true);
      }
    });
  }, [changeSequence]);

  const change = useCallback((next: string) => {
    setText(next);
    autosave.current?.change(next);
  }, []);

  const flush = useCallback(async () => {
    await autosave.current?.flush();
  }, []);

  const replaceWithAiEdit = useCallback(
    async (next: string) => {
      if (stem === undefined) {
        return;
      }
      await call('draft.save', { stem, body: next, reason: 'ai-edit' });
      autosave.current?.acceptDisk(next);
      setText(next);
    },
    [stem],
  );

  const keepMine = useCallback(() => {
    setConflict(false);
    void autosave.current?.flush();
  }, []);

  const loadDisk = useCallback(async () => {
    if (stem === undefined) {
      return;
    }
    const disk = await call('draft.read', { stem });
    autosave.current?.acceptDisk(disk.body);
    setDocument(disk);
    setText(disk.body);
    setConflict(false);
  }, [stem]);

  return { document, text, saveState, hasConflict, change, flush, replaceWithAiEdit, keepMine, loadDisk };
}
