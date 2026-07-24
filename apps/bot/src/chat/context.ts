import type { SyncService } from '@storyboard/story-git';

import type { ContentService } from '../content/contentService';
import type { IEnqueueJob } from '../gen/jobManager';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import type { ISendMessage, IncomingUpdate, MessageView, SentMessageRef } from './ports';

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
  ) {}

  public get chatId(): number {
    return this.update.chatId;
  }

  public reply(view: MessageView): Promise<SentMessageRef> {
    return this.sender.sendMessage(this.chatId, view);
  }

  public answerCallback(text?: string): Promise<void> {
    if (this.update.kind === 'callback') {
      return this.sender.answerCallback(this.update.callbackQueryId, text);
    }

    return Promise.resolve();
  }
}
