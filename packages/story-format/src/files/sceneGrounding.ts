import yaml from 'js-yaml';

import {
  sceneGroundingFieldKeys,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '../scene';

export function missingSceneGroundingFields(
  grounding: SceneGrounding | undefined,
): SceneGroundingFieldKey[] {
  return sceneGroundingFieldKeys.filter((key) => {
    const value = grounding?.[key];
    return value === undefined || value.trim().length === 0;
  });
}

export function isSceneGroundingComplete(grounding: SceneGrounding | undefined): boolean {
  return missingSceneGroundingFields(grounding).length === 0;
}

// 사용자가 적어 둔 값이 항상 이긴다. 제안은 비어 있는 필드만 채운다.
export function mergeSceneGrounding(
  existing: SceneGrounding | undefined,
  proposed: SceneGrounding | undefined,
): SceneGrounding {
  const merged: Record<string, string> = {};

  for (const key of sceneGroundingFieldKeys) {
    const kept = existing?.[key]?.trim();
    const filled = kept && kept.length > 0 ? kept : proposed?.[key]?.trim();

    if (filled && filled.length > 0) {
      merged[key] = filled;
    }
  }

  return merged;
}

// NOTE: 씬 파일은 사용자 저작물이라 frontmatter 전체를 다시 직렬화하지 않는다. grounding 블록만
// 잘라 끼워 넣어 나머지 키의 표기(인라인 시퀀스, 주석, 키 순서)를 바이트 그대로 보존한다.
export function applySceneGrounding(rawScene: string, grounding: SceneGrounding): string {
  const normalizedScene = rawScene.replace(/\r\n/g, '\n');
  const groundingBlock = serializeGroundingBlock(grounding);
  const fence = locateFrontmatterFence(normalizedScene);

  if (!fence) {
    return `---\n${groundingBlock}---\n${normalizedScene}`;
  }

  const frontmatter = normalizedScene.slice(fence.startIndex, fence.endIndex);
  const rest = normalizedScene.slice(fence.endIndex);

  return `---\n${replaceGroundingBlock(frontmatter, groundingBlock)}${rest}`;
}

function serializeGroundingBlock(grounding: SceneGrounding): string {
  if (Object.keys(grounding).length === 0) {
    return '';
  }

  return yaml.dump({ grounding }, { lineWidth: -1, noRefs: true, sortKeys: false });
}

function locateFrontmatterFence(
  scene: string,
): { readonly startIndex: number; readonly endIndex: number } | undefined {
  if (!scene.startsWith('---\n')) {
    return undefined;
  }

  const closingFenceIndex = scene.indexOf('\n---', '---\n'.length);

  if (closingFenceIndex === -1) {
    return undefined;
  }

  return { startIndex: '---\n'.length, endIndex: closingFenceIndex + 1 };
}

function replaceGroundingBlock(frontmatter: string, groundingBlock: string): string {
  const lines = frontmatter.split('\n');
  const startLine = lines.findIndex((line) => /^grounding:/.test(line));

  if (startLine === -1) {
    return `${frontmatter}${groundingBlock}`;
  }

  let endLine = startLine + 1;
  while (endLine < lines.length && isBlockContinuation(lines[endLine])) {
    endLine += 1;
  }

  const before = lines.slice(0, startLine).join('\n');
  const after = lines.slice(endLine).join('\n');

  return `${before.length > 0 ? `${before}\n` : ''}${groundingBlock}${after}`;
}

function isBlockContinuation(line: string | undefined): boolean {
  return line !== undefined && (line.length === 0 || /^[ \t]/.test(line));
}
