import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunDrawer } from '@/renderer/components/RunDrawer';
import { I18nProvider } from '@/renderer/lib/i18n';
import type { RunSnapshot, WorkspaceOverview } from '@/shared/dto';
import type { DesktopBridge } from '@/shared/ipcContract';

const overview: WorkspaceOverview = {
  path: '/works/harbor',
  title: '겨울 항구의 편지',
  chapters: [{ title: '1장', scenes: [{ stem: '01-harbor', order: 1, title: '밤의 방파제', status: 'drafted', length: 3100 }] }],
  totalLength: 3100,
  missingContractFields: [],
};

const run: RunSnapshot = {
  status: 'idle',
  completedStages: [],
  log: [],
  spentUsd: 0,
  spentTokens: 0,
  hasUnpricedUsage: false,
  budgetUsd: 0,
  projectSpentUsd: 0,
};

function installBridge(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async () => ({ ok: true, data: run }));
  const bridge: DesktopBridge = { invoke: invoke as unknown as DesktopBridge['invoke'], on: () => () => undefined };
  Object.defineProperty(window, 'storyboard', { value: bridge, configurable: true });
  return invoke;
}

function renderDrawer(props: { overview?: WorkspaceOverview; run?: RunSnapshot }): void {
  render(
    <I18nProvider language="ko">
      <RunDrawer
        overview={props.overview ?? overview}
        run={props.run ?? run}
        onRunChange={() => undefined}
        onClose={() => undefined}
        onError={() => undefined}
        onSceneOpen={() => undefined}
      />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('RunDrawer', () => {
  it('answers an approval request through main', () => {
    const invoke = installBridge();
    renderDrawer({ run: { ...run, status: 'waiting-approval', kind: 'novel', approval: { kind: 'chapter', info: '1장을 마쳤습니다.' } } });

    fireEvent.click(screen.getByRole('button', { name: '계속' }));

    expect(screen.getByText('1장을 마쳤습니다.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('run.answerApproval', { approved: true });
  });

  it('will not start a run while the story contract has empty fields', () => {
    installBridge();
    renderDrawer({ overview: { ...overview, missingContractFields: ['genre'] } });

    expect((screen.getByRole('button', { name: '장편 생성 시작' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/장르/)).toBeTruthy();
  });

  it('offers to resume a stopped run with its mode', () => {
    const invoke = installBridge();
    renderDrawer({ run: { ...run, resumable: { mode: 'auto', completedStages: ['outline', 'seeds'] } } });

    fireEvent.click(screen.getByRole('button', { name: '이어서 진행' }));

    expect(invoke).toHaveBeenCalledWith('run.startNovel', { mode: 'auto', resume: true });
  });
});
