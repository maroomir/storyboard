import yaml from 'js-yaml';

import { flattenChapterPlan } from '@storyboard/story-format';
import type { ChapterPlan, FlatChapterScene, ScenePlan } from '@storyboard/story-format';

export interface GeneratedSceneSeed {
  readonly stem: string;
  readonly fileName: string;
  readonly content: string;
}

export function buildSceneSeeds(plan: ChapterPlan, digitCount: number): GeneratedSceneSeed[] {
  const flatScenes = flattenChapterPlan(plan);
  const usedSlugs = new Set<string>();

  return flatScenes.map((flatScene, index) => {
    const order = index + 1;
    const prefix = String(order).padStart(digitCount, '0');
    const slug = reserveUniqueSlug(deriveSlug(flatScene.scene, order), usedSlugs);
    const stem = `${prefix}-${slug}`;

    return {
      stem,
      fileName: `${stem}.txt`,
      content: buildSceneSeedContent(flatScene),
    };
  });
}

function deriveSlug(scene: ScenePlan, order: number): string {
  return slugify(scene.id) ?? slugify(scene.title) ?? `scene-${order}`;
}

function slugify(value: string): string | undefined {
  const slug = value
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

  let suffix = 2;
  while (usedSlugs.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueSlug = `${slug}-${suffix}`;
  usedSlugs.add(uniqueSlug);
  return uniqueSlug;
}

function buildSceneSeedContent(flatScene: FlatChapterScene): string {
  return `---\n${buildFrontmatter(flatScene.scene)}---\n${buildBody(flatScene)}`;
}

function buildFrontmatter(scene: ScenePlan): string {
  const frontmatter: Record<string, unknown> = { title: scene.title };

  if (scene.characters.length > 0) {
    frontmatter.characters = [...scene.characters];
  }
  if (scene.location !== undefined) {
    frontmatter.location = scene.location;
  }

  return yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false });
}

function buildBody(flatScene: FlatChapterScene): string {
  const { scene } = flatScene;
  const blocks: string[] = [
    `[목적]\n${scene.purpose.trim().length > 0 ? scene.purpose : '_미작성_'}`,
  ];

  if (scene.conflict !== undefined) {
    blocks.push(`[갈등]\n${scene.conflict}`);
  }
  if (scene.twist !== undefined) {
    blocks.push(`[반전]\n${scene.twist}`);
  }
  if (scene.emotionalShift !== undefined) {
    blocks.push(`[감정 변화]\n${scene.emotionalShift}`);
  }
  if (scene.foreshadowing.length > 0) {
    blocks.push(`[회수할 복선]\n${scene.foreshadowing.map((item) => `- ${item}`).join('\n')}`);
  }
  if (scene.neededCanon && scene.neededCanon.length > 0) {
    blocks.push(`[필요 설정]\n${scene.neededCanon.map((item) => `- ${item}`).join('\n')}`);
  }
  if (scene.targetWordCount !== undefined) {
    blocks.push(`[목표 분량]\n약 ${scene.targetWordCount.toLocaleString()}자`);
  }

  blocks.push(
    `> ${flatScene.actTitle} · ${flatScene.chapterTitle} — 자동 생성된 씬 시드입니다. 초안 생성 전에 자유롭게 수정하세요.`,
  );

  return `${blocks.join('\n\n')}\n`;
}
