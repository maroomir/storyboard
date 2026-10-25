import * as vscode from 'vscode';

import type { NoteManager, RunGate } from '@storyboard/story-app';
import type {
  ApplyNoteAbsorbOutcome,
  ApplyNoteAbsorbResult,
  CollectNotesResult,
  IStoryboardLogger,
  NoteAbsorbEstimate,
  NoteLocation,
  PlanNoteAbsorbResult,
} from '@storyboard/story-engine';
import {
  isNotionUrl,
  type NoteAbsorbPlan,
  type NoteBundle,
  type NoteCardPlan,
  type NoteSourceKind,
} from '@storyboard/story-model';
import { getTargetWorkspaceFolder, hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { runHoldingWorkspaceLock } from './workspaceRunLock';

const absorbCommand: string = 'storyboard.notes.absorb';

export interface RegisterAbsorbNotesCommandDependencies {
  readonly logger: IStoryboardLogger;
  readonly notes: Pick<NoteManager, 'collect' | 'estimate' | 'plan' | 'apply'>;
  readonly runGate: Pick<RunGate, 'hold'>;
}

interface LocationPickItem extends vscode.QuickPickItem {
  readonly source: NoteSourceKind;
}

const locationPicks: readonly LocationPickItem[] = [
  {
    source: 'obsidian',
    label: 'Obsidian 폴더·노트',
    description: '폴더 전체 또는 노트 한 장, 링크는 한 단계',
  },
  {
    source: 'notion-export',
    label: 'Notion 내보내기 zip',
    description: 'Notion 의 Markdown & CSV 내보내기',
  },
  {
    source: 'notion',
    label: 'Notion 페이지 주소',
    description: '통합 토큰이 secrets.json 에 있어야 합니다',
  },
];

export function registerAbsorbNotesCommand(
  dependencies: RegisterAbsorbNotesCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(absorbCommand, () => absorbNotes(dependencies));
}

async function absorbNotes(dependencies: RegisterAbsorbNotesCommandDependencies): Promise<void> {
  const folder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

  if (!folder || !(await hasStoryboardProject(folder))) {
    await vscode.window.showErrorMessage('Storyboard 프로젝트가 없습니다. 먼저 초기화해 주세요.');
    return;
  }

  const location: NoteLocation | undefined = await pickNoteLocation();

  if (location === undefined) {
    return;
  }

  const collected: CollectNotesResult = await dependencies.notes.collect({
    workspaceRoot: folder.uri,
    location,
  });

  if (!collected.ok) {
    await vscode.window.showErrorMessage(collected.message);
    return;
  }

  const { bundle } = collected;
  const estimate: NoteAbsorbEstimate = dependencies.notes.estimate(bundle);
  const isEstimateAccepted: '정리' | undefined = await vscode.window.showInformationMessage(
    '노트를 AI 로 정리할까요?',
    { modal: true, detail: describeEstimate(bundle, estimate).join('\n') },
    '정리',
  );

  if (isEstimateAccepted !== '정리') {
    return;
  }

  const planned: PlanNoteAbsorbResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '노트를 정리하는 중…' },
    () => dependencies.notes.plan({ workspaceRoot: folder.uri, bundle }),
  );

  if (!planned.ok) {
    await vscode.window.showErrorMessage(planned.message);
    return;
  }

  const isPlanAccepted: '반영' | undefined = await vscode.window.showInformationMessage(
    '이대로 워크스페이스에 반영할까요?',
    { modal: true, detail: describePlan(planned.plan).join('\n') },
    '반영',
  );

  if (isPlanAccepted !== '반영') {
    await vscode.window.showInformationMessage(
      '반영하지 않았습니다. 계획은 .storyboard/cache/notes/plan.json 에 있습니다.',
    );
    return;
  }

  await runHoldingWorkspaceLock(dependencies.runGate, folder.uri, '노트 흡수', async () => {
    const applied: ApplyNoteAbsorbResult = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '노트를 반영하는 중…' },
      () =>
        dependencies.notes.apply({
          workspaceRoot: folder.uri,
          plan: planned.plan,
          location: bundle.location,
          shouldFillContract: false,
          shouldReplaceCandidates: false,
        }),
    );

    if (!applied.ok) {
      dependencies.logger.show();
      await vscode.window.showErrorMessage(applied.message);
      return;
    }

    await vscode.window.showInformationMessage(describeOutcome(applied).join(' '));
  });
}

async function pickNoteLocation(): Promise<NoteLocation | undefined> {
  const picked: LocationPickItem | undefined = await vscode.window.showQuickPick(locationPicks, {
    title: '노트 흡수',
    placeHolder: '어디에 적어 둔 노트인가요?',
  });

  if (picked === undefined) {
    return undefined;
  }

  if (picked.source === 'notion') {
    const pageUrl: string | undefined = await vscode.window.showInputBox({
      title: 'Notion 페이지 주소',
      prompt: '통합과 공유된 페이지의 주소를 붙여 넣으세요.',
      ignoreFocusOut: true,
      validateInput: (value) =>
        isNotionUrl(value.trim()) ? undefined : 'Notion 페이지 주소가 아닙니다.',
    });

    return pageUrl === undefined ? undefined : { kind: 'notion', pageUrl: pageUrl.trim() };
  }

  const isArchive: boolean = picked.source === 'notion-export';
  const [uri] =
    (await vscode.window.showOpenDialog({
      title: isArchive ? 'Notion 내보내기 zip 고르기' : 'Obsidian 폴더나 노트 고르기',
      canSelectFiles: true,
      canSelectFolders: !isArchive,
      canSelectMany: false,
      filters: isArchive ? { 'Notion export': ['zip'] } : { Markdown: ['md'] },
    })) ?? [];

  if (uri === undefined) {
    return undefined;
  }

  return isArchive ? { kind: 'notion-export', archive: uri } : { kind: 'obsidian', root: uri };
}

function describeEstimate(bundle: NoteBundle, estimate: NoteAbsorbEstimate): string[] {
  const cost: string =
    estimate.costCeilingUsd === undefined
      ? '요금 정보 없음'
      : `최대 $${estimate.costCeilingUsd.toFixed(2)}`;

  return [
    `노트 ${estimate.noteCount}장${estimate.linkedNoteCount > 0 ? ` (링크로 따라온 ${estimate.linkedNoteCount}장)` : ''}, ${estimate.characterCount.toLocaleString()}자`,
    `AI 요청 ${estimate.requestCount}번 · ${estimate.providerId} / ${estimate.model} · 예상 비용 ${cost}`,
    ...(bundle.skipped.length > 0 ? [`읽지 못한 노트 ${bundle.skipped.length}장`] : []),
  ];
}

function describePlan(plan: NoteAbsorbPlan): string[] {
  const newCards: NoteCardPlan[] = plan.cards.filter((card) => card.isNew);
  const changedCards: NoteCardPlan[] = plan.cards.filter((card) => !card.isNew);

  return [
    `새 카드 ${newCards.length}장${newCards.length > 0 ? `: ${newCards.map((card) => card.card.name).join(', ')}` : ''}`,
    `기존 카드에 대한 후보 ${changedCards.length}장${changedCards.length > 0 ? `: ${changedCards.map((card) => card.card.name).join(', ')}` : ''}`,
    `씬 ${plan.scenes.length}개${plan.skippedScenes.length > 0 ? ` (건너뜀 ${plan.skippedScenes.length}개)` : ''}`,
    `시놉시스 ${plan.synopsis === undefined ? '없음' : '있음'} · 정전 후보 ${plan.canonCandidates.length}건`,
    ...(plan.unclassifiedNotes.length > 0
      ? [
          `분류 못한 노트 ${plan.unclassifiedNotes.length}장: ${plan.unclassifiedNotes.map((note) => note.title).join(', ')}`,
        ]
      : []),
    ...plan.warnings,
  ];
}

function describeOutcome(outcome: ApplyNoteAbsorbOutcome): string[] {
  return [
    `카드 ${outcome.createdCards.length}장과 씬 ${outcome.createdScenes.length}개를 만들었습니다.`,
    ...(outcome.pendingCandidateCards.length > 0
      ? [
          `기존 카드 ${outcome.pendingCandidateCards.length}장의 후보는 Promote Card Candidates 로 반영하세요.`,
        ]
      : []),
    ...(outcome.canonCandidates > 0
      ? [
          `정전 후보 ${outcome.canonCandidates}건은 Promote Bible Candidates to Canon 으로 확정하세요.`,
        ]
      : []),
    ...(outcome.synopsis === 'written' ? ['시놉시스를 썼습니다.'] : []),
    ...(outcome.synopsis === 'candidate'
      ? ['시놉시스가 이미 있어 노트의 시놉시스는 후보 파일로 두었습니다.']
      : []),
    ...(Object.keys(outcome.settingProposals).length > 0
      ? ['작품 계약은 바꾸지 않았습니다. 노트대로 하려면 `storyboard project set` 을 쓰세요.']
      : []),
  ];
}
