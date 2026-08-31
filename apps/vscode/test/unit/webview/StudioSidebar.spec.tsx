import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioSidebar } from '@webview/components/sidebar/StudioSidebar';
import type { StudioChatTurn, StudioInitialData, StudioTarget } from '@webview/lib/types';

const characterTarget: StudioTarget = {
  kind: 'character',
  label: 'seorin.card',
  entity: { kind: 'character', key: 'seorin' },
  cardUri: 'file:///character/seorin.card',
  hasSelection: false,
};

const draftTarget: StudioTarget = {
  kind: 'draft',
  label: '01-intro.md',
  entity: { kind: 'scene', key: '01-intro' },
  sceneUri: 'file:///scene/01-intro.card',
  draftUri: 'file:///draft/01-intro.md',
  hasSelection: false,
};

const projectTarget: StudioTarget = {
  kind: 'project',
  label: 'story',
  entity: { kind: 'project', key: 'project' },
  hasSelection: false,
};

const sceneCardTarget: StudioTarget = {
  kind: 'scene',
  label: '01-intro.card',
  entity: { kind: 'scene', key: '01-intro' },
  sceneUri: 'file:///scene/01-intro.card',
  draftUri: 'file:///draft/01-intro.md',
  hasSelection: false,
  draftExists: true,
};

const proposalTurn: StudioChatTurn = {
  id: 'p1',
  role: 'assistant',
  kind: 'proposal',
  summary: '과거사에 화재 사건 추가',
  targetFile: 'character/seorin.card',
  patch: { target: 'card', changes: [{ field: 'description', value: ['화재를 겪었다'] }] },
  baselineHash: 'hash-1',
  validation: { state: 'pass', warnings: [] },
  status: 'pending',
};

function renderStudio(
  target: StudioTarget,
  session?: StudioInitialData['session'],
): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn();
  vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
  render(<StudioSidebar initialData={{ title: 'Studio', target, session }} />);
  return postMessage;
}

function messagesByMethod(
  postMessage: ReturnType<typeof vi.fn>,
  method: string,
): Array<Record<string, unknown>> {
  return postMessage.mock.calls
    .map((call) => call[0] as { method?: string })
    .filter((message) => message.method === method) as Array<Record<string, unknown>>;
}

function respondTo(postMessage: ReturnType<typeof vi.fn>, method: string, payload: unknown): void {
  const request = messagesByMethod(postMessage, method).at(-1) as { id: string };

  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'response', id: request.id, ok: true, payload },
    }),
  );
}

function typeAndSend(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('보내기'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StudioSidebar chat', () => {
  it('sends the instruction with the entity and the prior history', () => {
    const postMessage = renderStudio(characterTarget);

    typeAndSend('과거사 보강해줘');

    const sent = messagesByMethod(postMessage, 'studio.chat.send').at(-1) as {
      payload: { entity: unknown; instruction: string; history: unknown[] };
    };

    expect(sent.payload.entity).toEqual({ kind: 'character', key: 'seorin' });
    expect(sent.payload.instruction).toBe('과거사 보강해줘');
    expect(sent.payload.history).toEqual([]);
    expect(screen.getByText('과거사 보강해줘')).toBeTruthy();
  });

  it('shows a progress line with a cancel button while waiting', () => {
    const postMessage = renderStudio(characterTarget);

    typeAndSend('과거사 보강해줘');

    expect(screen.getByText('생각하는 중…')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('중단'));

    expect(messagesByMethod(postMessage, 'studio.chat.cancel')).toHaveLength(1);
    expect(screen.queryByText('생각하는 중…')).toBeNull();
  });

  it('follows the progress stage the host reports', async () => {
    renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'event', method: 'studio.chat.progress', payload: { stage: 'looking-up' } },
      }),
    );

    await waitFor(() => expect(screen.getByText('관련 자료를 찾는 중…')).toBeTruthy());
  });

  it('renders a free-form reply', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('이 카드에 과거사가 있어?');

    respondTo(postMessage, 'studio.chat.send', {
      turns: [{ id: 's1', role: 'assistant', kind: 'say', message: '아직 없습니다.' }],
    });

    await waitFor(() => expect(screen.getByText('아직 없습니다.')).toBeTruthy());
  });

  it('answers a question by clicking one of its options', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('보강해줘');

    respondTo(postMessage, 'studio.chat.send', {
      turns: [
        {
          id: 'a1',
          role: 'assistant',
          kind: 'ask',
          question: '어떤 축을 보강할까요?',
          options: ['성격', '과거사'],
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('과거사')).toBeTruthy());
    fireEvent.click(screen.getByText('과거사'));

    const sent = messagesByMethod(postMessage, 'studio.chat.send').at(-1) as {
      payload: { instruction: string; history: unknown[] };
    };

    expect(sent.payload.instruction).toBe('과거사');
    expect(sent.payload.history).toHaveLength(2);
  });

  it('shows a proposal with its validation badge and approves it', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [proposalTurn] });

    await waitFor(() => expect(screen.getByText('과거사에 화재 사건 추가')).toBeTruthy());
    expect(screen.getByText('정합성 검사 통과')).toBeTruthy();
    expect(screen.getByText('카드 필드 1곳')).toBeTruthy();

    fireEvent.click(screen.getByText('승인'));

    const applied = messagesByMethod(postMessage, 'studio.proposal.apply').at(-1) as {
      payload: { turn: { id: string } };
    };
    expect(applied.payload.turn.id).toBe('p1');

    respondTo(postMessage, 'studio.proposal.apply', {
      status: 'applied',
      message: 'character/seorin.card 적용됨 · +12자',
    });

    await waitFor(() => expect(screen.getByText('적용됨')).toBeTruthy());
    expect(screen.getByText('character/seorin.card 적용됨 · +12자')).toBeTruthy();
  });

  it('surfaces a stale-baseline refusal on the proposal', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [proposalTurn] });

    await waitFor(() => expect(screen.getByText('승인')).toBeTruthy());
    fireEvent.click(screen.getByText('승인'));

    respondTo(postMessage, 'studio.proposal.apply', {
      status: 'failed',
      message: '제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.',
    });

    await waitFor(() =>
      expect(
        screen.getByText('제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.'),
      ).toBeTruthy(),
    );
  });

  it('shows conflict warnings but still allows approval', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');

    respondTo(postMessage, 'studio.chat.send', {
      turns: [
        {
          ...proposalTurn,
          validation: {
            state: 'warn',
            warnings: [{ message: '씬 3과 어긋납니다', source: 'scene/03.card' }],
          },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('기존 설정과 충돌할 수 있어요')).toBeTruthy());
    expect(screen.getByText('씬 3과 어긋납니다 (scene/03.card)')).toBeTruthy();
    expect(screen.getByText('승인')).toBeTruthy();
  });

  it('opens a diff without applying', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [proposalTurn] });

    await waitFor(() => expect(screen.getByText('diff 보기')).toBeTruthy());
    fireEvent.click(screen.getByText('diff 보기'));

    expect(messagesByMethod(postMessage, 'studio.proposal.preview')).toHaveLength(1);
    expect(messagesByMethod(postMessage, 'studio.proposal.apply')).toHaveLength(0);
  });

  it('rejects a proposal locally without touching the host', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [proposalTurn] });

    await waitFor(() => expect(screen.getByText('거절')).toBeTruthy());
    fireEvent.click(screen.getByText('거절'));

    await waitFor(() => expect(screen.getByText('거절함')).toBeTruthy());
    expect(messagesByMethod(postMessage, 'studio.proposal.apply')).toHaveLength(0);
  });

  it('keeps typing open for a project target so /update stays reachable', () => {
    renderStudio(projectTarget);

    expect(screen.getByRole('textbox')).toHaveProperty('disabled', false);
    expect(screen.getByPlaceholderText(/update 로 카드를/)).toBeTruthy();
  });

  it('names the draft as the edit target when the draft is open', () => {
    renderStudio(draftTarget);

    expect(screen.getByText('draft/01-intro.md')).toBeTruthy();
    expect(screen.getByPlaceholderText(/도입부를 더 긴장감 있게/)).toBeTruthy();
  });

  it('names the scene card as the edit target when the card is open', () => {
    renderStudio(sceneCardTarget);

    expect(screen.getByText('scene/01-intro.card')).toBeTruthy();
    expect(screen.getByPlaceholderText(/갈등을 더 선명하게/)).toBeTruthy();
  });

  it('names the card file as the edit target for a character', () => {
    renderStudio(characterTarget);

    expect(screen.getByText('character/seorin.card')).toBeTruthy();
  });
});

describe('StudioSidebar sessions', () => {
  it('restores the turns of the latest session', () => {
    renderStudio(characterTarget, {
      id: '11111111-1111-1111-1111-111111111111',
      entity: { kind: 'character', key: 'seorin' },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:05:00.000Z',
      title: '과거사 보강해줘',
      hasAppliedChanges: false,
      turns: [{ id: 'u1', role: 'user', text: '과거사 보강해줘' }],
    });

    expect(screen.getByText('과거사 보강해줘')).toBeTruthy();
  });

  it('saves the session with the entity and the applied flag', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('과거사 보강해줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [proposalTurn] });

    await waitFor(() => expect(screen.getByText('승인')).toBeTruthy());
    fireEvent.click(screen.getByText('승인'));
    respondTo(postMessage, 'studio.proposal.apply', { status: 'applied', message: '적용됨' });

    await waitFor(() => {
      const saved = messagesByMethod(postMessage, 'studio.session.save').at(-1) as {
        payload: { entity: unknown; hasAppliedChanges: boolean };
      };
      expect(saved.payload.entity).toEqual({ kind: 'character', key: 'seorin' });
      expect(saved.payload.hasAppliedChanges).toBe(true);
    });
  });

  it("lists the entity's sessions and opens one", async () => {
    const postMessage = renderStudio(characterTarget);

    fireEvent.click(screen.getByLabelText('대화 기록'));

    const listCall = messagesByMethod(postMessage, 'studio.session.list').at(-1) as {
      payload: { entity: unknown };
    };
    expect(listCall.payload.entity).toEqual({ kind: 'character', key: 'seorin' });

    respondTo(postMessage, 'studio.session.list', {
      sessions: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          title: '지난 대화',
          updatedAt: '2026-07-18T09:00:00.000Z',
          turnCount: 2,
          hasAppliedChanges: false,
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('지난 대화')).toBeTruthy());
    fireEvent.click(screen.getByText('지난 대화'));

    respondTo(postMessage, 'studio.session.load', {
      session: {
        id: '22222222-2222-2222-2222-222222222222',
        entity: { kind: 'character', key: 'seorin' },
        createdAt: '2026-07-18T09:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z',
        title: '지난 대화',
        hasAppliedChanges: false,
        turns: [{ id: 'u9', role: 'user', text: '지난 지시' }],
      },
    });

    await waitFor(() => expect(screen.getByText('지난 지시')).toBeTruthy());
  });

  it('starts a new session with a fresh id', async () => {
    const postMessage = renderStudio(characterTarget);

    typeAndSend('첫 지시');
    respondTo(postMessage, 'studio.chat.send', {
      turns: [{ id: 's1', role: 'assistant', kind: 'say', message: '네' }],
    });
    await waitFor(() =>
      expect(messagesByMethod(postMessage, 'studio.session.save')).not.toHaveLength(0),
    );
    const firstId = (
      messagesByMethod(postMessage, 'studio.session.save').at(-1) as { payload: { id: string } }
    ).payload.id;

    fireEvent.click(screen.getByLabelText('새 대화'));
    typeAndSend('두 번째 지시');

    await waitFor(() => {
      const secondId = (
        messagesByMethod(postMessage, 'studio.session.save').at(-1) as { payload: { id: string } }
      ).payload.id;
      expect(secondId).not.toBe(firstId);
    });
  });
});

function switchTargetTo(target: StudioTarget): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'event', method: 'studio.targetChanged', payload: target },
    }),
  );
}

describe('StudioSidebar target switching', () => {
  const junoTarget: StudioTarget = {
    kind: 'character',
    label: 'juno.card',
    entity: { kind: 'character', key: 'juno' },
    cardUri: 'file:///character/juno.card',
    hasSelection: false,
  };

  it("clears the previous entity's turns when the open file changes", async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('서하 이야기');
    respondTo(postMessage, 'studio.chat.send', {
      turns: [{ id: 's1', role: 'assistant', kind: 'say', message: '서하 답변' }],
    });
    await waitFor(() => expect(screen.getByText('서하 답변')).toBeTruthy());

    switchTargetTo(junoTarget);

    await waitFor(() => expect(screen.queryByText('서하 답변')).toBeNull());
    expect(screen.queryByText('서하 이야기')).toBeNull();
  });

  it("asks for the new entity's latest conversation and restores it", async () => {
    const postMessage = renderStudio(characterTarget);

    switchTargetTo(junoTarget);

    await waitFor(() =>
      expect(messagesByMethod(postMessage, 'studio.session.latest')).not.toHaveLength(0),
    );
    const latest = messagesByMethod(postMessage, 'studio.session.latest').at(-1) as {
      payload: { entity: unknown };
    };
    expect(latest.payload.entity).toEqual({ kind: 'character', key: 'juno' });

    respondTo(postMessage, 'studio.session.latest', {
      session: {
        id: 'juno-1',
        entity: { kind: 'character', key: 'juno' },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        title: '준오 대화',
        hasAppliedChanges: false,
        turns: [{ id: 'u1', role: 'user', text: '준오 지난 대화' }],
      },
    });

    await waitFor(() => expect(screen.getByText('준오 지난 대화')).toBeTruthy());
  });

  it("never saves one entity's turns under another entity", async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('서하 이야기');
    await waitFor(() =>
      expect(messagesByMethod(postMessage, 'studio.session.save')).not.toHaveLength(0),
    );

    switchTargetTo(junoTarget);
    await waitFor(() => expect(screen.queryByText('서하 이야기')).toBeNull());

    for (const saved of messagesByMethod(postMessage, 'studio.session.save')) {
      const payload = saved.payload as { entity: { key: string }; turns: { text?: string }[] };
      const mentionsSeoha = payload.turns.some((turn) => turn.text === '서하 이야기');
      expect(mentionsSeoha ? payload.entity.key : 'seorin').toBe('seorin');
    }
  });

  it('frees the composer when the target changes mid-request', async () => {
    renderStudio(characterTarget);
    typeAndSend('서하 이야기');
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);

    switchTargetTo(junoTarget);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('disabled', false));
  });
});

describe('StudioSidebar follow-ups', () => {
  const followUpTurn: StudioChatTurn = {
    id: 's1',
    role: 'assistant',
    kind: 'say',
    message: '지호 카드도 손봐야 합니다.',
    followUps: [
      {
        kind: 'character',
        key: 'jiho',
        reason: '관계 서술이 어긋납니다',
        instruction: '서린과의 관계 서술을 맞춰줘',
        targetFile: 'character/jiho.card',
      },
    ],
  };

  it('offers a button for each follow-up the agent named', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('배경을 바꿔줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [followUpTurn] });

    await waitFor(() => expect(screen.getByText('character/jiho.card')).toBeTruthy());
    expect(screen.getByText('관계 서술이 어긋납니다')).toBeTruthy();
  });

  it('opens the follow-up file and stages its instruction without sending', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('배경을 바꿔줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [followUpTurn] });

    await waitFor(() => expect(screen.getByText('character/jiho.card')).toBeTruthy());

    const sentBefore = messagesByMethod(postMessage, 'studio.chat.send').length;
    fireEvent.click(screen.getByText('character/jiho.card'));

    const opened = messagesByMethod(postMessage, 'studio.followUp.open').at(-1) as {
      payload: { entity: unknown; targetFile: string };
    };
    expect(opened.payload).toEqual({
      entity: { kind: 'character', key: 'jiho' },
      targetFile: 'character/jiho.card',
    });

    expect(messagesByMethod(postMessage, 'studio.chat.send')).toHaveLength(sentBefore);
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveProperty('value', '서린과의 관계 서술을 맞춰줘'),
    );
  });

  it('starts a fresh conversation on a handoff instead of restoring the old one', async () => {
    const postMessage = renderStudio(characterTarget);
    typeAndSend('배경을 바꿔줘');
    respondTo(postMessage, 'studio.chat.send', { turns: [followUpTurn] });

    await waitFor(() => expect(screen.getByText('character/jiho.card')).toBeTruthy());
    fireEvent.click(screen.getByText('character/jiho.card'));

    const before = messagesByMethod(postMessage, 'studio.session.latest').length;

    switchTargetTo({
      kind: 'character',
      label: 'jiho.card',
      entity: { kind: 'character', key: 'jiho' },
      cardUri: 'file:///character/jiho.card',
      hasSelection: false,
    });

    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveProperty('value', '서린과의 관계 서술을 맞춰줘'),
    );
    expect(messagesByMethod(postMessage, 'studio.session.latest')).toHaveLength(before);
  });

  it('asks the host for the ripples waiting on the open entity', () => {
    const postMessage = renderStudio(characterTarget);

    const listed = messagesByMethod(postMessage, 'studio.followUp.list').at(-1) as {
      payload: { entity: unknown };
    };
    expect(listed.payload.entity).toEqual({ kind: 'character', key: 'seorin' });
  });

  it('shows the waiting ripples and stages one when picked', async () => {
    const postMessage = renderStudio(characterTarget);

    respondTo(postMessage, 'studio.followUp.list', {
      followUps: [
        {
          id: 'f1',
          origin: { kind: 'background', key: 'subway' },
          reason: '지하철 묘사가 바뀌었습니다',
          instruction: '감정 서술을 맞춰줘',
        },
      ],
    });

    await waitFor(() => expect(screen.getByText('다른 곳에서 넘어온 작업 1건')).toBeTruthy());
    expect(screen.getByText('background/subway 에서')).toBeTruthy();

    fireEvent.click(screen.getByText('지하철 묘사가 바뀌었습니다'));

    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveProperty('value', '감정 서술을 맞춰줘'),
    );
  });

  it('dismisses a waiting ripple', async () => {
    const postMessage = renderStudio(characterTarget);

    respondTo(postMessage, 'studio.followUp.list', {
      followUps: [
        {
          id: 'f1',
          origin: { kind: 'background', key: 'subway' },
          reason: '지하철 묘사가 바뀌었습니다',
          instruction: '감정 서술을 맞춰줘',
        },
      ],
    });

    await waitFor(() => expect(screen.getByLabelText('넘어온 작업 닫기')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('넘어온 작업 닫기'));

    expect(messagesByMethod(postMessage, 'studio.followUp.dismiss').at(-1)).toMatchObject({
      payload: { id: 'f1' },
    });
    await waitFor(() => expect(screen.queryByText('다른 곳에서 넘어온 작업 1건')).toBeNull());
  });
});
