import { setApiKey, showApiKeys } from '@/commands/apikey';
import { canonDiff, promoteBible } from '@/commands/canon';
import {
  buildStoryCards,
  createCard,
  discardCardCandidates,
  listCards,
  promoteCards,
  recommendCards,
  renameCard,
  showCard,
} from '@/commands/card';
import {
  applyDraftFormat,
  augmentDraft,
  checkDraft,
  condenseDraft,
  editDraft,
  expandDraft,
  generateScene,
  reviseScene,
  showDraft,
} from '@/commands/draft';
import { initProject } from '@/commands/init';
import { runLogin, runLogout } from '@/commands/login';
import { exportManuscript, reviewManuscript, summarizeChapters } from '@/commands/manuscript';
import { createNarrator, listNarrators, removeNarrator, showNarrator } from '@/commands/narrator';
import { absorbNotes, connectNotes, exportNotes } from '@/commands/notes';
import { generateNovel } from '@/commands/novel';
import type { CommandHandler } from '@/commands/outcome';
import { generateOutline } from '@/commands/outline';
import { setProjectContract, showProject } from '@/commands/project';
import {
  completeStory,
  createScene,
  generateSceneBeats,
  generateSceneSeeds,
  listScenes,
  renameScene,
  showScene,
} from '@/commands/scene';
import { runSetup } from '@/commands/setup';
import { applySim, rejudgeSim, reportSim, runSim, screenSim, sweepSim } from '@/commands/sim';
import { generateState, resealState } from '@/commands/state';
import { showStatus } from '@/commands/status';
import { assembleManuscript } from './manuscript';
import { runConfigSet, runConfigShow, runConfigUnset } from '@/commands/config';
import { runParamsShow } from '@/commands/params';
import { runDoctor } from '@/commands/doctor';

export const commands: Readonly<Record<string, CommandHandler>> = {
  init: initProject,
  setup: runSetup,
  'apikey set': setApiKey,
  'apikey show': showApiKeys,
  login: runLogin,
  logout: runLogout,
  'config show': runConfigShow,
  'config set': runConfigSet,
  'config unset': runConfigUnset,
  'params show': runParamsShow,
  doctor: runDoctor,
  status: showStatus,
  'project show': showProject,
  'project set': setProjectContract,
  'outline generate': generateOutline,
  'narrator list': listNarrators,
  'narrator show': showNarrator,
  'narrator create': createNarrator,
  'narrator remove': removeNarrator,
  'novel generate': generateNovel,
  'scene list': listScenes,
  'scene show': showScene,
  'scene create': createScene,
  'scene rename': renameScene,
  'scene seed': generateSceneSeeds,
  'scene plot': generateSceneBeats,
  'scene complete': completeStory,
  'draft generate': generateScene,
  'draft revise': reviseScene,
  'draft show': showDraft,
  'draft edit': editDraft,
  'draft augment': augmentDraft,
  'draft condense': condenseDraft,
  'draft expand': expandDraft,
  'draft format': applyDraftFormat,
  'draft check': checkDraft,
  'state generate': generateState,
  'state reseal': resealState,
  'card list': listCards,
  'card show': showCard,
  'card create': createCard,
  'card rename': renameCard,
  'card recommend': recommendCards,
  'card build': buildStoryCards,
  'card promote': promoteCards,
  'card discard': discardCardCandidates,
  'canon diff': canonDiff,
  'canon promote': promoteBible,
  'notes connect': connectNotes,
  'notes absorb': absorbNotes,
  'notes export': exportNotes,
  'manuscript assemble': assembleManuscript,
  'manuscript review': reviewManuscript,
  'manuscript summarize': summarizeChapters,
  'manuscript export': exportManuscript,
  'sim run': runSim,
  'sim screen': screenSim,
  'sim sweep': sweepSim,
  'sim report': reportSim,
  'sim rejudge': rejudgeSim,
  'sim apply': applySim,
};
