import type { BibleCard, CanonFact, DesktopSettings, NotesApplyView, SnapshotEntry } from '@/shared/dto';
import type { DesktopApp } from './desktopApp';
import type { InvokeHandlers } from './ipcRouter';
import { fail, succeed, type ServiceResult } from './serviceResult';
import type { WorkspaceSession } from './workspaceSession';
import type { RemovedBibleCard } from '@/main/bibleService';

async function withSession<T>(
  app: DesktopApp,
  run: (session: WorkspaceSession) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session: ServiceResult<WorkspaceSession> = app.requireSession();
  return session.ok ? await run(session.data) : session;
}

// For writes: refused while a run of any app holds the work.
async function withWritableSession<T>(
  app: DesktopApp,
  run: (session: WorkspaceSession) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  return await withSession(app, async (session) => (await session.refuseWhileBusy()) ?? (await run(session)));
}

async function withScene<T>(
  app: DesktopApp,
  stem: string,
  run: (session: WorkspaceSession) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  return await withSession(app, async (session) =>
    (await session.sceneExists(stem)) ? await run(session) : fail('not-found', app.t('error.notFound')),
  );
}

export function createInvokeHandlers(app: DesktopApp): InvokeHandlers {
  return {
    'app.bootstrap': async () => succeed(app.bootstrap()),
    'app.setLanguage': async ({ language }) => succeed(app.setLanguage(language)),
    'app.installUpdate': async () => succeed(await app.installUpdate()),

    'workspace.open': async ({ recentPath }) => await app.openWorkspace(recentPath),
    'workspace.chooseParentDirectory': async () => succeed(await app.chooseParentDirectory()),
    'workspace.create': async ({ parentDirectory, request }) => await app.createWorkspace(parentDirectory, request),
    'workspace.close': async () => await app.closeWorkspace(),
    'workspace.overview': async () => await withSession(app, async (session) => succeed(await session.overview())),

    'draft.read': async ({ stem }) =>
      await withScene(app, stem, async (session) => succeed(await session.readDraft(stem))),
    'draft.save': async ({ stem, body, reason }) =>
      await withScene(app, stem, async (session) => await session.saveDraft(stem, body, reason)),
    'draft.endSession': async ({ stem }) =>
      await withSession(app, async (session) => {
        await session.endDraftSession(stem);
        return succeed({});
      }),
    'draft.proposeEdit': async ({ stem, selectedText, instruction }) =>
      await withWritableSession(app, async (session) =>
        (await session.sceneExists(stem))
          ? await session.proposeEdit(stem, selectedText, instruction)
          : fail('not-found', app.t('error.notFound')),
      ),
    'scene.notes': async ({ stem }) =>
      await withScene(app, stem, async (session) => succeed(await session.notes(stem))),
    'scene.rename': async ({ stem, to }) =>
      await withWritableSession(app, async (session) =>
        (await session.sceneExists(stem))
          ? await session.renameScene(stem, to)
          : fail('not-found', app.t('error.notFound')),
      ),

    'run.status': async () => await withSession(app, async (session) => succeed(await session.runs.refresh())),
    'run.startNovel': async ({ mode, resume }) =>
      await withSession(app, async (session) => {
        await session.endAllDraftSessions();
        return await session.runs.startNovel(mode, resume);
      }),
    'run.generateScene': async ({ stem, force }) =>
      await withScene(app, stem, async (session) => {
        await session.endAllDraftSessions();
        return await session.runs.generateScene(stem, force);
      }),
    'run.pause': async () => await withSession(app, async (session) => succeed(session.runs.pause())),
    'run.answerApproval': async ({ approved }) =>
      await withSession(app, async (session) => succeed(session.runs.answerApproval(approved))),
    'run.setBudget': async ({ budgetUsd }) =>
      await withSession(app, async (session) => {
        const saved: ServiceResult<DesktopSettings> = await app.settings.setValue('budget.run.limitUsd', budgetUsd);
        return saved.ok ? succeed(await session.runs.refresh()) : saved;
      }),

    'bible.list': async ({ kind }) => await withSession(app, async (session) => succeed(await session.bible.list(kind))),
    'bible.read': async ({ kind, id }) => await withSession(app, async (session) => await session.bible.read(kind, id)),
    'bible.save': async ({ kind, card }) =>
      await withWritableSession(app, async (session) => {
        const saved: ServiceResult<BibleCard> = await session.bible.save(kind, card);
        if (saved.ok) {
          await session.snapshot('snapshot.bibleSaved', { name: saved.data.name });
        }
        return saved;
      }),
    'bible.create': async ({ kind, id, name }) =>
      await withWritableSession(app, async (session) => {
        const created: ServiceResult<BibleCard> = await session.bible.create(kind, id, name);
        if (created.ok) {
          await session.snapshot('snapshot.bibleSaved', { name });
        }
        return created;
      }),
    'bible.delete': async ({ kind, id }) =>
      await withWritableSession(app, async (session) => {
        const removed: ServiceResult<RemovedBibleCard> = await session.bible.remove(kind, id);
        if (!removed.ok) {
          return removed;
        }
        await session.snapshot('snapshot.bibleDeleted', { name: removed.data.name });
        return succeed({});
      }),
    'canon.list': async () => await withSession(app, async (session) => succeed(await session.bible.listCanon())),
    'canon.save': async ({ fact }) =>
      await withWritableSession(app, async (session) => {
        const facts: CanonFact[] = await session.bible.saveCanonFact(fact);
        await session.snapshot('snapshot.canonSaved', { key: fact.key });
        return succeed(facts);
      }),
    'canon.delete': async ({ id }) =>
      await withWritableSession(app, async (session) => {
        const key: string = (await session.bible.listCanon()).find((fact) => fact.id === id)?.key ?? id;
        const facts: CanonFact[] = await session.bible.deleteCanonFact(id);
        await session.snapshot('snapshot.canonDeleted', { key });
        return succeed(facts);
      }),

    'settings.read': async () => succeed(await app.settings.read()),
    'settings.setDefaultProvider': async ({ providerId }) => succeed(await app.settings.setDefaultProvider(providerId)),
    'settings.setModel': async ({ providerId, model }) => succeed(await app.settings.setModel(providerId, model)),
    'settings.setApiKey': async ({ providerId, apiKey }) => await app.settings.setApiKey(providerId, apiKey),
    'settings.setValue': async ({ key, value }) => await app.settings.setValue(key, value),
    'settings.setOllamaBaseUrl': async ({ baseUrl }) => succeed(await app.settings.setOllamaBaseUrl(baseUrl)),

    'notes.chooseLocation': async ({ kind }) => succeed(await app.chooseNotesLocation(kind)),
    'notes.collect': async ({ location }) =>
      await withSession(app, async (session) =>
        location.kind === 'path' && !app.isOfferedNoteLocation(location.path)
          ? fail('invalid-request', app.t('error.invalidRequest'))
          : await session.notesImport.collect(location),
      ),
    'notes.plan': async () => await withSession(app, async (session) => await session.notesImport.planAbsorb()),
    'notes.apply': async ({ fillContract }) =>
      await withWritableSession(app, async (session) => {
        const applied: ServiceResult<NotesApplyView> = await session.notesImport.apply(fillContract);
        if (applied.ok) {
          await session.snapshot('snapshot.notesAbsorbed', {
            cards: String(applied.data.createdCards.length),
            scenes: String(applied.data.createdScenes.length),
          });
        }
        return applied;
      }),
    'notes.connectNotion': async ({ token }) => succeed(await app.settings.connectNotion(token)),

    'history.list': async () => await withSession(app, async (session) => succeed(await session.snapshots.list())),
    'history.restore': async ({ id }) =>
      await withWritableSession(app, async (session) => {
        const target: SnapshotEntry | undefined = (await session.snapshots.list()).find((entry) => entry.id === id);

        if (target === undefined) {
          return fail('not-found', app.t('error.notFound'));
        }

        await session.endAllDraftSessions();
        await session.snapshots.restore(id, app.t('snapshot.restored', { message: target.message }));
        return succeed(await session.snapshots.list());
      }),
  };
}
