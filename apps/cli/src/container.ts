import {
  AiGateway,
  ApplyDraftFormatUseCase,
  AugmentDraftUseCase,
  AssembleManuscriptUseCase,
  BibleCandidateRepository,
  BuildStoryCardsUseCase,
  CardCandidateRepository,
  CardRecommendationRepository,
  CardWriterRepository,
  CondenseDraftUseCase,
  CompleteStoryScenesUseCase,
  CreateCardUseCase,
  ExpandDraftUseCase,
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
  type IUsageSink,
} from '@storyboard/story-engine';
import {
  ConfigBridge,
  createAiProviderRegistry,
  SecretStore,
  type AiProviderId,
} from '@storyboard/story-ai';

import { ConsoleLogger } from './adapters/consoleLogger';
import { NodeFileSystem } from './adapters/nodeFileSystem';
import { NodeWorkspaceLocator } from './adapters/nodeWorkspaceLocator';
import { resolveCliPaths } from './adapters/paths';
import {
  createFileConfiguration,
  createFileSecretStorage,
  resolveWorkspaceConfigFile,
} from '@storyboard/story-config';

export interface CliContainer {
  readonly workspaceRoot: StoryUri;
  readonly aiGateway: AiGateway;
  readonly logger: ConsoleLogger;
  readonly fileSystem: NodeFileSystem;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly bibleCandidateRepository: BibleCandidateRepository;
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
  readonly fallbackProvider?: string;
}

// `--provider`/`--model` are the terminal's form of the settings the extension keeps in its UI, so
// they are layered onto the config rather than threaded through every call.
function configOverrides(options: CliContainerOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (options.provider !== undefined) {
    overrides['defaultProvider'] = options.provider;
    // Task-level routing in the config file beats `defaultProvider`, so a `--provider` that only
    // set the default would silently lose to a `tasks.sceneDraft.provider` the user configured.
    // Naming a provider on the command line means "this run, everything".
    overrides['tasks'] = {};

    if (options.model !== undefined) {
      overrides[`providers.${options.provider}.model`] = options.model;
    }
  }

  if (options.reviseMaxIterations !== undefined) {
    overrides['draft.reviseMaxIterations'] = options.reviseMaxIterations;
  }

  return overrides;
}

// The CLI's service graph. It mirrors the extension's platform module one-for-one: only the four
// host adapters differ, which is the whole point of the engine boundary.
export function createCliContainer(options: CliContainerOptions): CliContainer {
  const paths = resolveCliPaths(process.env, (message) =>
    process.stderr.write(`[warn] ${message}\n`),
  );
  const workspaceRoot = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };

  const logger = new ConsoleLogger(options.verbose);
  const fileSystem = new NodeFileSystem();
  const workspaceLocator = new NodeWorkspaceLocator(folder);
  const secretStore = new SecretStore(createFileSecretStorage(paths.secretsFile));
  const configuration = createFileConfiguration({
    userConfigFile: paths.configFile,
    workspaceConfigFile: resolveWorkspaceConfigFile(workspaceRoot.fsPath),
    overrides: configOverrides(options),
  });
  const configBridge = new ConfigBridge({ getConfiguration: () => configuration });
  const aiProviderRegistry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: true,
    // A long unattended run should finish on the second provider rather than abort halfway.
    ...(options.fallbackProvider === undefined
      ? {}
      : {
          cliUsageLimitFallback: {
            providerId: options.fallbackProvider as AiProviderId,
            onFallback: (message: string) => logger.warn(message),
          },
        }),
  });

  // The CLI has no usage panel; the ledger the extension keeps is not worth a file write here, so
  // cost is reported per run instead of persisted.
  const usageSink: IUsageSink = { record: async (): Promise<void> => undefined };
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
    aiGateway,
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
    reviseAfterGenerateGate,
    applyDraftFormatUseCase: new ApplyDraftFormatUseCase(fileSystem, aiGateway, logger, generator),
    augmentDraftUseCase: new AugmentDraftUseCase(fileSystem, aiGateway, logger, configBridge),
    condenseDraftUseCase: new CondenseDraftUseCase(aiGateway, logger),
    expandDraftUseCase: new ExpandDraftUseCase(aiGateway, logger),
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
    promoteCardCandidatesUseCase: new PromoteCardCandidatesUseCase(cardCandidateRepository),
    promoteBibleCandidatesUseCase: new PromoteBibleCandidatesUseCase(bibleCandidateRepository),
    bibleCandidateRepository,
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
