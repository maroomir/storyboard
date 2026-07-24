import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { StoryboardAIService } from '../../infrastructure/ai/AIService';
import type { AiProviderRegistry } from '../../infrastructure/ai/providerRegistry';
import { recordUsageSafely } from '../../infrastructure/ai/recordUsageSafely';
import type { UsageRecorder } from '../../infrastructure/ai/UsageRecorder';
import type { AiProviderId, AiTaskName } from '../../shared/ai';

export class AiGateway {
  public constructor(
    private readonly providerRegistry: AiProviderRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly logger: StoryboardLogger,
  ) {}

  public createService(workspaceUri: vscode.Uri): StoryboardAIService {
    return new StoryboardAIService(this.providerRegistry, {
      onUsage: (record): void =>
        recordUsageSafely(this.usageRecorder, workspaceUri, record, this.logger),
    });
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.providerRegistry.getTaskProvider(taskName);
  }
}
