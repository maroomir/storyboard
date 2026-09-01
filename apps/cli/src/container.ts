import {
  AiGateway,
  AssembleManuscriptUseCase,
  BibleCandidateRepository,
  BuildStoryCardsUseCase,
  CardCandidateRepository,
  CardCollectRepository,
  CardRecommendationRepository,
  CardWriterRepository,
  CollectCardProposalsUseCase,
  CompleteStoryScenesUseCase,
  CreateCardUseCase,
  ExportManuscriptUseCase,
  GenerateAllDraftsUseCase,
  GenerateDraftUseCase,
  GenerateOutlineUseCase,
  ManuscriptAssemblyRepository,
  NovelPipeline,
  NovelReviewRepository,
  NovelRunStateRepository,
  OutlineRepository,
  PostGenerationUpdateManager,
  PromoteBibleCandidatesUseCase,
  PromoteCardCandidatesUseCase,
  RecommendCardsUseCase,
  ReviewManuscriptUseCase,
  ReviseAfterGenerateGate,
  ReviseDraftUseCase,
  SceneBatchRepository,
  SceneCacheRepository,
  SceneRepository,
  SceneSeedRepository,
  StoryFeatureRepository,
  SummarizeChaptersUseCase,
  DraftRepository,
  ProjectRepository,
  NodeUri,
  type StoryUri,
  type StoryWorkspaceFolder,
  type UsageSink,
} from '@storyboard/story-engine';
import { ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';

import { ConsoleLogger } from './adapters/consoleLogger';
import { createFileConfiguration } from './adapters/fileConfiguration';
import { createFileSecretStorage } from './adapters/fileSecretStorage';
import { NodeFileSystem } from './adapters/nodeFileSystem';
import { NodeWorkspaceLocator } from './adapters/nodeWorkspaceLocator';
import { resolveCliPaths } from './adapters/paths';

export interface CliContainer {
  readonly workspaceRoot: StoryUri;
  readonly logger: ConsoleLogger;
  readonly fileSystem: NodeFileSystem;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly novelPipeline: NovelPipeline;
}

export interface CliContainerOptions {
  readonly workspacePath: string;
  readonly verbose: boolean;
  readonly version: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reviseMaxIterations?: number;
}

// `--provider`/`--model` are the terminal's form of the settings the extension keeps in its UI, so
// they are layered onto the config rather than threaded through every call.
function configOverrides(options: CliContainerOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (options.provider !== undefined) {
    overrides['defaultProvider'] = options.provider;

    if (options.model !== undefined) {
      overrides[`providers.${options.provider}.model`] = options.model;
    }
  }

  if (options.reviseMaxIterations !== undefined) {
    overrides['revise.maxIterations'] = options.reviseMaxIterations;
  }

  return overrides;
}

// The CLI's service graph. It mirrors the extension's platform module one-for-one: only the four
// host adapters differ, which is the whole point of the engine boundary.
export function createCliContainer(options: CliContainerOptions): CliContainer {
  const paths = resolveCliPaths();
  const workspaceRoot = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };

  const logger = new ConsoleLogger(options.verbose);
  const fileSystem = new NodeFileSystem();
  const workspaceLocator = new NodeWorkspaceLocator(folder);
  const secretStore = new SecretStore(createFileSecretStorage(paths.secretsFile));
  const configBridge = new ConfigBridge({
    getConfiguration: () =>
      createFileConfiguration(
        paths.configFile,
        `${workspaceRoot.fsPath}/.storyboard/cli.json`.replace('//', '/'),
        configOverrides(options),
      ),
  });
  const aiProviderRegistry = createAiProviderRegistry({ secretStore, configBridge });

  // The CLI has no usage panel; the ledger the extension keeps is not worth a file write here, so
  // cost is reported per run instead of persisted.
  const usageSink: UsageSink = { record: async (): Promise<void> => undefined };
  const aiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);
  const generator = `storyboard@${options.version}`;

  const draftRepository = new DraftRepository(fileSystem);
  const projectRepository = new ProjectRepository(fileSystem);
  const sceneRepository = new SceneRepository(fileSystem);
  const sceneCacheRepository = new SceneCacheRepository(fileSystem);
  const sceneSeedRepository = new SceneSeedRepository(fileSystem);
  const sceneBatchRepository = new SceneBatchRepository(fileSystem, workspaceLocator);
  const outlineRepository = new OutlineRepository(fileSystem);
  const novelRunStateRepository = new NovelRunStateRepository(fileSystem);
  const novelReviewRepository = new NovelReviewRepository(fileSystem);
  const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository(fileSystem);
  const cardWriterRepository = new CardWriterRepository(fileSystem);
  const cardCollectRepository = new CardCollectRepository(fileSystem);
  const cardCandidateRepository = new CardCandidateRepository(fileSystem, logger);
  const cardRecommendationRepository = new CardRecommendationRepository(fileSystem);
  const bibleCandidateRepository = new BibleCandidateRepository(fileSystem);
  const storyFeatureRepository = new StoryFeatureRepository(fileSystem);
  const postGenerationUpdates = new PostGenerationUpdateManager();

  const assembleManuscriptUseCase = new AssembleManuscriptUseCase(
    logger,
    manuscriptAssemblyRepository,
  );
  const summarizeChaptersUseCase = new SummarizeChaptersUseCase(
    aiGateway,
    manuscriptAssemblyRepository,
  );
  const generateDraftUseCase = new GenerateDraftUseCase({
    aiGateway,
    configBridge,
    draftRepository,
    fileSystem,
    generator,
    logger,
    postGenerationUpdates,
    projectRepository,
    sceneCacheRepository,
    sceneRepository,
    workspaceLocator,
  });
  const reviseDraftUseCase = new ReviseDraftUseCase({
    aiProviderRegistry,
    usageSink,
    fileSystem,
    logger,
    generator,
    sceneCacheRepository,
  });
  const reviseAfterGenerateGate = new ReviseAfterGenerateGate(
    fileSystem,
    workspaceLocator,
    configBridge,
    logger,
    reviseDraftUseCase,
  );

  return {
    workspaceRoot,
    logger,
    fileSystem,
    secretStore,
    configBridge,
    generateDraftUseCase,
    generateAllDraftsUseCase: new GenerateAllDraftsUseCase(
      generateDraftUseCase,
      logger,
      reviseAfterGenerateGate,
      sceneBatchRepository,
    ),
    generateOutlineUseCase: new GenerateOutlineUseCase(aiGateway, outlineRepository),
    reviseDraftUseCase,
    reviseAfterGenerateGate,
    assembleManuscriptUseCase,
    exportManuscriptUseCase: new ExportManuscriptUseCase(manuscriptAssemblyRepository),
    reviewManuscriptUseCase: new ReviewManuscriptUseCase(
      aiGateway,
      manuscriptAssemblyRepository,
      logger,
    ),
    summarizeChaptersUseCase,
    createCardUseCase: new CreateCardUseCase(cardWriterRepository),
    recommendCardsUseCase: new RecommendCardsUseCase(
      aiGateway,
      logger,
      cardRecommendationRepository,
    ),
    collectCardProposalsUseCase: new CollectCardProposalsUseCase(aiGateway, cardCollectRepository),
    promoteCardCandidatesUseCase: new PromoteCardCandidatesUseCase(cardCandidateRepository),
    promoteBibleCandidatesUseCase: new PromoteBibleCandidatesUseCase(bibleCandidateRepository),
    buildStoryCardsUseCase: new BuildStoryCardsUseCase(aiGateway, storyFeatureRepository),
    completeStoryScenesUseCase: new CompleteStoryScenesUseCase(aiGateway, storyFeatureRepository),
    novelPipeline: new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      assembleManuscriptUseCase,
      configBridge,
      generateDraftUseCase,
      logger,
      novelReviewRepository,
      novelRunStateRepository,
      outlineRepository,
      reviseDraftUseCase,
      sceneSeedRepository,
      summarizeChaptersUseCase,
      usageSink,
      fileSystem,
    }),
  };
}
