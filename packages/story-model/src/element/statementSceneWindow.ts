import type { Statement } from '#model/element/statement';

export interface RemovedSceneNeighbours {
  readonly previous?: string;
  readonly next?: string;
}

interface SceneWindowRetarget {
  readonly removedSceneId: string;
  readonly neighbours: RemovedSceneNeighbours;
}

function moveStart(value: string | undefined, retarget: SceneWindowRetarget): string | undefined {
  const { removedSceneId, neighbours } = retarget;
  return value === removedSceneId ? (neighbours.next ?? neighbours.previous) : value;
}

function moveEnd(value: string | undefined, retarget: SceneWindowRetarget): string | undefined {
  const { removedSceneId, neighbours } = retarget;
  return value === removedSceneId ? (neighbours.previous ?? neighbours.next) : value;
}

function retargetStatement(statement: Statement, retarget: SceneWindowRetarget): Statement {
  const { since, until, revealFrom, ...rest } = statement;
  const movedSince: string | undefined = moveStart(since, retarget);
  const movedUntil: string | undefined = moveEnd(until, retarget);
  const movedRevealFrom: string | undefined = moveStart(revealFrom, retarget);
  const isUntouched: boolean =
    movedSince === since && movedUntil === until && movedRevealFrom === revealFrom;

  if (isUntouched) {
    return statement;
  }

  return {
    ...rest,
    ...(movedSince === undefined ? {} : { since: movedSince }),
    ...(movedUntil === undefined ? {} : { until: movedUntil }),
    ...(movedRevealFrom === undefined ? {} : { revealFrom: movedRevealFrom }),
  };
}

export function retargetRemovedSceneWindows(
  statements: readonly Statement[],
  removedSceneId: string,
  neighbours: RemovedSceneNeighbours,
): readonly Statement[] | undefined {
  const retarget: SceneWindowRetarget = { removedSceneId, neighbours };
  const retargeted: Statement[] = statements.map((statement) =>
    retargetStatement(statement, retarget),
  );
  const hasChanged: boolean = retargeted.some((statement, index) => statement !== statements[index]);

  return hasChanged ? retargeted : undefined;
}
