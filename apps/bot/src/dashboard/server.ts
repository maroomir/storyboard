import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { GitClient, type SyncService } from '@storyboard/story-git';

import type { ContentService } from '../content/contentService';
import type { IEnqueueJob } from '../gen/jobManager';
import type { Logger } from '../util/logger';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import { rejectIfNotLoopback } from './guard';

export interface DashboardDeps {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly sync: SyncService;
  readonly jobs: IEnqueueJob;
  readonly logger: Logger;
}

export interface DashboardHandle {
  readonly port: number;
  stop(): Promise<void>;
}

// Read-only operational panel. There are deliberately no mutating routes: everything that changes
// the workspace goes through the Telegram commands and the mutate gate, never through HTTP.
export function startDashboardServer(port: number, deps: DashboardDeps): Promise<DashboardHandle> {
  const server = createServer((req, res) => {
    void handle(req, res, deps).catch((error) => {
      deps.logger.error('대시보드 요청 처리 실패', error);
      sendJson(res, 500, { error: '내부 오류가 발생했습니다.' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      // After a successful bind, a later 'error' with no listener would crash the process; the
      // panel is a convenience, so runtime errors only get logged.
      server.on('error', (error) => deps.logger.error('대시보드 서버 오류', error));
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({ port: boundPort, stop: () => close(server) });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DashboardDeps,
): Promise<void> {
  if (rejectIfNotLoopback(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET만 지원합니다.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PANEL_HTML);
    return;
  }
  if (url.pathname === '/api/workspace') {
    sendJson(res, 200, await buildWorkspaceView(deps));
    return;
  }
  if (url.pathname === '/api/jobs') {
    const views = deps.jobs.getRecent(20).map(({ job }) => ({
      id: job.id,
      kind: job.kind,
      state: job.state,
      target: job.target,
      failureReason: job.failureReason,
      resultRef: job.resultRef,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    }));
    sendJson(res, 200, { jobs: views });
    return;
  }

  sendJson(res, 404, { error: '알 수 없는 경로입니다.' });
}

async function buildWorkspaceView(deps: DashboardDeps): Promise<Record<string, unknown>> {
  const project = await deps.store.readProject();
  const cards = await deps.content.listCards();
  const scenes = await deps.content.listScenes();
  const head = new GitClient(deps.store.root).headCommit();

  let draftCount = 0;
  for (const scene of scenes) {
    if ((await deps.store.readDraft(scene.stem)) !== undefined) {
      draftCount += 1;
    }
  }

  return {
    name: project.value.name,
    path: deps.store.root,
    cards: cards.length,
    scenes: scenes.length,
    drafts: draftCount,
    syncState: deps.sync.getState(),
    lastCommit: head === undefined ? null : `${head.hash} ${head.subject}`,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const PANEL_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>storyboard-bot</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; color: #1a1a1a; }
  h1 { font-size: 1.2rem; }
  dl { display: grid; grid-template-columns: 8rem 1fr; gap: .3rem .8rem; }
  dt { color: #666; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: .3rem .5rem; border-bottom: 1px solid #e5e5e5; font-size: .9rem; }
  .state-succeeded { color: #0a7d38; }
  .state-failed, .state-interrupted { color: #b00020; }
  .state-running, .state-queued { color: #8a6d00; }
</style>
</head>
<body>
<h1>storyboard-bot 운영 패널</h1>
<dl id="workspace"></dl>
<table>
  <thead><tr><th>#</th><th>종류</th><th>대상</th><th>상태</th><th>결과</th></tr></thead>
  <tbody id="jobs"></tbody>
</table>
<script>
// Workspace values (project name, scene stems, commit subjects) are author-controlled text, not
// trusted markup — escape them before they reach innerHTML.
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

async function refresh() {
  try {
    const ws = await (await fetch('/api/workspace')).json();
    document.getElementById('workspace').innerHTML = [
      ['프로젝트', ws.name], ['경로', ws.path],
      ['카드', ws.cards], ['씬', ws.scenes + ' (초안 ' + ws.drafts + ')'],
      ['동기화', ws.syncState], ['마지막 커밋', ws.lastCommit ?? '-'],
    ].map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('');

    const data = await (await fetch('/api/jobs')).json();
    document.getElementById('jobs').innerHTML = data.jobs.map((job) =>
      '<tr><td>' + esc(job.id) + '</td><td>' + esc(job.kind) + '</td><td>' +
      esc(job.target.scene ?? job.target.file ?? '-') + '</td><td class="state-' + esc(job.state) + '">' +
      esc(job.state) + '</td><td>' + esc(job.resultRef ?? job.failureReason ?? '-') + '</td></tr>'
    ).join('');
  } catch (error) {
    console.error(error);
  }
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
`;
