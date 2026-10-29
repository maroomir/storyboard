import * as vscode from 'vscode';

import {
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
  STORYBOARD_FILE_EXTENSIONS,
  STORYBOARD_GLOBS,
  detectCharactersInText,
  isIgnoredSampleCardFileName,
  readCardFile,
} from '@storyboard/story-model';
import { vscodeFsAdapter } from '@/infrastructure/vscode/workspaceFsAdapters';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import type {
  Character,
  CharacterCard,
  StoryboardCard,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
const wordPattern: RegExp = /[0-9A-Za-z가-힣_-]+/;

interface CharacterHoverContext {
  readonly character: CharacterCard;
  readonly relatedCharacterNames: readonly string[];
}

export function buildCharacterHoverMarkdown(context: CharacterHoverContext): vscode.MarkdownString {
  const { character, relatedCharacterNames } = context;
  const lines: string[] = [`### ${character.name}`];

  if (character.profile && character.profile.trim().length > 0) {
    lines.push('', character.profile.trim());
  }

  if (character.description && character.description.length > 0) {
    lines.push('', '- 설명', ...character.description.map((item) => `  - ${item}`));
  }

  if (character.traits && character.traits.length > 0) {
    lines.push('', '- 특성', ...character.traits.slice(0, 5).map((trait) => `  - ${trait}`));
  }

  if (character.recentDialogues && character.recentDialogues.length > 0) {
    lines.push(
      '',
      '- 최근 대사',
      ...character.recentDialogues.slice(-3).map((line) => `  - ${line}`),
    );
  }

  if (relatedCharacterNames.length > 0) {
    lines.push('', `- 관계: ${relatedCharacterNames.join(', ')}`);
  }

  const MarkdownCtor: typeof vscode.MarkdownString | undefined = (
    vscode as unknown as { MarkdownString?: typeof vscode.MarkdownString }
  ).MarkdownString;
  const markdown: vscode.MarkdownString = MarkdownCtor
    ? new MarkdownCtor(lines.join('\n'))
    : ({
        value: lines.join('\n'),
      } as vscode.MarkdownString);
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  return markdown;
}

async function listCharacterCardsInWorkspace(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<CharacterCard[]> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceFolder.uri);
  const entries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(
    paths.characterDirectory,
  );
  const cardNames: string[] = entries
    .filter(
      ([name, type]) =>
        type === vscode.FileType.File &&
        name.endsWith(STORYBOARD_FILE_EXTENSIONS.card) &&
        !isIgnoredSampleCardFileName(name),
    )
    .map(([name]) => name);

  const cards: (Character | undefined)[] = await Promise.all(
    cardNames.map(async (name) => {
      const uri: vscode.Uri = vscode.Uri.joinPath(paths.characterDirectory, name);
      try {
        const parsed: StoryboardCard = await readCardFile(uri, vscodeFsAdapter);
        return parsed.type === 'character' ? parsed : undefined;
      } catch {
        return undefined;
      }
    }),
  );

  return cards.filter((card): card is CharacterCard => card !== undefined);
}

export class CharacterHoverProvider implements vscode.HoverProvider {
  public register(): vscode.Disposable {
    const selector: vscode.DocumentSelector = {
      scheme: 'file',
      pattern: STORYBOARD_GLOBS.anyDraftMarkdown,
    };
    return vscode.languages.registerHoverProvider(selector, this);
  }

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      await resolveDraftWorkspaceFolder(document);
    if (!workspaceFolder) {
      return undefined;
    }

    const wordRange: vscode.Range | undefined = document.getWordRangeAtPosition(
      position,
      wordPattern,
    );
    if (!wordRange) {
      return undefined;
    }

    const hoveredWord: string = document.getText(wordRange).trim();
    if (hoveredWord.length === 0) {
      return undefined;
    }

    const characters: CharacterCard[] = await listCharacterCardsInWorkspace(workspaceFolder);
    if (characters.length === 0) {
      return undefined;
    }

    const matched: Character | undefined = findHoveredCharacter(hoveredWord, characters);
    if (!matched) {
      return undefined;
    }

    return new vscode.Hover(
      buildCharacterHoverMarkdown({
        character: matched,
        relatedCharacterNames: listRelatedCharacterNames(matched, characters),
      }),
      wordRange,
    );
  }
}

async function resolveDraftWorkspaceFolder(
  document: vscode.TextDocument,
): Promise<vscode.WorkspaceFolder | undefined> {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }

  const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
    document.uri,
  );
  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    return undefined;
  }

  return isDraftMarkdownFile(document.uri, workspaceFolder) ? workspaceFolder : undefined;
}

function findHoveredCharacter(
  hoveredWord: string,
  characters: readonly CharacterCard[],
): Character | undefined {
  const matchedNames: string[] = detectCharactersInText(
    hoveredWord,
    characters.map((character) => character.name),
  );
  return matchedNames.length > 0
    ? characters.find((character) => character.name === matchedNames[0])
    : undefined;
}

function listRelatedCharacterNames(
  matched: Character,
  characters: readonly CharacterCard[],
): string[] {
  const byId: Map<string, string> = new Map(
    characters.map((character) => [character.id, character.name] as const),
  );
  return (matched.relations ?? [])
    .map((relation) => byId.get(relation.target))
    .filter((name): name is string => typeof name === 'string');
}
