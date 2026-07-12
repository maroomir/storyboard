import {
  updateBackgroundCharactersFromScene,
  type ScheduleBackgroundCharacterUpdateInput,
} from './backgroundCharacterUpdater';
import {
  updateBibleCandidatesFromDraft,
  type ScheduleBibleCandidateUpdateInput,
} from './bibleCandidateUpdater';
import {
  updateCardCandidatesFromDraft,
  type ScheduleCardCandidateUpdateInput,
} from './cardCandidateUpdater';
import {
  updateCharacterTraitsFromDraft,
  type ScheduleCharacterTraitsUpdateInput,
} from './traitsUpdater';

class KeyedTaskQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private isDisposed = false;

  public enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.isDisposed) {
      return Promise.reject(new Error('Post-generation updates have been disposed.'));
    }

    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task) as Promise<T>;
    this.chains.set(key, next);
    void next.then(
      () => this.clearCompletedChain(key, next),
      () => this.clearCompletedChain(key, next),
    );

    return next;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.chains.clear();
  }

  private clearCompletedChain(key: string, completed: Promise<unknown>): void {
    if (this.chains.get(key) === completed) {
      this.chains.delete(key);
    }
  }
}

export class PostGenerationUpdateManager {
  private readonly queue = new KeyedTaskQueue();

  public scheduleCharacterTraits(input: ScheduleCharacterTraitsUpdateInput): void {
    const { queueKey, onComplete, logger, ...rest } = input;
    void this.queue
      .enqueue(queueKey, () => updateCharacterTraitsFromDraft(rest))
      .then(
        (summary) => onComplete?.(summary),
        (error: unknown) => logger?.error('Traits background update failed', error),
      );
  }

  public scheduleBibleCandidates(input: ScheduleBibleCandidateUpdateInput): void {
    const { queueKey, onComplete, logger, ...rest } = input;
    void this.queue
      .enqueue(queueKey, () => updateBibleCandidatesFromDraft({ ...rest, logger }))
      .then(
        (summary) => onComplete?.(summary),
        (error: unknown) => logger?.error('Bible candidate background update failed', error),
      );
  }

  public scheduleCardCandidates(input: ScheduleCardCandidateUpdateInput): void {
    const { queueKey, onComplete, logger, ...rest } = input;
    void this.queue
      .enqueue(queueKey, () => updateCardCandidatesFromDraft({ ...rest, logger }))
      .then(
        (summary) => onComplete?.(summary),
        (error: unknown) => logger?.error('Card candidate background update failed', error),
      );
  }

  public scheduleBackgroundCharacters(input: ScheduleBackgroundCharacterUpdateInput): void {
    const { queueKey, onComplete, logger, ...rest } = input;
    void this.queue
      .enqueue(queueKey, () => updateBackgroundCharactersFromScene({ ...rest, logger }))
      .then(
        (summary) => onComplete?.(summary),
        (error: unknown) => logger?.error('Background character background update failed', error),
      );
  }

  public dispose(): void {
    this.queue.dispose();
  }
}
