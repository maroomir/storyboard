import * as vscode from 'vscode';

import {
  sceneGroundingFieldKeys,
  sceneGroundingFieldLabels,
  type SceneGroundingFieldKey,
} from '@storyboard/story-model';
import type { ConfirmSceneGrounding } from '@storyboard/story-engine';

type GroundingChoice =
  | { readonly kind: 'approve' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'edit'; readonly key: SceneGroundingFieldKey };

type GroundingItem = vscode.QuickPickItem & { readonly choice?: GroundingChoice };

const EDIT_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('edit'),
  tooltip: '이 항목 수정',
};

const INLINE_VALUE_LIMIT = 40;

// 생성 전에 확정될 씬 사실을 보여 주고 승인·항목별 수정·취소를 받는다.
// `storyboard.grounding.autoApprove`가 켜져 있으면 이 흐름은 호출되지 않는다.
export const confirmSceneGrounding: ConfirmSceneGrounding = async ({
  sceneStem,
  grounding,
  proposedFields,
}) => {
  const draft: Record<string, string> = { ...grounding };
  const editedKeys = new Set<SceneGroundingFieldKey>();

  for (;;) {
    const choice = await pickGroundingChoice(sceneStem, draft, proposedFields, editedKeys);

    if (!choice || choice.kind === 'cancel') {
      return undefined;
    }

    if (choice.kind === 'approve') {
      return draft;
    }

    const value = await askFieldValue(choice.key, draft[choice.key]);

    if (value === undefined) {
      continue;
    }

    if (value.length > 0) {
      draft[choice.key] = value;
    } else {
      delete draft[choice.key];
    }

    editedKeys.add(choice.key);
  }
};

function pickGroundingChoice(
  sceneStem: string,
  draft: Readonly<Record<string, string>>,
  proposedFields: readonly SceneGroundingFieldKey[],
  editedKeys: ReadonlySet<SceneGroundingFieldKey>,
): Promise<GroundingChoice | undefined> {
  const picker = vscode.window.createQuickPick<GroundingItem>();

  picker.title = `장면 사실 확정 · ${sceneStem}`;
  picker.placeholder = '항목을 골라 수정하거나, 이대로 생성을 선택하세요.';
  picker.ignoreFocusOut = true;
  picker.items = buildItems(draft, proposedFields, editedKeys);

  return new Promise<GroundingChoice | undefined>((resolve) => {
    let choice: GroundingChoice | undefined;

    picker.onDidAccept(() => {
      choice = picker.selectedItems[0]?.choice;
      picker.hide();
    });

    picker.onDidTriggerItemButton((event) => {
      choice = event.item.choice;
      picker.hide();
    });

    picker.onDidHide(() => {
      picker.dispose();
      resolve(choice);
    });

    picker.show();
  });
}

function buildItems(
  draft: Readonly<Record<string, string>>,
  proposedFields: readonly SceneGroundingFieldKey[],
  editedKeys: ReadonlySet<SceneGroundingFieldKey>,
): GroundingItem[] {
  const fieldItems = sceneGroundingFieldKeys.map((key) => {
    const value = draft[key] ?? '';
    const isProposed = proposedFields.includes(key) && !editedKeys.has(key);
    const isInlineValue = value.length > 0 && value.length <= INLINE_VALUE_LIMIT;

    return {
      label: `${isProposed ? '$(sparkle) ' : ''}${sceneGroundingFieldLabels[key]}`,
      description: isInlineValue ? value : undefined,
      detail: isInlineValue ? undefined : value || '$(warning) 비어 있음',
      buttons: [EDIT_BUTTON],
      choice: { kind: 'edit', key } as const,
    };
  });

  return [
    { label: '$(check) 이대로 생성', choice: { kind: 'approve' } },
    { label: '사실', kind: vscode.QuickPickItemKind.Separator },
    ...fieldItems,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(close) 취소', choice: { kind: 'cancel' } },
  ];
}

function askFieldValue(
  key: SceneGroundingFieldKey,
  current: string | undefined,
): Thenable<string | undefined> {
  return vscode.window
    .showInputBox({
      title: `${sceneGroundingFieldLabels[key]} 수정`,
      prompt: '비워 두면 이 항목 없이 생성합니다.',
      value: current ?? '',
      ignoreFocusOut: true,
    })
    .then((value) => value?.trim());
}
