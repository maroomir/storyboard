import { spawn } from 'node:child_process';

import { type AiMessage } from '../../contracts/aiTypes';

export interface CliRunInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface CliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type CliRunner = (input: CliRunInput) => Promise<CliRunResult>;

export function createDefaultCliRunner(): CliRunner {
  return (input) =>
    new Promise<CliRunResult>((resolve, reject) => {
      // SECURITY: shell:false와 인자 배열로 실행해 셸 보간/명령 주입을 차단하고,
      // 사용자·외부 입력이 섞인 프롬프트는 인자가 아니라 stdin으로만 전달한다.
      const child = spawn(input.command, [...input.args], { shell: false, cwd: input.cwd });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        action();
      };

      const timer =
        input.timeoutMs !== undefined
          ? setTimeout(() => {
              child.kill('SIGKILL');
              finish(() =>
                reject(new Error(`CLI 실행이 ${input.timeoutMs}ms 안에 완료되지 않았습니다.`)),
              );
            }, input.timeoutMs)
          : undefined;

      // NOTE: 청크 단위 toString()은 멀티바이트 문자가 청크 경계에서 잘리면 U+FFFD로 깨진다.
      // 버퍼를 모아 종료 시점에 한 번만 디코딩한다.
      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      child.on('error', (error) => {
        finish(() => reject(error));
      });
      child.on('close', (code) => {
        finish(() =>
          resolve({
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            exitCode: code,
          }),
        );
      });

      // NOTE: 사용자 지정 command가 stdin 소비 전 종료하면 stdin에 EPIPE 'error'가 발생하는데,
      // 리스너가 없으면 uncaught 예외로 확장 호스트가 죽는다. 실패는 child 'error'/'close'로 표면화한다.
      child.stdin?.on('error', () => {});

      if (input.stdin !== undefined) {
        child.stdin?.write(input.stdin);
      }
      child.stdin?.end();
    });
}

export function isCommandNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

export interface SplitCliPrompt {
  readonly systemPrompt?: string;
  readonly userPrompt: string;
}

export function splitCliPrompt(messages: readonly AiMessage[]): SplitCliPrompt {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const userPrompt = messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.content)
    .join('\n\n');

  return {
    ...(systemPrompt.length > 0 ? { systemPrompt } : {}),
    userPrompt,
  };
}
