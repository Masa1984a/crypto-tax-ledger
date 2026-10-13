import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDailyHistory, MIN_REQUEST_GAP_MS } from "@/lib/external/cryptocompare";

interface FetchLogEntry {
  startedAt: number;
  respondedAt: number;
}

/** fetch のフェイク: 各呼び出しの開始・応答時刻を記録し、latencyMs 遅れて応答する。 */
function stubFetch(opts: { latencyMs?: (call: number) => number; networkError?: (call: number) => boolean } = {}) {
  const log: FetchLogEntry[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const call = log.length;
      const entry = { startedAt: Date.now(), respondedAt: 0 };
      log.push(entry);
      await new Promise((resolve) => setTimeout(resolve, opts.latencyMs?.(call) ?? 0));
      entry.respondedAt = Date.now();
      if (opts.networkError?.(call)) throw new TypeError("fetch failed");
      return new Response(
        JSON.stringify({ Response: "Success", Data: { Data: [{ time: 1_791_504_000, close: 100 }] } }),
        { status: 200 }
      );
    })
  );
  return log;
}

describe("fetchDailyHistory - rate limiting (1 call/sec on the free plan)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serializes concurrent calls and waits MIN_REQUEST_GAP_MS after each response", async () => {
    const log = stubFetch();

    const all = Promise.all(["BTC", "ETH", "PAXG", "SOL", "XAUT"].map((s) => fetchDailyHistory(s, 7, "key")));
    await vi.runAllTimersAsync();
    await all;

    expect(log).toHaveLength(5);
    for (let i = 1; i < log.length; i++) {
      expect(log[i].startedAt - log[i - 1].respondedAt).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS);
    }
  });

  it("measures the gap from the previous response, not the previous request start", async () => {
    // 初回だけ接続確立で応答が遅いケース。送信時刻基準だとサーバー到着の間隔が1秒を切り得る。
    const log = stubFetch({ latencyMs: (call) => (call === 0 ? 800 : 0) });

    const all = Promise.all([fetchDailyHistory("BTC", 7, "key"), fetchDailyHistory("ETH", 7, "key")]);
    await vi.runAllTimersAsync();
    await all;

    expect(log[1].startedAt - log[0].startedAt).toBeGreaterThanOrEqual(800 + MIN_REQUEST_GAP_MS);
  });

  it("keeps the queue moving after a failed request, still honoring the gap", async () => {
    const log = stubFetch({ networkError: (call) => call === 0 });

    const first = fetchDailyHistory("PAXG", 7, "key");
    const second = fetchDailyHistory("SOL", 7, "key");
    const firstRejects = expect(first).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();
    await firstRejects;

    await expect(second).resolves.toEqual([{ priceDate: "2026-10-09", closeUsd: "100" }]);
    expect(log[1].startedAt - log[0].respondedAt).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS);
  });
});
