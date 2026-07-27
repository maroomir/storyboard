import { describe, expect, it } from 'vitest';

import {
  JobAbortedError,
  createAbortableCliRunner,
  createJobAwareCliRunner,
} from '../src/provider/abortableCliRunner';
import { runWithJobSignal } from '../src/provider/jobSignalContext';

const NODE = process.execPath;

function multibyteScript(): string {
  // Writes '가' (EA B0 80) split across two chunks so a naive per-chunk toString() corrupts it.
  return [
    'process.stdout.write(Buffer.from([0xea]));',
    'setTimeout(() => process.stdout.write(Buffer.from([0xb0, 0x80])), 30);',
  ].join('\n');
}

describe('abortable CLI runner', () => {
  it('reassembles multibyte output split across chunks', async () => {
    const runner = createAbortableCliRunner(new AbortController().signal);

    const result = await runner({ command: NODE, args: ['-e', multibyteScript()] });

    expect(result.stdout).toBe('가');
    expect(result.exitCode).toBe(0);
  });

  it('rejects with JobAbortedError and terminates the process on abort', async () => {
    const controller = new AbortController();
    const runner = createAbortableCliRunner(controller.signal);

    const pending = runner({ command: NODE, args: ['-e', 'setTimeout(() => {}, 60000);'] });
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toBeInstanceOf(JobAbortedError);
  });

  it('binds the job-aware runner to the signal active on the async chain', async () => {
    const runner = createJobAwareCliRunner();
    const controller = new AbortController();

    const pending = runWithJobSignal(controller.signal, () =>
      runner({ command: NODE, args: ['-e', 'setTimeout(() => {}, 60000);'] }),
    );
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toBeInstanceOf(JobAbortedError);
  });

  it('runs normally outside any job context', async () => {
    const runner = createJobAwareCliRunner();

    const result = await runner({ command: NODE, args: ['-e', "process.stdout.write('ok')"] });

    expect(result.stdout).toBe('ok');
  });
});
