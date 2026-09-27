import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { RunSnapshot, SceneNotes, TocScene, WorkspaceOverview } from '@/shared/dto';

import type { WorkspaceChange } from '@/renderer/lib/workspaceChange';
import { MarginNotes } from '@/renderer/components/MarginNotes';
import { TableOfContents } from '@/renderer/components/TableOfContents';
import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';
import { hasSelection, replaceSelection, type TextSelection } from '@/renderer/lib/selectionEdit';
import { useDraftEditor } from '@/renderer/lib/useDraftEditor';

interface DeskProps {
  readonly overview: WorkspaceOverview;
  readonly run: RunSnapshot | undefined;
  readonly change: WorkspaceChange;
  readonly requestedStem: string | undefined;
  readonly onError: (message: string) => void;
  readonly onOpenDrawer: () => void;
}

function allScenes(overview: WorkspaceOverview): TocScene[] {
  return overview.chapters.flatMap((chapter) => [...chapter.scenes]);
}

export function Desk(props: DeskProps): JSX.Element {
  const { t, language } = useI18n();
  const scenes = allScenes(props.overview);
  const [selectedStem, setSelectedStem] = useState<string | undefined>(props.requestedStem ?? scenes[0]?.stem);
  const [notes, setNotes] = useState<SceneNotes>();
  const editor = useDraftEditor(selectedStem, props.change.sequence, props.change.draftStems, props.onError);
  const selectedScene = scenes.find((scene) => scene.stem === selectedStem);
  const isReadOnly = (props.run !== undefined && props.run.status !== 'idle') || props.overview.foreignLock !== undefined;

  useEffect(() => {
    if (props.requestedStem !== undefined) {
      setSelectedStem(props.requestedStem);
    }
  }, [props.requestedStem]);

  useEffect(() => {
    if (selectedStem === undefined && scenes[0] !== undefined) {
      setSelectedStem(scenes[0].stem);
    }
  }, [scenes.length]);

  useEffect(() => {
    if (selectedStem === undefined) {
      setNotes(undefined);
      return;
    }
    void call('scene.notes', { stem: selectedStem })
      .then(setNotes)
      .catch((failure: unknown) => props.onError(messageOf(failure)));
  }, [selectedStem, props.change.sequence, props.run?.status]);

  const writeScene = async (): Promise<void> => {
    if (selectedStem === undefined) {
      return;
    }
    try {
      await editor.flush();
      await call('run.generateScene', { stem: selectedStem, force: editor.document?.exists === true });
      props.onOpenDrawer();
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  if (scenes.length === 0) {
    return (
      <main className="centered">
        <p className="muted" style={{ maxWidth: 420, textAlign: 'center' }}>
          {t('desk.noScenes')}
        </p>
        <button type="button" className="button button-primary" onClick={props.onOpenDrawer}>
          {t('run.start')}
        </button>
      </main>
    );
  }

  const readOnlyReason =
    props.overview.foreignLock !== undefined
      ? t('desk.readOnlyForeign', { message: props.overview.foreignLock.message })
      : isReadOnly
        ? t('desk.readOnlyRun')
        : undefined;

  return (
    <div className="desk">
      <TableOfContents overview={props.overview} selectedStem={selectedStem} onSelect={setSelectedStem} />
      <main className="page">
        {readOnlyReason === undefined ? null : (
          <div className="banner" role="status">
            {readOnlyReason}
          </div>
        )}
        {editor.hasConflict ? (
          <div className="banner" role="alert">
            <span>{t('desk.externalChange')}</span>
            <span className="row">
              <button type="button" className="button" onClick={editor.keepMine}>
                {t('desk.keepMine')}
              </button>
              <button type="button" className="button" onClick={() => void editor.loadDisk()}>
                {t('desk.reload')}
              </button>
            </span>
          </div>
        ) : null}
        <div className="page-inner">
          <div className="spread">
            <span className="page-kicker">
              {[notes?.chapterTitle, selectedScene === undefined ? undefined : t('desk.sceneNumber', { order: selectedScene.order })]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button type="button" className="button" disabled={isReadOnly} onClick={() => void writeScene()}>
              {editor.document?.exists === true ? t('desk.rewriteScene') : t('desk.writeScene')}
            </button>
          </div>
          <h1 id="manuscript-title" className="page-title">
            {selectedScene?.title ?? t('common.untitled')}
          </h1>
          {editor.document === undefined ? null : editor.document.exists ? (
            <Manuscript
              text={editor.text}
              isReadOnly={isReadOnly}
              stem={selectedStem ?? ''}
              onChange={editor.change}
              onBeforeProposal={editor.flush}
              onApply={editor.replaceWithAiEdit}
              onError={props.onError}
            />
          ) : (
            <div className="empty-draft">
              <p className="muted">{t('desk.emptyDraft')}</p>
              <button type="button" className="button button-primary" disabled={isReadOnly} onClick={() => void writeScene()}>
                {t('desk.writeScene')}
              </button>
            </div>
          )}
        </div>
        <div className="page-status">
          <span>
            {selectedScene?.targetLength === undefined
              ? t('common.characters', { count: editor.text.trim().length.toLocaleString(language) })
              : t('desk.lengthOfTarget', {
                  length: editor.text.trim().length.toLocaleString(language),
                  target: selectedScene.targetLength.toLocaleString(language),
                })}
          </span>
          <span aria-live="polite">{editor.saveState === 'saved' ? t('desk.saved') : t('desk.saving')}</span>
        </div>
      </main>
      <MarginNotes notes={notes} />
    </div>
  );
}

interface ManuscriptProps {
  readonly text: string;
  readonly stem: string;
  readonly isReadOnly: boolean;
  readonly onChange: (text: string) => void;
  readonly onBeforeProposal: () => Promise<void>;
  readonly onApply: (text: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

function Manuscript(props: ManuscriptProps): JSX.Element {
  const { t } = useI18n();
  const area = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<TextSelection>();
  const [editRequest, setEditRequest] = useState<{ readonly selection: TextSelection; readonly original: string }>();
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<string>();
  const [isProposing, setProposing] = useState(false);

  useLayoutEffect(() => {
    const element = area.current;
    if (element !== null) {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [props.text]);

  const closeEdit = (): void => {
    setEditRequest(undefined);
    setProposal(undefined);
    setInstruction('');
  };

  const propose = async (): Promise<void> => {
    if (editRequest === undefined || instruction.trim().length === 0) {
      return;
    }
    setProposing(true);
    try {
      await props.onBeforeProposal();
      const { text } = await call('draft.proposeEdit', {
        stem: props.stem,
        selectedText: editRequest.original,
        instruction: instruction.trim(),
      });
      setProposal(text);
    } catch (failure) {
      props.onError(messageOf(failure));
    } finally {
      setProposing(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (editRequest === undefined || proposal === undefined) {
      return;
    }
    const next = replaceSelection(props.text, editRequest.selection, editRequest.original, proposal);
    if (next === undefined) {
      props.onError(t('desk.externalChange'));
      return;
    }
    try {
      await props.onApply(next);
      closeEdit();
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  return (
    <>
      {editRequest === undefined ? (
        <div className="row" style={{ minHeight: 34, marginBottom: 8 }}>
          {hasSelection(selection) && !props.isReadOnly ? (
            <button
              type="button"
              className="button"
              onClick={() => setEditRequest({ selection, original: props.text.slice(selection.start, selection.end) })}
            >
              {t('edit.askAi')}
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="edit-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void propose();
          }}
        >
          <label className="field">
            <span className="sr-only">{t('edit.askAi')}</span>
            <input
              className="input"
              value={instruction}
              placeholder={t('edit.instructionPlaceholder')}
              onChange={(event) => setInstruction(event.target.value)}
              autoFocus
            />
          </label>
          {proposal === undefined ? null : (
            <div className="proposal">
              <div>
                <span className="field-label">{t('edit.current')}</span>
                <p className="proposal-text">{editRequest.original}</p>
              </div>
              <div>
                <span className="field-label">{t('edit.proposal')}</span>
                <p className="proposal-text">{proposal}</p>
              </div>
            </div>
          )}
          <div className="spread">
            <button type="button" className="button button-quiet" onClick={closeEdit}>
              {t('edit.discard')}
            </button>
            <span className="row">
              <button type="submit" className="button" disabled={isProposing || instruction.trim().length === 0}>
                {isProposing ? t('edit.proposing') : t('edit.propose')}
              </button>
              {proposal === undefined ? null : (
                <button type="button" className="button button-primary" onClick={() => void apply()}>
                  {t('edit.apply')}
                </button>
              )}
            </span>
          </div>
        </form>
      )}
      <textarea
          aria-labelledby="manuscript-title"
          ref={area}
          className="manuscript"
          value={props.text}
          readOnly={props.isReadOnly}
          onChange={(event) => props.onChange(event.target.value)}
          onSelect={(event) =>
            setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })
          }
        />
    </>
  );
}
