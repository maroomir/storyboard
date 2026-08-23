import * as vscode from 'vscode';

import {
  sceneGroundingFieldKeys,
  sceneGroundingFieldLabels,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '@storyboard/story-format';
import type { ConfirmSceneGrounding } from '../../application/drafts/generateDraftTypes';

const APPROVE_LABEL = '이대로 생성';
const EDIT_LABEL = '수정하기';

// 생성 전에 확정될 씬 사실을 보여 주고 승인·수정·취소를 받는다.
// `storyboard.grounding.autoApprove`가 켜져 있으면 이 흐름은 호출되지 않는다.
export const confirmSceneGrounding: ConfirmSceneGrounding = async ({
  sceneStem,
  grounding,
  proposedFields,
}) => {
  const decision = await vscode.window.showInformationMessage(
    `${sceneStem}: 이 장면의 사실을 확정합니다.`,
    { modal: true, detail: describeGrounding(grounding, proposedFields) },
    APPROVE_LABEL,
    EDIT_LABEL,
  );

  if (decision === APPROVE_LABEL) {
    return grounding;
  }

  if (decision !== EDIT_LABEL) {
    return undefined;
  }

  return await editGrounding(grounding, proposedFields);
};

function describeGrounding(
  grounding: SceneGrounding,
  proposedFields: readonly SceneGroundingFieldKey[],
): string {
  return sceneGroundingFieldKeys
    .map((key) => {
      const value = grounding[key];
      const origin = proposedFields.includes(key) ? ' (AI 제안)' : '';
      return `${sceneGroundingFieldLabels[key]}${origin}: ${value ?? '—'}`;
    })
    .join('\n');
}

async function editGrounding(
  grounding: SceneGrounding,
  proposedFields: readonly SceneGroundingFieldKey[],
): Promise<SceneGrounding | undefined> {
  const edited: Record<string, string> = {};

  for (const key of sceneGroundingFieldKeys) {
    const current = grounding[key] ?? '';
    const value = await vscode.window.showInputBox({
      title: `${sceneGroundingFieldLabels[key]}${proposedFields.includes(key) ? ' (AI 제안)' : ''}`,
      prompt: '비워 두면 이 항목 없이 생성합니다.',
      value: current,
      ignoreFocusOut: true,
    });

    if (value === undefined) {
      return undefined;
    }

    if (value.trim().length > 0) {
      edited[key] = value.trim();
    }
  }

  return edited;
}
