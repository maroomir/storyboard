import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { createRequestId, parseCardEditorInitialData } from '@webview/lib/messaging';
import type { CardEditorInitialData, EditorCard, StoryboardEventMessage } from '@webview/lib/types';
import { Button } from '../ui/Button';
import { CollectPanel } from './CollectPanel';
import { PreviewPanel } from './PreviewPanel';
import { YamlEditorPanel } from './YamlEditorPanel';
import { SectionHeader } from '../ui/SectionHeader';
import { Tabs } from '../ui/Tabs';
import { sbInputClass, sbYamlTextareaClass } from '../ui/formClasses';
import { ArcCurveView } from '../character/ArcCurveView';
import { CharacterRelationPreview } from '../character/CharacterRelationPreview';
import { BackgroundFields } from './fields/BackgroundFields';
import { CharacterFields } from './fields/CharacterFields';
import { ListField } from './fields/ListField';
import { SceneFields } from './fields/SceneFields';
import { ScenePreviewPanel } from './ScenePreviewPanel';
import { SceneStructurePanel } from './SceneStructurePanel';

const overviewBoxClass =
  'flex flex-col gap-4 rounded-xl border border-sb-border bg-sb-bg-sidebar/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

export function CardEditor({
  initialData,
}: {
  readonly initialData: CardEditorInitialData;
}): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), []);
  const [documentState, setDocumentState] = useState(initialData);
  const [card, setCard] = useState<EditorCard | undefined>(initialData.card);
  const [status, setStatus] = useState('문서에서 카드 정보를 불러왔습니다.');
  const [isDirty, setIsDirty] = useState(false);
  const [isEditingYaml, setIsEditingYaml] = useState(false);
  const [pendingExternalData, setPendingExternalData] = useState<
    CardEditorInitialData | undefined
  >();

  const applyDocumentState = useCallback((nextDocumentState: CardEditorInitialData): void => {
    setDocumentState(nextDocumentState);
    setCard(nextDocumentState.card);
    setIsDirty(false);
    setIsEditingYaml(false);
    setPendingExternalData(undefined);
    setStatus('문서 변경 사항을 다시 불러왔습니다.');
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== 'event' || event.data.method !== 'cards.changed') {
        return;
      }

      const nextDocumentState = parseCardEditorInitialData(event.data.payload);

      if (isDirty || isEditingYaml) {
        setPendingExternalData(nextDocumentState);
        setStatus('외부에서 카드가 변경되었습니다. 필요하면 다시 불러오세요.');
        return;
      }

      applyDocumentState(nextDocumentState);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isDirty, isEditingYaml, applyDocumentState]);

  const applyYamlSave = useCallback(
    (next: Pick<CardEditorInitialData, 'card' | 'rawText'>): void => {
      if (!next.card) {
        return;
      }

      setDocumentState((prev) => ({ ...prev, card: next.card, rawText: next.rawText }));
      setCard(next.card);
      setIsDirty(false);
      setPendingExternalData(undefined);
    },
    [],
  );

  const updateCard = useCallback(
    (nextCard: EditorCard): void => {
      setCard(nextCard);
      setIsDirty(true);
      setStatus('변경 사항을 문서에 반영하는 중입니다…');

      vscodeApi?.postMessage({
        protocolVersion: '1.0.0',
        type: 'request',
        id: createRequestId(),
        method: 'cards.write',
        payload: {
          uri: documentState.documentUri,
          card: nextCard,
        },
      });
    },
    [documentState.documentUri, vscodeApi],
  );

  const yamlPanel = useMemo(
    () => (
      <YamlEditorPanel
        documentUri={documentState.documentUri}
        rawText={documentState.rawText}
        vscodeApi={vscodeApi}
        onSaved={applyYamlSave}
        onEditingChange={setIsEditingYaml}
        onStatusChange={setStatus}
      />
    ),
    [documentState.documentUri, documentState.rawText, vscodeApi, applyYamlSave],
  );

  const tabItems = useMemo(() => {
    if (!card) {
      return [];
    }

    if (card.type === 'scene') {
      return [
        {
          id: 'overview',
          label: '편집',
          panel: (
            <div className={overviewBoxClass}>
              <SectionHeader title="씬 정보" eyebrow="Scene" />
              <label className="flex flex-col gap-[0.35rem]">
                <span className="text-sm text-sb-fg-muted">ID</span>
                <input className={sbInputClass} value={card.id} readOnly />
              </label>
              <SceneStructurePanel
                card={card}
                documentUri={documentState.documentUri}
                vscodeApi={vscodeApi}
                updateCard={updateCard}
                onStatusChange={setStatus}
              />
              <SceneFields
                card={card}
                updateCard={updateCard}
                narratorRoster={documentState.narratorRoster}
              />
            </div>
          ),
        },
        { id: 'yaml', label: 'YAML', panel: yamlPanel },
      ];
    }

    const overview = (
      <div className={overviewBoxClass}>
        <SectionHeader title="기본 정보" eyebrow="Overview" />
        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">ID</span>
          <input className={sbInputClass} value={card.id} readOnly />
        </label>
        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Name</span>
          <input
            className={sbInputClass}
            value={card.name}
            onChange={(event) => updateCard({ ...card, name: event.target.value })}
          />
        </label>
        {card.type === 'character' ? <CharacterFields card={card} updateCard={updateCard} /> : null}
        {card.type !== 'character' ? (
          <BackgroundFields card={card} updateCard={updateCard} />
        ) : null}
        <ListField
          label="Description"
          values={card.description ?? []}
          onChange={(description) => updateCard({ ...card, description })}
        />
        <ListField
          label="Tags"
          values={card.tags ?? []}
          onChange={(tags) => updateCard({ ...card, tags })}
        />
      </div>
    );

    const collectTab = {
      id: 'collect',
      label: '수집',
      panel: (
        <CollectPanel
          card={card}
          documentUri={documentState.documentUri}
          vscodeApi={vscodeApi}
          onStatusChange={setStatus}
        />
      ),
    };

    if (card.type !== 'character') {
      return [
        { id: 'overview', label: '편집', panel: overview },
        collectTab,
        { id: 'yaml', label: 'YAML', panel: yamlPanel },
      ];
    }

    return [
      { id: 'overview', label: '편집', panel: overview },
      {
        id: 'ai-record',
        label: 'AI 기록',
        panel: (
          <div className={overviewBoxClass}>
            <SectionHeader title="AI 자동 기록" eyebrow="Auto" />
            <p className="m-0 text-xs leading-normal text-sb-fg-muted">
              draft 생성 중 AI가 자동으로 갱신합니다. 직접 입력할 필요가 없으며, 상세 값은 YAML
              탭에서 확인할 수 있습니다.
            </p>
            <ArcCurveView arc={card.arc ?? []} />
            <CharacterRelationPreview
              characterName={card.name}
              characterRole={card.role}
              characterRoster={documentState.characterRoster}
              relations={card.relations ?? []}
            />
          </div>
        ),
      },
      collectTab,
      { id: 'yaml', label: 'YAML', panel: yamlPanel },
    ];
  }, [
    card,
    documentState.characterRoster,
    documentState.documentUri,
    vscodeApi,
    updateCard,
    yamlPanel,
  ]);

  if (documentState.error || !card) {
    return (
      <main className="grid min-h-screen grid-cols-1 gap-4 bg-sb-bg p-4">
        <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar p-4">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
            Storyboard Card
          </p>
          <h1 className="font-display m-0 text-xl leading-snug text-sb-fg">
            YAML을 카드로 읽을 수 없습니다
          </h1>
          <p className="m-0 text-sb-fg-error">{documentState.error ?? '알 수 없는 오류'}</p>
          <textarea className={sbYamlTextareaClass} readOnly value={documentState.rawText} />
        </section>
      </main>
    );
  }

  const panelClass =
    'relative flex min-w-0 flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar p-4';

  return (
    <main className="relative grid min-h-screen grid-cols-[minmax(260px,0.85fr)_minmax(320px,1.15fr)] gap-4 bg-sb-bg p-4 max-[760px]:grid-cols-1">
      <AnimatePresence>
        {pendingExternalData ? (
          <motion.div
            key="external-card-change"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="fixed bottom-4 left-1/2 z-[200] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 rounded-xl border border-sb-border-warning bg-sb-bg-widget px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
          >
            <p className="m-0 text-sm font-medium text-sb-fg">다른 곳에서 YAML이 변경되었습니다</p>
            <p className="mt-1 m-0 text-xs leading-normal text-sb-fg-muted">
              편집 중인 내용을 덮어쓰지 않도록 보류 중입니다. 최신 문서로 맞추려면 불러오기를
              누르세요.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPendingExternalData(undefined);
                  setStatus('편집을 계속합니다. 최신 문서는 다시 불러오기로 반영할 수 있습니다.');
                }}
              >
                나중에
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => applyDocumentState(pendingExternalData)}
              >
                다시 불러오기
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {card.type === 'scene' ? (
        <ScenePreviewPanel card={card} />
      ) : (
        <PreviewPanel card={card} imageUri={documentState.imageUri} />
      )}

      <section className={`${panelClass} min-h-0`} aria-label="카드 편집 폼">
        <SectionHeader
          eyebrow={
            card.type === 'scene' ? 'Scene' : card.type === 'character' ? 'Character' : 'Background'
          }
          title={card.type === 'scene' ? (card.title ?? card.id) : card.name}
          description="탭으로 섹션을 전환해 편집할 수 있습니다."
        />

        <Tabs key={card.id} items={tabItems} initialId="overview" />

        <p className="m-0 text-xs text-sb-fg-muted">{status}</p>
      </section>
    </main>
  );
}
