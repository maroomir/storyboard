import type { ConfigurationTarget } from '@storyboard/story-config';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { ParsedArguments } from '@/cliArguments';
import type { LiveArea } from '@/adapters/liveArea';
import type { PauseRequests } from '@/adapters/pauseRequests';
import type { IPrompter } from '@/adapters/prompter';
import type { TerminalFacts, TerminalProfile, TerminalStream } from '@/terminal/profile';
import type { Theme } from '@/terminal/theme';
import type { CommandSpec } from '@/commands/catalog';
import type { CommandOutcome } from '@/commands/outcome';

export interface DispatchDependencies {
  readonly version: string;
  readonly cwd: string;
  readonly isInteractive: boolean;
  readonly createLogger: (
    showProgress: boolean,
    stderrTheme: Theme,
    showsErrorStack: boolean,
  ) => IStoryboardLogger;
  readonly terminal?: TerminalFacts;
  readonly liveArea?: LiveArea;
  readonly pauseRequests?: PauseRequests;
  readonly createPrompter?: (stderr: TerminalStream) => IPrompter;
}

export interface DispatchResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outcome?: CommandOutcome;
  readonly launchTui?: boolean;
  readonly costUsd?: number;
}

export interface OutputMode {
  readonly json: boolean;
}

export interface Invocation {
  readonly argv: readonly string[];
  readonly args: ParsedArguments;
  readonly verb: string;
  readonly mode: OutputMode;
  readonly terminal: TerminalProfile;
}

export interface WorkspaceTarget {
  readonly workspacePath: string;
  readonly spec: CommandSpec | undefined;
  readonly needsWorkspace: boolean;
  readonly isWorkspace: boolean;
  readonly configWriteTarget: ConfigurationTarget | undefined;
}
