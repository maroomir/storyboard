import { parseSynopsisMarkdown, type StoryUri } from '@storyboard/story-model';

import type {
  INoteAbsorbRepository,
  NoteSynopsisCandidate,
} from '#engine/application/notes/noteAbsorbRepository';

export type ApplySynopsisCandidateResult =
  | { readonly ok: true; readonly location: string }
  | { readonly ok: false; readonly kind: 'none'; readonly message: string };

function newestFirst(left: NoteSynopsisCandidate, right: NoteSynopsisCandidate): number {
  return right.absorbedAt.localeCompare(left.absorbedAt);
}

export class SynopsisCandidateDesk {
  public constructor(private readonly noteAbsorb: INoteAbsorbRepository) {}

  public async list(workspaceRoot: StoryUri): Promise<readonly NoteSynopsisCandidate[]> {
    return [...(await this.noteAbsorb.listSynopsisCandidates(workspaceRoot))].sort(newestFirst);
  }

  public async apply(
    workspaceRoot: StoryUri,
    location?: string,
  ): Promise<ApplySynopsisCandidateResult> {
    const candidate: NoteSynopsisCandidate | undefined = (await this.list(workspaceRoot)).find(
      (item) => location === undefined || item.location === location,
    );
    if (candidate === undefined) {
      return { ok: false, kind: 'none', message: '적용할 시놉시스 후보가 없습니다.' };
    }

    await this.noteAbsorb.writeSynopsis(workspaceRoot, parseSynopsisMarkdown(candidate.markdown));
    await this.noteAbsorb.clearSynopsisCandidates(workspaceRoot);
    return { ok: true, location: candidate.location };
  }

  public async discard(workspaceRoot: StoryUri, location?: string): Promise<number> {
    const discarded: number = (await this.list(workspaceRoot)).filter(
      (item) => location === undefined || item.location === location,
    ).length;
    await this.noteAbsorb.clearSynopsisCandidates(workspaceRoot, location);
    return discarded;
  }
}
