import type { SyncService } from '@storyboard/story-git';

import type { ContentService } from '@/content/contentService';
import type { IEnqueueJob } from '@/gen/jobManager';
import type { WorkspaceStore } from '@/workspace/workspaceStore';
import type {
  ISendMessage,
  IncomingUpdate,
  MessageView,
  OutgoingDocument,
  SentMessageRef,
} from './ports';

// Returns the reason generation cannot run right now, or undefined when it can. Checked before a
// job is queued so a missing API key is answered immediately instead of at the first AI call.
export type CheckGenerationReadiness = () => Promise<string | undefined>;

// Facade handed to each command handler. Handlers reach the outside world only through this
// object, so they stay decoupled from the gateway and from each other.
export class ChatContext {
  public constructor(
    public readonly update: IncomingUpdate,
    private readonly sender: ISendMessage,
    public readonly content: ContentService,
    public readonly store: WorkspaceStore,
    public readonly sync: SyncService,
    public readonly jobs?: IEnqueueJob,
    private readonly checkGenerationReadiness?: CheckGenerationReadiness,
  ) {}

  public async describeGenerationBlocker(): Promise<string | undefined> {
    return this.checkGenerationReadiness?.();
  }

  public get chatId(): number {
    return this.update.chatId;
  }

  public reply(view: MessageView): Promise<SentMessageRef> {
    return this.sender.sendMessage(this.chatId, view);
  }

  public replyDocument(doc: OutgoingDocument): Promise<SentMessageRef> {
    return this.sender.sendDocument(this.chatId, doc);
  }

  public answerCallback(text?: string): Promise<void> {
    if (this.update.kind === 'callback') {
      return this.sender.answerCallback(this.update.callbackQueryId, text);
    }

    return Promise.resolve();
  }
}
