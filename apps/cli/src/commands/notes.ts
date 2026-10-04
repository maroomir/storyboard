import { resolve } from 'node:path';

import {
  isNotionUrl,
  type NoteAbsorbPlan,
  type NoteBundle,
  NodeUri,
} from '@storyboard/story-model';
import {
  type ApplyNoteAbsorbOutcome,
  type NoteAbsorbEstimate,
  type NoteLocation,
} from '@storyboard/story-engine';

import { flagBoolean, type ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { CommandHandler, CommandOutcome } from './outcome';
import { askLine, askSecret, readStdin } from './prompt';

export function parseNoteLocation(raw: string): NoteLocation {
  return isNotionUrl(raw)
    ? { kind: 'notion', pageUrl: raw }
    : { kind: 'obsidian', root: NodeUri.file(resolve(raw)) };
}

function canAsk(container: CliContainer): boolean {
  return container.canPrompt && process.stdin.isTTY === true;
}

async function confirm(question: string): Promise<boolean> {
  const answer = await askLine(`${question} [y/N] `);

  return /^(y|yes|예|네)$/i.test(answer);
}

function formatUsd(value: number | undefined): string {
  return value === undefined ? '금액 불명 (가격표에 없는 모델)' : `최대 $${value.toFixed(2)}`;
}

function describeEstimate(bundle: NoteBundle, estimate: NoteAbsorbEstimate): string[] {
  return [
    `읽은 노트 ${estimate.noteCount}장 (링크로 따라온 노트 ${estimate.linkedNoteCount}장) · ${estimate.characterCount.toLocaleString()}자`,
    ...bundle.notes
      .filter((note) => note.origin === 'link')
      .map((note) => `  링크로 읽음  ${note.title} (${note.id})`),
    ...bundle.skipped.map((entry) => `  읽지 못함    ${entry.label} — ${entry.reason}`),
    `AI 요청 최대 ${estimate.requestCount}회 · ${estimate.providerId}/${estimate.model} · 입력 약 ${estimate.inputTokens.toLocaleString()} 토큰 · ${formatUsd(estimate.costCeilingUsd)}`,
  ];
}

const settingLabels: Readonly<Record<string, string>> = {
  genre: '장르',
  audience: '독자층',
  concept: '콘셉트',
  description: '설명',
  pov: '시점',
};

function describePlan(plan: NoteAbsorbPlan): string[] {
  const lines: string[] = [];

  for (const entry of plan.cards) {
    const kind = entry.card.type === 'character' ? '인물' : '배경';
    const action = entry.isNew ? '새 카드' : `후보 ${entry.changes.length}건`;
    lines.push(`${kind}  ${entry.card.id} (${entry.card.name}) — ${action}`);
  }

  for (const scene of plan.scenes) {
    const source = scene.sourceNote === undefined ? '' : ` ← ${scene.sourceNote}`;
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

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function describeOutcome(outcome: ApplyNoteAbsorbOutcome): string[] {
  const lines = [
    `카드 ${outcome.createdCards.length}장을 만들었습니다${outcome.createdCards.length > 0 ? `: ${outcome.createdCards.join(', ')}` : ''}.`,
    `씬 ${outcome.createdScenes.length}개를 만들었습니다${outcome.skippedScenes.length > 0 ? ` (건너뜀 ${outcome.skippedScenes.length}개)` : ''}.`,
  ];

  if (outcome.candidateCards.length > 0) {
    lines.push(
      `기존 카드 ${outcome.candidateCards.join(', ')} 에 대한 내용은 후보로 남겼습니다: storyboard card promote`,
    );
  }

  if (outcome.synopsis === 'written') {
    lines.push('시놉시스를 썼습니다: .storyboard/outline/synopsis.md');
  } else if (outcome.synopsis === 'candidate') {
    lines.push(
      '시놉시스가 이미 있어 노트의 시놉시스는 .storyboard/cache/notes/synopsis.candidate.md 에 두었습니다.',
    );
  }

  if (outcome.filledSettingKeys.length > 0) {
    lines.push(
      `작품 계약의 빈 칸을 채웠습니다: ${outcome.filledSettingKeys.map((key) => settingLabels[key] ?? key).join(', ')}`,
    );
  }

  const proposals = Object.entries(outcome.settingProposals);

  if (proposals.length > 0) {
    lines.push(
      `작품 계약은 바꾸지 않았습니다. 노트대로 하려면: storyboard project set ${proposals
        .map(([key, value]) => `--${key} ${quoteShellValue(String(value))}`)
        .join(' ')}`,
    );
  }

  return lines;
}

// Collect, estimate, plan, apply — with a person asked twice (before spending, before writing) and
// an agent stopped after the estimate unless it said `--yes`. `--dry-run` stops after the plan.
export async function runNoteAbsorb(
  container: CliContainer,
  args: ParsedArguments,
  rawLocation: string,
  options: { readonly shouldFillContract: boolean; readonly retryCommand: string },
): Promise<CommandOutcome> {
  const location = parseNoteLocation(rawLocation);
  const collected = await container.notes.collect({
    workspaceRoot: container.workspaceRoot,
    location,
  });

  if (!collected.ok) {
    return { ok: false, message: collected.message };
  }

  const { bundle } = collected;
  const estimate = container.notes.estimate(bundle);
  const estimateLines = describeEstimate(bundle, estimate);
  const isConfirmed = flagBoolean(args.flags, 'yes');

  if (!isConfirmed) {
    if (!canAsk(container)) {
      return {
        ok: true,
        message: [
          ...estimateLines,
          '',
          `이대로 진행하려면 --yes 를 붙이세요: ${options.retryCommand}`,
        ].join('\n'),
        data: { estimate, skipped: bundle.skipped },
      };
    }

    process.stderr.write(`${estimateLines.join('\n')}\n`);

    if (!(await confirm('노트를 AI 로 정리할까요?'))) {
      return { ok: true, message: '취소했습니다. 아무것도 쓰지 않았습니다.', data: { estimate } };
    }
  }

  const planned = await container.notes.plan({ workspaceRoot: container.workspaceRoot, bundle });

  if (!planned.ok) {
    return { ok: false, message: planned.message };
  }

  const planLines = describePlan(planned.plan);

  if (flagBoolean(args.flags, 'dry-run')) {
    return {
      ok: true,
      message: [...planLines, '', '--dry-run 이라 반영하지 않았습니다.'].join('\n'),
      data: { estimate, plan: planned.plan },
    };
  }

  if (!isConfirmed) {
    process.stderr.write(`${planLines.join('\n')}\n`);

    if (!(await confirm('이대로 워크스페이스에 반영할까요?'))) {
      return {
        ok: true,
        message: '반영하지 않았습니다. 계획은 .storyboard/cache/notes/plan.json 에 있습니다.',
        data: { plan: planned.plan },
      };
    }
  }

  const applied = await container.notes.apply({
    workspaceRoot: container.workspaceRoot,
    plan: planned.plan,
    location: bundle.location,
    shouldFillContract: options.shouldFillContract,
  });

  if (!applied.ok) {
    return { ok: false, message: applied.message };
  }

  return {
    ok: true,
    message: describeOutcome(applied).join('\n'),
    data: { estimate, plan: planned.plan, applied },
  };
}

export const absorbNotes: CommandHandler = async ({ container, args }) => {
  const rawLocation = args.positionals[0];

  if (rawLocation === undefined) {
    return {
      ok: false,
      message:
        '노트 위치를 지정해 주세요: storyboard notes absorb <Obsidian 폴더·노트 | Notion 페이지 주소>',
    };
  }

  return await runNoteAbsorb(container, args, rawLocation, {
    shouldFillContract: false,
    retryCommand: `storyboard notes absorb ${quoteShellValue(rawLocation)} --yes`,
  });
};

// SECURITY: the token is read without echo (or from stdin for an agent) and goes only to the 0600
// secrets file; it is never printed.
export const connectNotion: CommandHandler = async ({ container }) => {
  const token = (
    canAsk(container)
      ? await askSecret(
          'Notion 통합 토큰을 붙여 넣고 Enter (입력은 화면에 보이지 않습니다. 비워 두면 삭제): ',
        )
      : await readStdin()
  ).trim();

  await container.notes.connectNotion(token);

  return token.length === 0
    ? { ok: true, message: 'Notion 토큰을 지웠습니다.' }
    : {
        ok: true,
        message: [
          `Notion 토큰을 저장했습니다: ${container.homePaths.secretsFile}`,
          '읽을 페이지마다 Notion 에서 「연결」에 이 통합을 추가해야 합니다.',
        ].join('\n'),
      };
};
