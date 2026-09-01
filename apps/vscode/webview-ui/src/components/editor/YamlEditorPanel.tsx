import React, { useCallback, useState } from 'react';

import { createRequestId } from '@webview/lib/messaging';
import type { CardEditorInitialData, StoryboardCard } from '@webview/lib/types';
import { IconButton } from '../ui/IconButton';
import { SectionHeader } from '../ui/SectionHeader';
import { sbYamlTextareaClass } from '../ui/formClasses';

const panelClass =
  'flex flex-col gap-4 rounded-xl border border-sb-border bg-sb-bg-sidebar/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

type RpcResponse = {
  readonly type: 'response';
  readonly id: string;
  readonly method: string;
  readonly ok: boolean;
  readonly payload?: { readonly card: StoryboardCard; readonly rawText: string };
  readonly error?: { readonly message: string };
};

export type YamlEditorPanelProps = {
  readonly documentUri: string;
  readonly rawText: string;
  readonly onSaved: (next: Pick<CardEditorInitialData, 'card' | 'rawText'>) => void;
  readonly onEditingChange?: (isEditing: boolean) => void;
  readonly onStatusChange?: (status: string) => void;
  readonly vscodeApi?: ReturnType<NonNullable<typeof window.acquireVsCodeApi>>;
};

function callWriteRaw(
  vscodeApi: NonNullable<YamlEditorPanelProps['vscodeApi']>,
  documentUri: string,
  rawText: string,
): Promise<{ readonly card: StoryboardCard; readonly rawText: string }> {
  const id = createRequestId();

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent): void => {
      const data = event.data as RpcResponse | undefined;
      if (!data || data.type !== 'response' || data.id !== id) {
        return;
      }

      window.removeEventListener('message', handler);

      if (data.ok && data.payload) {
        resolve(data.payload);
        return;
      }

      reject(new Error(data.error?.message ?? 'YAML을 저장하지 못했습니다.'));
    };

    window.addEventListener('message', handler);
    vscodeApi.postMessage({
      protocolVersion: '1.0.0',
      type: 'request',
      id,
      method: 'cards.writeRaw',
      payload: { uri: documentUri, rawText },
    });
  });
}

export function YamlEditorPanel({
  documentUri,
  rawText,
  onSaved,
  onEditingChange,
  onStatusChange,
  vscodeApi,
}: YamlEditorPanelProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(rawText);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const setEditing = useCallback(
    (next: boolean): void => {
      setIsEditing(next);
      onEditingChange?.(next);
    },
    [onEditingChange],
  );

  const startEditing = (): void => {
    setDraftText(rawText);
    setSaveError(undefined);
    setEditing(true);
    onStatusChange?.('YAML 편집 모드입니다. 저장을 누르면 검증 후 문서에 반영됩니다.');
  };

  const cancelEditing = (): void => {
    setDraftText(rawText);
    setSaveError(undefined);
    setEditing(false);
    onStatusChange?.('YAML 편집을 취소했습니다.');
  };

  const saveYaml = (): void => {
    if (!vscodeApi) {
      setSaveError('VS Code API를 사용할 수 없습니다.');
      return;
    }

    setIsSaving(true);
    setSaveError(undefined);
    onStatusChange?.('YAML을 검증하고 문서에 반영하는 중입니다…');

    void callWriteRaw(vscodeApi, documentUri, draftText)
      .then((result) => {
        onSaved(result);
        setEditing(false);
        onStatusChange?.('YAML을 저장했습니다.');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'YAML을 저장하지 못했습니다.';
        setSaveError(message);
        onStatusChange?.(message);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const displayText = isEditing ? draftText : rawText;

  return (
    <div className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <SectionHeader
          title="Raw YAML"
          eyebrow="Source"
          description={
            isEditing
              ? '저장하면 스키마 검증 후 문서에 반영됩니다. 취소하면 변경을 버립니다.'
              : '편집 버튼으로 인라인 수정할 수 있습니다.'
          }
        />
        <div className="flex shrink-0 gap-1">
          {!isEditing ? (
            <IconButton
              icon="edit"
              aria-label="편집"
              disabled={!vscodeApi}
              onClick={startEditing}
            />
          ) : (
            <>
              <IconButton icon="save" aria-label="저장" disabled={isSaving} onClick={saveYaml} />
              <IconButton
                icon="cancel"
                aria-label="취소"
                disabled={isSaving}
                onClick={cancelEditing}
              />
            </>
          )}
        </div>
      </div>

      {saveError ? <p className="m-0 text-sm text-sb-fg-error">{saveError}</p> : null}

      <textarea
        className={`${sbYamlTextareaClass} mt-0`}
        readOnly={!isEditing}
        value={displayText}
        onChange={
          isEditing
            ? (event) => {
                setDraftText(event.target.value);
                setSaveError(undefined);
              }
            : undefined
        }
      />
    </div>
  );
}
