import { flattenChapterPlan } from './outline';
import type { ChapterPlan, FlatChapterScene } from './outline';

export interface ManuscriptDraftEntry {
  readonly stem: string;
  readonly body: string;
}

export interface AssembleManuscriptInput {
  readonly plan: ChapterPlan;
  readonly projectName: string;
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly annotateSceneStems?: boolean;
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

const extraChapterTitle: string = '기타 (계획 외)';

export function assembleManuscript(input: AssembleManuscriptInput): AssembledManuscript {
  const flatScenes: FlatChapterScene[] = flattenChapterPlan(input.plan);
  const groups: ChapterGroup[] = groupByChapter(flatScenes);

  let includedCount: number = 0;
  let missingCount: number = 0;
  const usedSlugs: Set<string> = new Set<string>();

  const chapters: AssembledChapter[] = groups.map((group, groupIndex) => {
    const sceneBlocks: string[] = group.scenes.map((flatScene, sceneIndexInGroup) => {
      const order: number = flatScene.globalIndex + 1;
      const draft: ManuscriptDraftEntry | undefined = input.draftsByOrder.get(order);

      if (draft) {
        includedCount += 1;
        return sceneBlock(
          flatScene.scene.title,
          draft.body,
          sceneIndexInGroup,
          input.annotateSceneStems === true ? draft.stem : undefined,
        );
      }

      missingCount += 1;
      return missingSceneBlock(flatScene.scene.title, sceneIndexInGroup);
    });

    return buildChapter(group, groupIndex, sceneBlocks, usedSlugs);
  });

  const extras: ManuscriptDraftEntry[] = collectExtraDrafts(input.draftsByOrder, flatScenes.length);
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
    const last: ChapterGroup | undefined = groups.at(-1);
    const isSameChapter: boolean =
      last !== undefined &&
      last.scenes[0]?.actIndex === flatScene.actIndex &&
      last.scenes[0]?.chapterIndex === flatScene.chapterIndex;

    const indexedScene: IndexedFlatScene = { ...flatScene, globalIndex };

    if (isSameChapter && last !== undefined) {
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
  const prefix: string = String(groupIndex + 1).padStart(2, '0');
  const slug: string = reserveUniqueSlug(
    slugify(group.chapterTitle) ?? `chapter-${groupIndex + 1}`,
    usedSlugs,
  );
  const heading: string = `# ${group.chapterTitle}\n\n*${group.actTitle}*`;

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
  const prefix: string = String(groupCount + 1).padStart(2, '0');
  const slug: string = reserveUniqueSlug('extras', usedSlugs);
  const blocks: string[] = extras.map((draft, index) => sceneBlock(draft.stem, draft.body, index));

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

export function sceneStemMarker(stem: string): string {
  return `<!-- scene: ${stem} -->`;
}

function sceneBlock(title: string, body: string, sceneIndexInGroup: number, stem?: string): string {
  const heading: string = `## ${title.trim().length > 0 ? title : `장면 ${sceneIndexInGroup + 1}`}`;
  const marker: string = stem === undefined ? '' : `${sceneStemMarker(stem)}\n\n`;
  return `${heading}\n\n${marker}${body.trim()}`;
}

function missingSceneBlock(title: string, sceneIndexInGroup: number): string {
  const label: string = title.trim().length > 0 ? title : `장면 ${sceneIndexInGroup + 1}`;
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
