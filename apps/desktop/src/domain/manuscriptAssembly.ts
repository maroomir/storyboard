import { flattenChapterPlan } from '@storyboard/story-format';
import type { ChapterPlan, FlatChapterScene } from '@storyboard/story-format';

export interface ManuscriptDraftEntry {
  readonly stem: string;
  readonly body: string;
}

export interface AssembleManuscriptInput {
  readonly plan: ChapterPlan;
  readonly projectName: string;
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
}

export interface AssembledChapter {
  readonly fileName: string;
  readonly actTitle: string;
  readonly chapterTitle: string;
  readonly markdown: string;
}

export interface AssembledManuscript {
  readonly chapters: AssembledChapter[];
  readonly volumeMarkdown: string;
  readonly includedCount: number;
  readonly missingCount: number;
  readonly extraCount: number;
}

interface ChapterGroup {
  readonly actTitle: string;
  readonly chapterTitle: string;
  readonly scenes: IndexedFlatScene[];
}

const extraChapterTitle = '기타 (계획 외)';

export function assembleManuscript(input: AssembleManuscriptInput): AssembledManuscript {
  const flatScenes = flattenChapterPlan(input.plan);
  const groups = groupByChapter(flatScenes);

  let includedCount = 0;
  let missingCount = 0;
  const usedSlugs = new Set<string>();

  const chapters: AssembledChapter[] = groups.map((group, groupIndex) => {
    const sceneBlocks = group.scenes.map((flatScene, sceneIndexInGroup) => {
      const order = flatScene.globalIndex + 1;
      const draft = input.draftsByOrder.get(order);

      if (draft) {
        includedCount += 1;
        return sceneBlock(flatScene.scene.title, draft.body, sceneIndexInGroup);
      }

      missingCount += 1;
      return missingSceneBlock(flatScene.scene.title, sceneIndexInGroup);
    });

    return buildChapter(group, groupIndex, sceneBlocks, usedSlugs);
  });

  const extras = collectExtraDrafts(input.draftsByOrder, flatScenes.length);
  if (extras.length > 0) {
    chapters.push(buildExtraChapter(extras, groups.length, usedSlugs));
  }

  return {
    chapters,
    volumeMarkdown: buildVolume(input.projectName, chapters),
    includedCount,
    missingCount,
    extraCount: extras.length,
  };
}

interface IndexedFlatScene extends FlatChapterScene {
  readonly globalIndex: number;
}

function groupByChapter(flatScenes: readonly FlatChapterScene[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];

  flatScenes.forEach((flatScene, globalIndex) => {
    const last = groups.at(-1);
    const isSameChapter =
      last !== undefined &&
      last.scenes[0]?.actIndex === flatScene.actIndex &&
      last.scenes[0]?.chapterIndex === flatScene.chapterIndex;

    const indexedScene: IndexedFlatScene = { ...flatScene, globalIndex };

    if (isSameChapter) {
      last.scenes.push(indexedScene);
      return;
    }

    groups.push({
      actTitle: flatScene.actTitle,
      chapterTitle: flatScene.chapterTitle,
      scenes: [indexedScene],
    });
  });

  return groups;
}

function buildChapter(
  group: ChapterGroup,
  groupIndex: number,
  sceneBlocks: string[],
  usedSlugs: Set<string>,
): AssembledChapter {
  const prefix = String(groupIndex + 1).padStart(2, '0');
  const slug = reserveUniqueSlug(
    slugify(group.chapterTitle) ?? `chapter-${groupIndex + 1}`,
    usedSlugs,
  );
  const heading = `# ${group.chapterTitle}\n\n*${group.actTitle}*`;

  return {
    fileName: `${prefix}-${slug}.md`,
    actTitle: group.actTitle,
    chapterTitle: group.chapterTitle,
    markdown: `${[heading, ...sceneBlocks].join('\n\n')}\n`,
  };
}

function buildExtraChapter(
  extras: readonly ManuscriptDraftEntry[],
  groupCount: number,
  usedSlugs: Set<string>,
): AssembledChapter {
  const prefix = String(groupCount + 1).padStart(2, '0');
  const slug = reserveUniqueSlug('extras', usedSlugs);
  const blocks = extras.map((draft, index) => sceneBlock(draft.stem, draft.body, index));

  return {
    fileName: `${prefix}-${slug}.md`,
    actTitle: extraChapterTitle,
    chapterTitle: extraChapterTitle,
    markdown: `${[`# ${extraChapterTitle}`, ...blocks].join('\n\n')}\n`,
  };
}

function buildVolume(projectName: string, chapters: readonly AssembledChapter[]): string {
  const sections: string[] = [`# ${projectName}`];
  let lastActTitle: string | undefined;

  for (const chapter of chapters) {
    if (chapter.actTitle !== lastActTitle) {
      sections.push(`## ${chapter.actTitle}`);
      lastActTitle = chapter.actTitle;
    }

    sections.push(demoteHeadings(chapter.markdown.trimEnd()));
  }

  return `${sections.join('\n\n')}\n`;
}

function demoteHeadings(chapterMarkdown: string): string {
  return chapterMarkdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('## ')) {
        return `#### ${line.slice(3)}`;
      }
      if (line.startsWith('# ')) {
        return `### ${line.slice(2)}`;
      }
      return line;
    })
    .join('\n');
}

function sceneBlock(title: string, body: string, sceneIndexInGroup: number): string {
  const heading = `## ${title.trim().length > 0 ? title : `장면 ${sceneIndexInGroup + 1}`}`;
  return `${heading}\n\n${body.trim()}`;
}

function missingSceneBlock(title: string, sceneIndexInGroup: number): string {
  const label = title.trim().length > 0 ? title : `장면 ${sceneIndexInGroup + 1}`;
  return `## ${label}\n\n> (초안 없음: ${label})`;
}

function collectExtraDrafts(
  draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>,
  plannedSceneCount: number,
): ManuscriptDraftEntry[] {
  return [...draftsByOrder.entries()]
    .filter(([order]) => order > plannedSceneCount)
    .sort(([a], [b]) => a - b)
    .map(([, draft]) => draft);
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
