import { afterEach, describe, expect, it, vi } from "vitest"

import { LatestRequestGuard } from "@/presentation/providers/latest-request-guard"

describe("LatestRequestGuard", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs only the latest task for a key", async () => {
    vi.useFakeTimers()
    const guard = new LatestRequestGuard()
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)

    guard.schedule("draft", 100, first)
    guard.schedule("draft", 100, second)
    await vi.advanceTimersByTimeAsync(100)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("cancels pending work when disposed", async () => {
    vi.useFakeTimers()
    const guard = new LatestRequestGuard()
    const task = vi.fn(async () => undefined)

    guard.schedule("draft", 100, task)
    guard.dispose()
    await vi.advanceTimersByTimeAsync(100)

    expect(task).not.toHaveBeenCalled()
  })
})
