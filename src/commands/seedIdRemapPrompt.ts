import * as vscode from 'vscode';

import { validateCardRenameId } from '@/infrastructure/vscode/cardRenameEdit';
import type { DecodedSeedContent } from '@/services/seedcoat/projectAdapter';

interface SeedIdRemapQuickPickItem extends vscode.QuickPickItem {
  readonly action: 'continue' | 'remap';
  readonly sourceId?: string;
}

function formatSeedIdRemapLabel(
  kind: 'character' | 'background',
  sourceId: string,
  name: string,
  mapping: ReadonlyMap<string, string>,
): string {
  const currentId = mapping.get(sourceId) ?? sourceId;

  return `${kind}/${sourceId} → ${name} (${currentId})`;
}

function buildSeedIdRemapQuickPickItems(
  seed: DecodedSeedContent,
  mapping: ReadonlyMap<string, string>,
): SeedIdRemapQuickPickItem[] {
  const items: SeedIdRemapQuickPickItem[] = [
    {
      label: '$(check) 변경 없이 계속',
      action: 'continue',
    },
  ];

  for (const card of seed.characters) {
    items.push({
      label: formatSeedIdRemapLabel('character', card.id, card.name, mapping),
      action: 'remap',
      sourceId: card.id,
    });
  }

  for (const card of seed.backgrounds) {
    items.push({
      label: formatSeedIdRemapLabel('background', card.id, card.name, mapping),
      action: 'remap',
      sourceId: card.id,
    });
  }

  return items;
}

export async function promptSeedIdRemapping(
  seed: DecodedSeedContent,
): Promise<Map<string, string> | undefined> {
  const mapping = new Map<string, string>();
  let finished = false;

  while (!finished) {
    const picked = await vscode.window.showQuickPick(
      buildSeedIdRemapQuickPickItems(seed, mapping),
      {
        placeHolder:
          'Seed 카드 ID 매핑을 검토하세요. 항목을 선택해 새 ID를 지정하거나 변경 없이 계속하세요.',
      },
    );

    if (!picked) {
      return undefined;
    }

    if (picked.action === 'continue') {
      finished = true;
      continue;
    }

    const sourceId = picked.sourceId;

    if (!sourceId) {
      continue;
    }

    const currentId = mapping.get(sourceId) ?? sourceId;
    const newId = await vscode.window.showInputBox({
      prompt: `${sourceId}의 새 ID를 입력하세요`,
      value: currentId,
      validateInput: (value) => validateCardRenameId(value.trim()),
    });

    if (newId === undefined) {
      continue;
    }

    const trimmed = newId.trim();

    if (trimmed === sourceId) {
      mapping.delete(sourceId);
      continue;
    }

    mapping.set(sourceId, trimmed);
  }

  return mapping;
}

export function formatSeedIdRemapErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Seed ID 매핑을 적용할 수 없습니다.';
}
