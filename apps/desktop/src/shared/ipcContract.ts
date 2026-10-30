import { z } from 'zod';

import {
  aiProviderIds,
  compositionKinds,
  pointOfViews,
  bibleFactSchema,
  cardIdPattern,
  isOnDecimalStep,
  sceneStemPattern,
  novelRunModes,
  type CompositionKind,
  type PointOfView,
} from '@storyboard/story-model/contracts';

import type {
  AppBootstrap,
  BibleCard,
  BibleCardKind,
  BibleCardSummary,
  CanonFact,
  DesktopSettings,
  DraftDocument,
  NotesApplyView,
  NotesEstimateView,
  NotesPlanView,
  RunSnapshot,
  SceneNotes,
  SnapshotEntry,
  UiLanguage,
  WorkspaceOverview,
} from '@/shared/dto';

const sceneStemSchema: z.ZodType<string> = z.string().regex(sceneStemPattern);
const cardIdSchema: z.ZodType<string> = z.string().regex(cardIdPattern);
const uiLanguageSchema: z.ZodType<UiLanguage> = z.enum(['ko', 'en']);
const bibleCardKindSchema: z.ZodType<BibleCardKind> = z.enum(['character', 'background', 'narrator']);
const empty: z.ZodType<Record<string, never>> = z.object({}).strict();

export interface WorkspaceCreateRequest {
  readonly title: string;
  readonly genre: string;
  readonly audience: string;
  readonly pov: PointOfView;
  readonly composition: CompositionKind;
  readonly chapterCount: number;
  readonly scenesPerChapter: number;
  readonly targetWordCount: number;
  readonly concept: string;
}

export const workspaceCreateRequestSchema: z.ZodType<WorkspaceCreateRequest> = z.object({
  title: z.string().trim().min(1).max(120),
  genre: z.string().trim().min(1).max(60),
  audience: z.string().trim().min(1).max(60),
  pov: z.enum(pointOfViews),
  composition: z.enum(compositionKinds),
  chapterCount: z.number().int().min(1).max(200),
  scenesPerChapter: z.number().int().min(1).max(20),
  targetWordCount: z.number().int().min(1_000).max(2_000_000),
  concept: z.string().trim().min(1).max(4_000),
});

export const invokeRequestSchemas = {
  'app.bootstrap': empty,
  'app.setLanguage': z.object({ language: uiLanguageSchema }),
  'app.installUpdate': empty,

  'workspace.open': z.object({ recentPath: z.string().min(1).optional() }),
  'workspace.chooseParentDirectory': empty,
  'workspace.create': z.object({
    parentDirectory: z.string().min(1),
    request: workspaceCreateRequestSchema,
  }),
  'workspace.close': empty,
  'workspace.overview': empty,

  'draft.read': z.object({ stem: sceneStemSchema }),
  'draft.save': z.object({
    stem: sceneStemSchema,
    body: z.string().max(2_000_000),
    reason: z.enum(['autosave', 'ai-edit']),
  }),
  'draft.endSession': z.object({ stem: sceneStemSchema }),
  'draft.proposeEdit': z.object({
    stem: sceneStemSchema,
    selectedText: z.string().min(1).max(50_000),
    instruction: z.string().trim().min(1).max(2_000),
  }),
  'scene.notes': z.object({ stem: sceneStemSchema }),
  'scene.rename': z.object({ stem: sceneStemSchema, to: sceneStemSchema }),

  'run.status': empty,
  'run.startNovel': z.object({ mode: z.enum(novelRunModes), resume: z.boolean() }),
  'run.generateScene': z.object({ stem: sceneStemSchema, force: z.boolean() }),
  'run.pause': empty,
  'run.answerApproval': z.object({ approved: z.boolean() }),
  'run.setBudget': z.object({ budgetUsd: z.number().min(0).max(10_000).refine(isOnDecimalStep) }),

  'bible.list': z.object({ kind: bibleCardKindSchema }),
  'bible.read': z.object({ kind: bibleCardKindSchema, id: cardIdSchema }),
  'bible.save': z.object({ kind: bibleCardKindSchema, card: z.record(z.string(), z.unknown()) }),
  'bible.create': z.object({
    kind: bibleCardKindSchema,
    id: cardIdSchema,
    name: z.string().trim().min(1).max(80),
  }),
  'bible.delete': z.object({ kind: bibleCardKindSchema, id: cardIdSchema }),
  'canon.list': empty,
  'canon.save': z.object({ fact: bibleFactSchema }),
  'canon.delete': z.object({ id: z.string().min(1) }),

  'settings.read': empty,
  'settings.setDefaultProvider': z.object({ providerId: z.enum(aiProviderIds) }),
  'settings.setModel': z.object({ providerId: z.enum(aiProviderIds), model: z.string().min(1) }),
  'settings.setApiKey': z.object({
    providerId: z.enum(aiProviderIds),
    apiKey: z.string().trim().min(8).max(500),
  }),
  'settings.setValue': z.object({
    key: z.string().min(1),
    value: z.union([z.boolean(), z.number(), z.string()]),
  }),
  'settings.setOllamaBaseUrl': z.object({ baseUrl: z.string().url() }),

  'history.list': empty,
  'history.restore': z.object({ id: z.string().regex(/^[0-9a-f]{40}$/) }),

  'notes.chooseLocation': z.object({ kind: z.enum(['folder', 'zip']) }),
  'notes.collect': z.object({
    location: z.union([
      z.object({ kind: z.literal('path'), path: z.string().min(1) }),
      z.object({ kind: z.literal('notion'), pageUrl: z.string().url() }),
    ]),
  }),
  'notes.plan': empty,
  'notes.apply': z.object({ fillContract: z.boolean() }),
  'notes.connectNotion': z.object({ token: z.string().trim().min(8).max(500) }),
} satisfies Readonly<Record<string, z.ZodType>>;

export type InvokeChannel = keyof typeof invokeRequestSchemas;

export type InvokeRequest<C extends InvokeChannel> = z.infer<(typeof invokeRequestSchemas)[C]>;

export const invokeChannels: readonly InvokeChannel[] = Object.keys(invokeRequestSchemas) as readonly InvokeChannel[];

export interface InvokeResponses {
  'app.bootstrap': AppBootstrap;
  'app.setLanguage': { readonly language: UiLanguage };
  'app.installUpdate': Record<string, never>;
  'workspace.open': WorkspaceOverview | { readonly cancelled: true };
  'workspace.chooseParentDirectory': { readonly directory?: string };
  'workspace.create': WorkspaceOverview;
  'workspace.close': Record<string, never>;
  'workspace.overview': WorkspaceOverview;
  'draft.read': DraftDocument;
  'draft.save': { readonly kind: 'saved' | 'unchanged' };
  'draft.endSession': Record<string, never>;
  'draft.proposeEdit': { readonly text: string };
  'scene.notes': SceneNotes;
  'scene.rename': { readonly stem: string };
  'run.status': RunSnapshot;
  'run.startNovel': RunSnapshot;
  'run.generateScene': RunSnapshot;
  'run.pause': RunSnapshot;
  'run.answerApproval': RunSnapshot;
  'run.setBudget': RunSnapshot;
  'bible.list': readonly BibleCardSummary[];
  'bible.read': BibleCard;
  'bible.save': BibleCard;
  'bible.create': BibleCard;
  'bible.delete': Record<string, never>;
  'canon.list': readonly CanonFact[];
  'canon.save': readonly CanonFact[];
  'canon.delete': readonly CanonFact[];
  'settings.read': DesktopSettings;
  'settings.setDefaultProvider': DesktopSettings;
  'settings.setModel': DesktopSettings;
  'settings.setApiKey': DesktopSettings;
  'settings.setValue': DesktopSettings;
  'settings.setOllamaBaseUrl': DesktopSettings;
  'history.list': readonly SnapshotEntry[];
  'history.restore': readonly SnapshotEntry[];
  'notes.chooseLocation': { readonly path?: string };
  'notes.collect': NotesEstimateView;
  'notes.plan': NotesPlanView;
  'notes.apply': NotesApplyView;
  'notes.connectNotion': DesktopSettings;
}

export type DesktopErrorCode =
  | 'invalid-request'
  | 'no-workspace'
  | 'not-a-workspace'
  | 'already-exists'
  | 'workspace-locked'
  | 'run-active'
  | 'provider-missing'
  | 'provider-rejected'
  | 'contract-incomplete'
  | 'not-found'
  | 'failed'
  | 'internal';

export interface DesktopError {
  readonly code: DesktopErrorCode;
  readonly message: string;
}

export type InvokeResult<C extends InvokeChannel> =
  | { readonly ok: true; readonly data: InvokeResponses[C] }
  | { readonly ok: false; readonly error: DesktopError };

export type WorkspaceArea = 'toc' | 'draft' | 'bible' | 'canon' | 'lock' | 'settings';

export interface DesktopEvents {
  'run.changed': RunSnapshot;
  'workspace.changed': {
    readonly areas: readonly WorkspaceArea[];
    readonly draftStems: readonly string[];
  };
  'app.updateReady': { readonly version: string };
}

export type DesktopEventName = keyof DesktopEvents;

export interface DesktopBridge {
  invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>>;
  on<E extends DesktopEventName>(event: E, listener: (payload: DesktopEvents[E]) => void): () => void;
}
