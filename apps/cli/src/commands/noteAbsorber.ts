import { resolve } from 'node:path';
import {
  isNotionUrl,
  type NoteAbsorbPlan,
  type NoteBundle,
  NodeUri,
  formatUsd,
} from '@storyboard/story-model';
import type {
  ApplyNoteAbsorbOutcome,
  ApplyNoteAbsorbResult,
  CollectNotesResult,
  NoteAbsorbEstimate,
  NoteLocation,
  PlanNoteAbsorbResult,
} from '@storyboard/story-engine';
import { flagBoolean, type ParsedArguments } from '@/cliArguments';
import type { IPrompter } from '@/adapters/prompter';
import type { CliContainer } from '@/container';
import type { CommandOutcome } from './outcome';
import { failure, success } from '@/commands/outcomes';

export function parseNoteLocation(raw: string): NoteLocation {
  if (isNotionUrl(raw)) {
    return { kind: 'notion', pageUrl: raw };
  }

  return /\.zip$/i.test(raw)
    ? { kind: 'notion-export', archive: NodeUri.file(resolve(raw)) }
    : { kind: 'obsidian', root: NodeUri.file(resolve(raw)) };
}

const settingLabels: Readonly<Record<string, string>> = {
  genre: '장르',
  audience: '독자층',
  concept: '콘셉트',
  description: '설명',
  pov: '시점',
};

export function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface NoteAbsorbOptions {
  readonly shouldFillContract: boolean;
  readonly retryCommand: string;
}

async function confirm(
  prompter: IPrompter,
  title: string,
  details: readonly string[],
  proceedLabel: string,
): Promise<boolean> {
  const answer: boolean | undefined = await prompter.choose({
    title,
    details,
    options: [
      { label: proceedLabel, value: true },
      { label: '취소', value: false },
    ],
  });

  return answer === true;
}

function formatCostCeiling(value: number | undefined): string {
  return value === undefined ? '금액 불명 (가격표에 없는 모델)' : `최대 ${formatUsd(value)}`;
}

function describeEstimate(bundle: NoteBundle, estimate: NoteAbsorbEstimate): string[] {
  return [
    `읽은 노트 ${estimate.noteCount}장 (링크로 따라온 노트 ${estimate.linkedNoteCount}장) · ${estimate.characterCount.toLocaleString()}자`,
    ...bundle.notes
      .filter((note) => note.origin === 'link')
      .map((note) => `  링크로 읽음  ${note.title} (${note.id})`),
    ...bundle.skipped.map((entry) => `  읽지 못함    ${entry.label} — ${entry.reason}`),
    `AI 요청 최대 ${estimate.requestCount}회 · ${estimate.providerId}/${estimate.model} · 입력 약 ${estimate.inputTokens.toLocaleString()} 토큰 · ${formatCostCeiling(estimate.costCeilingUsd)}`,
  ];
}

function describePlan(plan: NoteAbsorbPlan): string[] {
  const lines: string[] = [];

  for (const entry of plan.cards) {
    const kind: '인물' | '배경' = entry.card.type === 'character' ? '인물' : '배경';
    const action: string = entry.isNew ? '새 카드' : `후보 ${entry.changes.length}건`;
    lines.push(`${kind}  ${entry.card.id} (${entry.card.name}) — ${action}`);
  }

  for (const scene of plan.scenes) {
    const source: string = scene.sourceNote === undefined ? '' : ` ← ${scene.sourceNote}`;
    lines.push(`씬    ${scene.card.id} ${scene.card.title ?? ''}${source}`);
  }

  for (const scene of plan.skippedScenes) {
    lines.push(`씬 건너뜀  ${scene.label} — ${scene.reason}`);
  }

  for (const [key, value] of Object.entries(plan.setting)) {
    if (value === undefined) {
      continue;
    }

    lines.push(`작품 계약  ${settingLabels[key] ?? key}: ${String(value)}`);
  }

  if (plan.synopsis !== undefined) {
    lines.push(`시놉시스  ${plan.synopsis.logline || '(로그라인 없음)'}`);
  }

  for (const note of plan.draftNotes) {
    lines.push(
      `원고      ${note.title} (${note.id}) — 인물·배경·작품 정보만 옮기고 씬은 만들지 않습니다`,
    );
  }

  for (const note of plan.unclassifiedNotes) {
    lines.push(`분류 못함  ${note.title} (${note.id}) — 옮기지 않습니다`);
  }

  lines.push(...plan.warnings.map((warning) => `경고  ${warning}`));

  return lines.length === 0 ? ['노트에서 옮길 것을 찾지 못했습니다.'] : lines;
}

function describeOutcome(outcome: ApplyNoteAbsorbOutcome): string[] {
  const lines: string[] = [
    `카드 ${outcome.createdCards.length}장을 만들었습니다${outcome.createdCards.length > 0 ? `: ${outcome.createdCards.join(', ')}` : ''}.`,
    `씬 ${outcome.createdScenes.length}개를 만들었습니다${outcome.skippedScenes.length > 0 ? ` (건너뜀 ${outcome.skippedScenes.length}개)` : ''}.`,
  ];

  if (outcome.candidateCards.length > 0) {
    lines.push(`기존 카드 ${outcome.candidateCards.join(', ')} 에 대한 내용은 후보로 남겼습니다.`);
  }

  if (outcome.pendingCandidateCards.length > 0) {
    lines.push(
      `승격을 기다리는 카드 ${outcome.pendingCandidateCards.length}장 (${outcome.pendingCandidateCards.join(', ')}): storyboard card promote`,
    );
  }

  if (outcome.synopsis === 'written') {
    lines.push('시놉시스를 썼습니다: .storyboard/outline/synopsis.md');
  } else if (outcome.synopsis === 'candidate') {
    lines.push(
      '시놉시스가 이미 있어 노트의 시놉시스는 .storyboard/cache/notes/synopsis.candidate.md 에 두었습니다.',
    );
  }

  if (outcome.seededCharacters.length > 0) {
    lines.push(
      `노트의 예시 대사를 말투 표본으로 두었습니다 (.storyboard/memory/voiceSeeds.json): ${outcome.seededCharacters.join(', ')}`,
    );
  }

  if (outcome.canonCandidates > 0) {
    lines.push(
      `노트의 설정 사실 ${outcome.canonCandidates}건을 정전 후보로 두었습니다 (.storyboard/cache/bible/): storyboard canon diff · canon promote`,
    );
  }

  if (outcome.filledSettingKeys.length > 0) {
    lines.push(
      `작품 계약의 빈 칸을 채웠습니다: ${outcome.filledSettingKeys.map((key) => settingLabels[key] ?? key).join(', ')}`,
    );
  }

  const proposals: [string, unknown][] = Object.entries(outcome.settingProposals);

  if (proposals.length > 0) {
    lines.push(
      `작품 계약은 바꾸지 않았습니다. 노트대로 하려면: storyboard project set ${proposals
        .map(([key, value]) => `--${key} ${quoteShellValue(String(value))}`)
        .join(' ')}`,
    );
  }

  return lines;
}

export class NoteAbsorber {
  public constructor(private readonly container: CliContainer) {}

  public async absorb(
    args: ParsedArguments,
    rawLocation: string,
    options: NoteAbsorbOptions,
  ): Promise<CommandOutcome> {
    const location: NoteLocation = parseNoteLocation(rawLocation);
    const collected: CollectNotesResult = await this.container.notes.collect({
      workspaceRoot: this.container.workspaceRoot,
      location,
    });

    if (!collected.ok) {
      return failure(collected.message);
    }

    const { bundle } = collected;
    const estimate: NoteAbsorbEstimate = this.container.notes.estimate(bundle);
    const estimateLines: string[] = describeEstimate(bundle, estimate);
    const isConfirmed: boolean = flagBoolean(args.flags, 'yes');

    if (!isConfirmed) {
      if (this.container.prompter === undefined) {
        return success(
          [
            ...estimateLines,
            '',
            `이대로 진행하려면 --yes 를 붙이세요: ${options.retryCommand}`,
          ].join('\n'),
          { estimate, skipped: bundle.skipped },
        );
      }

      if (
        !(await confirm(this.container.prompter, '노트를 AI 로 정리할까요?', estimateLines, '정리'))
      ) {
        return {
          ok: false,
          message: '취소했습니다. 아무것도 쓰지 않았습니다.',
          data: { estimate },
          stop: 'cancelled',
        };
      }
    }

    const planned: PlanNoteAbsorbResult = await this.container.notes.plan({
      workspaceRoot: this.container.workspaceRoot,
      bundle,
    });

    if (!planned.ok) {
      return failure(planned.message);
    }

    const planLines: string[] = describePlan(planned.plan);

    if (flagBoolean(args.flags, 'dry-run')) {
      return success([...planLines, '', '--dry-run 이라 반영하지 않았습니다.'].join('\n'), {
        estimate,
        plan: planned.plan,
      });
    }

    if (!isConfirmed && this.container.prompter !== undefined) {
      if (
        !(await confirm(
          this.container.prompter,
          '이대로 워크스페이스에 반영할까요?',
          planLines,
          '반영',
        ))
      ) {
        return {
          ok: false,
          message: '반영하지 않았습니다. 계획은 .storyboard/cache/notes/plan.json 에 있습니다.',
          data: { plan: planned.plan },
          stop: 'cancelled',
        };
      }
    }

    const applied: ApplyNoteAbsorbResult = await this.container.notes.apply({
      workspaceRoot: this.container.workspaceRoot,
      plan: planned.plan,
      location: bundle.location,
      shouldFillContract: options.shouldFillContract,
      shouldReplaceCandidates: flagBoolean(args.flags, 'replace-candidates'),
    });

    if (!applied.ok) {
      return failure(applied.message);
    }

    return success(describeOutcome(applied).join('\n'), { estimate, plan: planned.plan, applied });
  }
}
