import { dispatcherVerbSpecs } from '@/commands/dispatcherVerbs';
import { InitCommand } from '@/commands/initCommand';
import { SetupCommand } from '@/commands/setupCommand';
import { ApikeySetCommand } from '@/commands/apikey/apikeySetCommand';
import { ApikeyShowCommand } from '@/commands/apikey/apikeyShowCommand';
import { LoginCommand } from '@/commands/loginCommand';
import { LogoutCommand } from '@/commands/logoutCommand';
import { ConfigShowCommand } from '@/commands/config/configShowCommand';
import { ConfigSetCommand } from '@/commands/config/configSetCommand';
import { ConfigUnsetCommand } from '@/commands/config/configUnsetCommand';
import { ParamsShowCommand } from '@/commands/params/paramsShowCommand';
import { DoctorCommand } from '@/commands/doctorCommand';
import { StatusCommand } from '@/commands/statusCommand';
import { ProjectShowCommand } from '@/commands/project/projectShowCommand';
import { ProjectSetCommand } from '@/commands/project/projectSetCommand';
import { OutlineGenerateCommand } from '@/commands/outline/outlineGenerateCommand';
import { NarratorListCommand } from '@/commands/narrator/narratorListCommand';
import { NarratorShowCommand } from '@/commands/narrator/narratorShowCommand';
import { NarratorCreateCommand } from '@/commands/narrator/narratorCreateCommand';
import { NarratorRemoveCommand } from '@/commands/narrator/narratorRemoveCommand';
import { NovelGenerateCommand } from '@/commands/novel/novelGenerateCommand';
import { SceneListCommand } from '@/commands/scene/sceneListCommand';
import { SceneShowCommand } from '@/commands/scene/sceneShowCommand';
import { SceneCreateCommand } from '@/commands/scene/sceneCreateCommand';
import { SceneRenameCommand } from '@/commands/scene/sceneRenameCommand';
import { SceneSeedCommand } from '@/commands/scene/sceneSeedCommand';
import { ScenePlotCommand } from '@/commands/scene/scenePlotCommand';
import { SceneCompleteCommand } from '@/commands/scene/sceneCompleteCommand';
import { DraftGenerateCommand } from '@/commands/draft/draftGenerateCommand';
import { DraftReviseCommand } from '@/commands/draft/draftReviseCommand';
import { DraftShowCommand } from '@/commands/draft/draftShowCommand';
import { DraftEditCommand } from '@/commands/draft/draftEditCommand';
import { DraftAugmentCommand } from '@/commands/draft/draftAugmentCommand';
import { DraftCondenseCommand } from '@/commands/draft/draftCondenseCommand';
import { DraftExpandCommand } from '@/commands/draft/draftExpandCommand';
import { DraftFormatCommand } from '@/commands/draft/draftFormatCommand';
import { DraftCheckCommand } from '@/commands/draft/draftCheckCommand';
import { StateGenerateCommand } from '@/commands/state/stateGenerateCommand';
import { StateResealCommand } from '@/commands/state/stateResealCommand';
import { CardListCommand } from '@/commands/card/cardListCommand';
import { CardShowCommand } from '@/commands/card/cardShowCommand';
import { CardCreateCommand } from '@/commands/card/cardCreateCommand';
import { CardRenameCommand } from '@/commands/card/cardRenameCommand';
import { CardRecommendCommand } from '@/commands/card/cardRecommendCommand';
import { CardBuildCommand } from '@/commands/card/cardBuildCommand';
import { CardPromoteCommand } from '@/commands/card/cardPromoteCommand';
import { CardDiscardCommand } from '@/commands/card/cardDiscardCommand';
import { CanonDiffCommand } from '@/commands/canon/canonDiffCommand';
import { CanonPromoteCommand } from '@/commands/canon/canonPromoteCommand';
import { NotesConnectCommand } from '@/commands/notes/notesConnectCommand';
import { NotesAbsorbCommand } from '@/commands/notes/notesAbsorbCommand';
import { NotesExportCommand } from '@/commands/notes/notesExportCommand';
import { ManuscriptAssembleCommand } from '@/commands/manuscript/manuscriptAssembleCommand';
import { ManuscriptReviewCommand } from '@/commands/manuscript/manuscriptReviewCommand';
import { ManuscriptSummarizeCommand } from '@/commands/manuscript/manuscriptSummarizeCommand';
import { ManuscriptExportCommand } from '@/commands/manuscript/manuscriptExportCommand';
import { SimRunCommand } from '@/commands/sim/simRunCommand';
import { SimScreenCommand } from '@/commands/sim/simScreenCommand';
import { SimSweepCommand } from '@/commands/sim/simSweepCommand';
import { SimReportCommand } from '@/commands/sim/simReportCommand';
import { SimRejudgeCommand } from '@/commands/sim/simRejudgeCommand';
import { SimApplyCommand } from '@/commands/sim/simApplyCommand';
import type { CommandSpec } from '@/commands/catalog';
import type { ICommandHandler } from '@/commands/commandHandler';

const sessionCommands: readonly ICommandHandler[] = [
  new InitCommand(),
  new SetupCommand(),
  new ApikeySetCommand(),
  new ApikeyShowCommand(),
  new LoginCommand(),
  new LogoutCommand(),
  new ConfigShowCommand(),
  new ConfigSetCommand(),
  new ConfigUnsetCommand(),
  new ParamsShowCommand(),
  new DoctorCommand(),
  new StatusCommand(),
];

const workCommands: readonly ICommandHandler[] = [
  new ProjectShowCommand(),
  new ProjectSetCommand(),
  new OutlineGenerateCommand(),
  new NarratorListCommand(),
  new NarratorShowCommand(),
  new NarratorCreateCommand(),
  new NarratorRemoveCommand(),
  new NovelGenerateCommand(),
  new SceneListCommand(),
  new SceneShowCommand(),
  new SceneCreateCommand(),
  new SceneRenameCommand(),
  new SceneSeedCommand(),
  new ScenePlotCommand(),
  new SceneCompleteCommand(),
  new DraftGenerateCommand(),
  new DraftReviseCommand(),
  new DraftShowCommand(),
  new DraftEditCommand(),
  new DraftAugmentCommand(),
  new DraftCondenseCommand(),
  new DraftExpandCommand(),
  new DraftFormatCommand(),
  new DraftCheckCommand(),
  new StateGenerateCommand(),
  new StateResealCommand(),
  new CardListCommand(),
  new CardShowCommand(),
  new CardCreateCommand(),
  new CardRenameCommand(),
  new CardRecommendCommand(),
  new CardBuildCommand(),
  new CardPromoteCommand(),
  new CardDiscardCommand(),
  new CanonDiffCommand(),
  new CanonPromoteCommand(),
  new NotesConnectCommand(),
  new NotesAbsorbCommand(),
  new NotesExportCommand(),
  new ManuscriptAssembleCommand(),
  new ManuscriptReviewCommand(),
  new ManuscriptSummarizeCommand(),
  new ManuscriptExportCommand(),
  new SimRunCommand(),
  new SimScreenCommand(),
  new SimSweepCommand(),
  new SimReportCommand(),
  new SimRejudgeCommand(),
  new SimApplyCommand(),
];

export const commands: readonly ICommandHandler[] = [...sessionCommands, ...workCommands];

export const commandCatalog: readonly CommandSpec[] = [
  ...sessionCommands.map((command) => command.spec),
  ...dispatcherVerbSpecs,
  ...workCommands.map((command) => command.spec),
];

export function findCommand(verb: string): ICommandHandler | undefined {
  return commands.find((command) => command.spec.verb === verb);
}

export function findCommandSpec(verb: string): CommandSpec | undefined {
  return commandCatalog.find((spec) => spec.verb === verb);
}
