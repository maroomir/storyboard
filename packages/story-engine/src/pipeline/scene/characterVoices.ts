import type { SceneContext } from '@storyboard/story-model';

export function characterSpeechToOthers(
  characters: SceneContext['characters'],
): ReadonlyMap<string, readonly string[]> {
  const nameById: Map<string, string> = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const lines: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  for (const character of characters) {
    const rules: string[] = (character.relations ?? []).flatMap((relation) => {
      const target: string | undefined = nameById.get(relation.target);
      return relation.speech && target ? [`${target}에게: ${relation.speech}`] : [];
    });
    if (rules.length > 0) {
      lines.set(character.name, rules);
    }
  }

  return lines;
}
