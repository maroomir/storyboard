import { outlineOfChapterPlan, parseChapterPlan, serializeChapterOutline } from "@storyboard/story-model"

export function unseededOutlineYaml(chapterPlanYaml: string): string {
  return serializeChapterOutline(outlineOfChapterPlan(parseChapterPlan(chapterPlanYaml), () => undefined))
}
