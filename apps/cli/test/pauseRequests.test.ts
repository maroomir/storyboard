import { describe, expect, it } from 'vitest';

import { PauseRequests } from '../src/adapters/pauseRequests';

describe('pause requests', () => {
  it('refuses when no run can pause, so Ctrl+C ends the process as before', () => {
    expect(new PauseRequests().request()).toBe(false);
  });

  it('takes the first request for a watching run and refuses the second', () => {
    const requests = new PauseRequests();
    const shouldPause = requests.watch();

    expect(shouldPause()).toBe(false);
    expect(requests.request()).toBe(true);
    expect(shouldPause()).toBe(true);
    expect(requests.request()).toBe(false);
  });
});
