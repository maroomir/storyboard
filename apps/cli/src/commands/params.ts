import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { ParameterEntry, ParameterOrigin, ParameterReport } from '@storyboard/story-app';
import { success } from './outcomes';

export const parameterKindLabels: Record<ParameterEntry['kind'], string> = {
  setting: '설정 (config.json)',
  generation: '생성 손잡이 (모델 실측 → 파이프라인 기본값)',
  prompt: '프롬프트 온도·출력 상한 (프롬프트 파일 머리말)',
};

export const parameterOriginLabels: Record<ParameterEntry['origin'], string> = {
  workspace: '이 작품',
  user: '공통',
  model: '모델 실측',
  default: '기본값',
  'provider-unsupported': '프로바이더 미지원',
};

export const originsWithoutDefaultNote: Set<ParameterOrigin> = new Set<ParameterEntry['origin']>([
  'default',
  'provider-unsupported',
]);

export async function runParamsShow({ container }: CommandContext): Promise<CommandOutcome> {
  const report: ParameterReport = await container.describeParameters();
  const width: number = Math.max(...report.parameters.map((entry) => entry.id.length));
  const lines: string[] = [];

  for (const kind of Object.keys(parameterKindLabels) as ParameterEntry['kind'][]) {
    const entries: ParameterEntry[] = report.parameters.filter((entry) => entry.kind === kind);
    lines.push(`[${parameterKindLabels[kind]}]`);

    for (const entry of entries) {
      const shown: string = String(entry.value).padEnd(12);
      const origin: string = parameterOriginLabels[entry.origin];
      const note: string = originsWithoutDefaultNote.has(entry.origin)
        ? ''
        : `  (기본값 ${String(entry.defaultValue)})`;
      lines.push(`${entry.id.padEnd(width)}  ${shown}  ${origin}${note}`);
    }

    lines.push('');
  }

  lines.push('[적용된 리소스 파일]');
  if (report.resources.applied.length === 0) {
    lines.push('(없음)');
  }
  for (const applied of report.resources.applied) {
    lines.push(`${applied.kind.padEnd(18)}  ${applied.file.fsPath}`);
  }
  for (const problem of report.resources.problems) {
    lines.push(`! ${problem.message}`);
  }

  return success(lines.join('\n'), report);
}
