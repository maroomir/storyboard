import * as vscode from 'vscode';

import type { ICardWriterRepository } from '../../../application/cards/createCardUseCase';
import {
  backgroundCardPath,
  characterCardPath,
  characterProfilePath,
} from '../../vscode/pathConventions';
import { uriExists } from '../../vscode/workspace';
import { serializeCard } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';
const TRANSPARENT_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export class CardWriterRepository implements ICardWriterRepository {
  public async exists(
    workspaceRoot: vscode.Uri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return await uriExists(this.cardUri(workspaceRoot, cardType, id));
  }

  public async write(workspaceRoot: vscode.Uri, card: StoryboardCard): Promise<vscode.Uri> {
    const cardUri = this.cardUri(workspaceRoot, card.type, card.id);
    await vscode.workspace.fs.writeFile(cardUri, new TextEncoder().encode(serializeCard(card)));

    if (card.type === 'character') {
      const imageUri = characterProfilePath(workspaceRoot, card.id);
      if (!(await uriExists(imageUri))) {
        await vscode.workspace.fs.writeFile(imageUri, TRANSPARENT_PNG_BYTES);
      }
    }

    return cardUri;
  }

  private cardUri(
    workspaceRoot: vscode.Uri,
    cardType: StoryboardCard['type'],
    id: string,
  ): vscode.Uri {
    return cardType === 'character'
      ? characterCardPath(workspaceRoot, id)
      : backgroundCardPath(workspaceRoot, id);
  }
}
