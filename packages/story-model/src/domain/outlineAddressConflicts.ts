import type { ChapterPlan, ChapterPlanChapter, ScenePlan } from '#model/format/outline';

export interface BuildingUnitAddress {
  readonly building: string;
  readonly unit: string;
  readonly text: string;
}

export interface OutlineAddressConflict {
  readonly cardAddress: string;
  readonly outlineAddress: string;
}

const buildingUnitAddressPattern: RegExp = /(\d+)\s*동\s*(\d+)\s*호/g;

export function findBuildingUnitAddresses(text: string): BuildingUnitAddress[] {
  return [...text.matchAll(buildingUnitAddressPattern)].map(
    (match): BuildingUnitAddress => ({
      building: match[1] ?? '',
      unit: match[2] ?? '',
      text: `${match[1] ?? ''}동 ${match[2] ?? ''}호`,
    }),
  );
}

function describeScenePlan(scene: ScenePlan): string[] {
  return [
    scene.title,
    scene.purpose,
    scene.location ?? '',
    scene.conflict ?? '',
    scene.twist ?? '',
    scene.emotionalShift ?? '',
    ...scene.foreshadowing,
  ];
}

function describeChapter(chapter: ChapterPlanChapter): string {
  return [chapter.title, chapter.summary ?? '', ...chapter.scenes.flatMap(describeScenePlan)].join(
    '\n',
  );
}

export function listChapterTextsBySceneOrder(plan: ChapterPlan): string[] {
  return plan.acts.flatMap((act) =>
    act.chapters.flatMap((chapter): string[] => {
      const chapterText: string = describeChapter(chapter);
      return chapter.scenes.map((): string => chapterText);
    }),
  );
}

export function findOutlineAddressConflicts(
  cardTexts: readonly string[],
  outlineText: string,
): OutlineAddressConflict[] {
  const outlineAddresses: BuildingUnitAddress[] = findBuildingUnitAddresses(outlineText);
  const conflicts: Map<string, OutlineAddressConflict> = new Map();

  for (const cardAddress of cardTexts.flatMap(findBuildingUnitAddresses)) {
    const isInOutline: boolean = outlineAddresses.some(
      (address) => address.building === cardAddress.building && address.unit === cardAddress.unit,
    );
    const sameUnitElsewhere: BuildingUnitAddress | undefined = outlineAddresses.find(
      (address) => address.unit === cardAddress.unit && address.building !== cardAddress.building,
    );
    if (!isInOutline && sameUnitElsewhere !== undefined) {
      conflicts.set(cardAddress.text, {
        cardAddress: cardAddress.text,
        outlineAddress: sameUnitElsewhere.text,
      });
    }
  }

  return [...conflicts.values()];
}
