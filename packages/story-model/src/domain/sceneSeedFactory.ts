import { flattenChapterPlan } from '#model/format/outline';
import { serializeSceneCard } from '#model/format/files/scene';
import type { ChapterPlan, FlatChapterScene, ScenePlan } from '#model/format/outline';
import type { SceneCard } from '#model/format/scene';

export interface GeneratedSceneSeed {
  readonly stem: string;
  readonly fileName: string;
  readonly content: string;
}

export function buildSceneSeeds(plan: ChapterPlan, digitCount: number): GeneratedSceneSeed[] {
  const flatScenes: FlatChapterScene[] = flattenChapterPlan(plan);
  const usedSlugs: Set<string> = new Set<string>();

  return flatScenes.map((flatScene, index) => {
    const order: number = index + 1;
    const prefix: string = String(order).padStart(digitCount, '0');
    const slug: string = reserveUniqueSlug(deriveSlug(flatScene.scene, order), usedSlugs);
    const stem: string = `${prefix}-${slug}`;

    return {
      stem,
      fileName: `${stem}.card`,
      content: serializeSceneCard(buildSceneSeedCard(stem, flatScene)),
    };
  });
}

function deriveSlug(scene: ScenePlan, order: number): string {
  return slugify(scene.id) ?? slugify(scene.title) ?? `scene-${order}`;
}

function slugify(value: string): string | undefined {
  const slug: string = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : undefined;
}

function reserveUniqueSlug(slug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }

  let suffix: number = 2;
  while (usedSlugs.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueSlug: string = `${slug}-${suffix}`;
  usedSlugs.add(uniqueSlug);
  return uniqueSlug;
}

function buildSceneSeedCard(stem: string, flatScene: FlatChapterScene): SceneCard {
  const { scene } = flatScene;

  return {
    type: 'scene',
    id: stem,
    title: scene.title,
    ...(flatScene.chapterNarrator === undefined ? {} : { narrator: flatScene.chapterNarrator }),
    ...(flatScene.chapterThread === undefined ? {} : { thread: flatScene.chapterThread }),
    ...(scene.characters.length > 0 ? { characters: [...scene.characters] } : {}),
    ...(scene.location === undefined ? {} : { location: scene.location }),
    ...(scene.targetWordCount === undefined ? {} : { targetWordCount: scene.targetWordCount }),
    ...(scene.purpose.trim().length > 0 ? { purpose: scene.purpose } : {}),
    ...(scene.conflict === undefined ? {} : { conflict: scene.conflict }),
    ...(scene.twist === undefined ? {} : { twist: scene.twist }),
    ...(scene.emotionalShift === undefined ? {} : { emotionalShift: scene.emotionalShift }),
    ...(scene.foreshadowing.length > 0 ? { foreshadowing: [...scene.foreshadowing] } : {}),
    ...(scene.neededCanon && scene.neededCanon.length > 0
      ? { neededCanon: [...scene.neededCanon] }
      : {}),
  };
}
