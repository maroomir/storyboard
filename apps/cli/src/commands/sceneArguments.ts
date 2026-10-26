import type { ParsedArguments } from '@/cliArguments';
import { parseSceneFileName, scenePath, type StoryUri } from '@storyboard/story-model';

export function sceneStemFrom(args: ParsedArguments, positionalIndex = 0): string | undefined {
  const raw: string | undefined = args.positionals[positionalIndex];
  if (raw === undefined) {
    return undefined;
  }
  const fileName: string = raw.endsWith('.card') ? raw : `${raw}.card`;
  return parseSceneFileName(fileName)?.stem ?? raw.replace(/\.card$/, '');
}

export function sceneUriFor(root: StoryUri, stem: string): StoryUri {
  return scenePath(root, stem);
}
