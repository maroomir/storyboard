import type { ParsedArguments } from '@/cliArguments';
import type { CliContainer } from '@/container';
import { parseSceneFileName, scenePath, type SceneFile, type StoryUri } from '@storyboard/story-model';

export function sceneStemFrom(args: ParsedArguments, positionalIndex = 0): string | undefined {
  const raw: string | undefined = args.positionals[positionalIndex];
  if (raw === undefined) {
    return undefined;
  }
  const fileName: string = raw.endsWith('.card') ? raw : `${raw}.card`;
  return parseSceneFileName(fileName)?.stem ?? raw.replace(/\.card$/, '');
}

export async function resolveSceneStemFrom(
  container: Pick<CliContainer, 'drafts' | 'workspaceRoot'>,
  args: ParsedArguments,
  positionalIndex = 0,
): Promise<string | undefined> {
  const reference: string | undefined = sceneStemFrom(args, positionalIndex);
  if (reference === undefined) {
    return undefined;
  }

  const scene: SceneFile | undefined = await container.drafts.readScene(
    container.workspaceRoot,
    reference,
  );
  return scene?.stem ?? reference;
}

export function sceneUriFor(root: StoryUri, stem: string): StoryUri {
  return scenePath(root, stem);
}
