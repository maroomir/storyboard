import type { AiProviderRegistry, ConfigBridge, SecretStore } from '@storyboard/story-ai';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { ICardSidebarRepository } from '#engine/application/cards/cardSidebarRepository';
import type { INarratorCardRepository } from '#engine/application/cards/narratorCardRepository';
import type { ISceneSidebarRepository } from '#engine/application/cards/sceneSidebarRepository';
import type {
  IDraftRepository,
  IProjectRepository,
  ISceneBatchRepository,
  ISceneCacheRepository,
  ISceneGroundingGapRepository,
  ISceneRepository,
} from '#engine/application/drafts/draftRepositories';
import type { INoteAbsorbRepository } from '#engine/application/notes/noteAbsorbRepository';
import type { INoteSourceProvider } from '#engine/application/notes/noteSource';
import type {
  INovelOutlineRepository,
  INovelReviewRepository,
  INovelRunStateRepository,
  IOutlineRepository,
  ISceneSeedRepository,
} from '#engine/application/novel/novelPipelinePorts';
import type { IStoryFeatureRepository } from '#engine/application/story/storyFeatureTypes';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { IUsageSink } from '#engine/ports/usageSink';
import type { IWorkspaceLocator } from '#engine/ports/workspaceLocator';
import type {
  IChapterSummaryRepository,
  IManuscriptAssemblyRepository,
  IManuscriptExportRepository,
  IManuscriptReviewRepository,
} from '#engine/application/manuscript/manuscriptRepositories';
import type {
  ICardCandidateRepository,
  ICardCollectRepository,
  ICardRecommendationRepository,
  ICardWriterRepository,
} from '#engine/application/cards/cardRepositories';
import type { IBibleCandidateRepository } from '#engine/application/project/bibleRepositories';

export interface HostAdapters {
  readonly fileSystem: IFileSystem;
  readonly workspaceLocator: IWorkspaceLocator;
  readonly logger: IStoryboardLogger;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly generator: string;
}

export interface AiServices {
  readonly gateway: AiGateway;
  readonly providerRegistry: AiProviderRegistry;
  readonly usageSink: IUsageSink;
}

export interface WorkspaceRepositories {
  readonly drafts: IDraftRepository;
  readonly scenes: ISceneRepository;
  readonly sceneBatches: ISceneBatchRepository;
  readonly sceneSeeds: ISceneSeedRepository;
  readonly sceneCache: ISceneCacheRepository;
  readonly sceneGroundingGaps: ISceneGroundingGapRepository;
  readonly sceneSidebar: ISceneSidebarRepository;
  readonly project: IProjectRepository;
  readonly outline: IOutlineRepository;
  readonly novelOutline: INovelOutlineRepository;
  readonly novelRunState: INovelRunStateRepository;
  readonly novelReviews: INovelReviewRepository;
  readonly manuscriptAssembly: IManuscriptAssemblyRepository;
  readonly chapterSummaries: IChapterSummaryRepository;
  readonly manuscriptExport: IManuscriptExportRepository;
  readonly manuscriptReview: IManuscriptReviewRepository;
  readonly cardWriter: ICardWriterRepository;
  readonly cardCandidates: ICardCandidateRepository;
  readonly cardCollect: ICardCollectRepository;
  readonly cardRecommendations: ICardRecommendationRepository;
  readonly cardSidebar: ICardSidebarRepository;
  readonly narratorCards: INarratorCardRepository;
  readonly bibleCandidates: IBibleCandidateRepository;
  readonly storyFeatures: IStoryFeatureRepository;
  readonly noteAbsorb: INoteAbsorbRepository;
  readonly noteSources: INoteSourceProvider;
}
