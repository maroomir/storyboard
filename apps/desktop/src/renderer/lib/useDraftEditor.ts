import { useCallback, useEffect, useRef, useState } from 'react';

import type { DraftDocument } from '@/shared/dto';

import { call } from '@/renderer/lib/call';
import { DraftAutosave, type AutosaveState } from '@/renderer/lib/draftAutosave';
import { extractErrorMessage } from '@storyboard/story-model/contracts';

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
  const autosave: React.MutableRefObject<DraftAutosave | undefined> = useRef<DraftAutosave>();

  useEffect(() => {
    if (stem === undefined) {
      setDocument(undefined);
      return;
    }

    let isCurrent: boolean = true;

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
      .catch((failure: unknown) => onError(extractErrorMessage(failure)));

    return (): void => {
      isCurrent = false;
      const closing: DraftAutosave | undefined = autosave.current;
      autosave.current = undefined;
      void closing
        ?.flush()
        .catch((failure: unknown) => onError(extractErrorMessage(failure)))
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
      const current: DraftAutosave | undefined = autosave.current;
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

  const change: (next: string) => void = useCallback((next: string) => {
    setText(next);
    autosave.current?.change(next);
  }, []);

  const flush: () => Promise<void> = useCallback(async () => {
    await autosave.current?.flush();
  }, []);

  const replaceWithAiEdit: (next: string) => Promise<void> = useCallback(
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

  const keepMine: () => void = useCallback(() => {
    setConflict(false);
    void autosave.current?.flush();
  }, []);

  const loadDisk: () => Promise<void> = useCallback(async () => {
    if (stem === undefined) {
      return;
    }
    const disk: DraftDocument = await call('draft.read', { stem });
    autosave.current?.acceptDisk(disk.body);
    setDocument(disk);
    setText(disk.body);
    setConflict(false);
  }, [stem]);

  return { document, text, saveState, hasConflict, change, flush, replaceWithAiEdit, keepMine, loadDisk };
}
