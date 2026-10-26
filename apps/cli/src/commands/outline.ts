import { flagBoolean } from '@/cliArguments';
import type { CommandHandler } from '@/commands/outcome';
import type { GenerateOutlineResult } from '@storyboard/story-engine';

export const generateOutline: CommandHandler = async ({ container, args }) => {
  const outlineGeneration: GenerateOutlineResult = await container.novel.generateOutline({
    workspaceRoot: container.workspaceRoot,
    overwrite: flagBoolean(args.flags, 'force'),
    onProgress: (message: string) => container.progress.update({ line: message, step: message }),
  });

  return {
    ok: outlineGeneration.ok,
    message: describeOutlineResult(outlineGeneration.kind),
    data: outlineGeneration,
  };
};

function describeOutlineResult(kind: string): string {
  switch (kind) {
    case 'generated':
      return '아웃라인을 생성했습니다.';
    case 'existing':
      return '아웃라인이 이미 있습니다. 덮어쓰려면 --force 를 주세요.';
    case 'missing_contract':
      return '작품 계약이 비어 아웃라인을 만들 수 없습니다. .storyboard/project.json 의 setting 을 채워 주세요.';
    default:
      return `아웃라인을 생성하지 못했습니다 (${kind}).`;
  }
}
