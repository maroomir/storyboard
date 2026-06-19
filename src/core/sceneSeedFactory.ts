import yaml from "js-yaml"

import type { ChapterPlan, ScenePlan } from "../shared/outline"

export interface GeneratedSceneSeed {
  readonly stem: string
  readonly fileName: string
  readonly content: string
}

interface FlatScene {
  readonly scene: ScenePlan
  readonly actTitle: string
  readonly chapterTitle: string
}

export function buildSceneSeeds(plan: ChapterPlan, digitCount: number): GeneratedSceneSeed[] {
  const flatScenes = flattenScenes(plan)
  const usedSlugs = new Set<string>()

  return flatScenes.map((flatScene, index) => {
    const order = index + 1
    const prefix = String(order).padStart(digitCount, "0")
    const slug = reserveUniqueSlug(deriveSlug(flatScene.scene, order), usedSlugs)
    const stem = `${prefix}-${slug}`

    return {
      stem,
      fileName: `${stem}.txt`,
      content: buildSceneSeedContent(flatScene)
    }
  })
}

function flattenScenes(plan: ChapterPlan): FlatScene[] {
  const flatScenes: FlatScene[] = []

  for (const act of plan.acts) {
    for (const chapter of act.chapters) {
      for (const scene of chapter.scenes) {
        flatScenes.push({ scene, actTitle: act.title, chapterTitle: chapter.title })
      }
    }
  }

  return flatScenes
}

function deriveSlug(scene: ScenePlan, order: number): string {
  return slugify(scene.id) ?? slugify(scene.title) ?? `scene-${order}`
}

function slugify(value: string): string | undefined {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : undefined
}

function reserveUniqueSlug(slug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug)
    return slug
  }

  let suffix = 2
  while (usedSlugs.has(`${slug}-${suffix}`)) {
    suffix += 1
  }

  const uniqueSlug = `${slug}-${suffix}`
  usedSlugs.add(uniqueSlug)
  return uniqueSlug
}

function buildSceneSeedContent(flatScene: FlatScene): string {
  return `---\n${buildFrontmatter(flatScene.scene)}---\n${buildBody(flatScene)}`
}

function buildFrontmatter(scene: ScenePlan): string {
  const frontmatter: Record<string, unknown> = { title: scene.title }

  if (scene.characters.length > 0) {
    frontmatter.characters = [...scene.characters]
  }
  if (scene.location !== undefined) {
    frontmatter.location = scene.location
  }

  return yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
}

function buildBody(flatScene: FlatScene): string {
  const { scene } = flatScene
  const blocks: string[] = [`[목적]\n${scene.purpose.trim().length > 0 ? scene.purpose : "_미작성_"}`]

  if (scene.emotionalShift !== undefined) {
    blocks.push(`[감정 변화]\n${scene.emotionalShift}`)
  }
  if (scene.foreshadowing.length > 0) {
    blocks.push(`[회수할 복선]\n${scene.foreshadowing.map((item) => `- ${item}`).join("\n")}`)
  }

  blocks.push(
    `> ${flatScene.actTitle} · ${flatScene.chapterTitle} — 자동 생성된 씬 시드입니다. 초안 생성 전에 자유롭게 수정하세요.`
  )

  return `${blocks.join("\n\n")}\n`
}
