import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import {
  buildAnnualReport,
  computeAverageCostForAsset,
  expandTransactions,
  type ExpandableTransaction,
} from "@/lib/tax/average-cost";

const neverCalledFeeResolver = async (): Promise<Decimal | null> => {
  throw new Error("fee resolver should not be called when there is no fee_qty/fee_symbol");
};

describe("§6.5 検証用数値例(受け入れ基準1, 3)", () => {
  const txs: ExpandableTransaction[] = [
    {
      id: 1,
      executedAt: new Date("2025-10-01T09:00:00+09:00"),
      txType: "buy",
      baseSymbol: "BTC",
      baseQty: "0.10",
      quoteSymbol: "JPY",
      quoteQty: "1000000",
      jpyValue: "1000000",
      usdjpy: "150",
    },
    {
      id: 2,
      executedAt: new Date("2026-02-01T09:00:00+09:00"),
      txType: "buy",
      baseSymbol: "BTC",
      baseQty: "0.10",
      quoteSymbol: "JPY",
      quoteQty: "1400000",
      jpyValue: "1400000",
      usdjpy: "150",
    },
    {
      id: 3,
      executedAt: new Date("2026-06-01T09:00:00+09:00"),
      txType: "swap",
      baseSymbol: "PAXG",
      baseQty: "4.0",
      quoteSymbol: "BTC",
      quoteQty: "0.05",
      jpyValue: "800000",
      usdjpy: "150",
    },
  ];

  it("2025年: BTC取得0.10/¥1,000,000、譲渡なし、期末0.10/¥1,000,000", async () => {
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    const report = buildAnnualReport(expansion, 2025);
    const btc = report.assets.find((a) => a.symbol === "BTC");
    expect(btc).toBeDefined();
    expect(btc!.acquiredQty.toFixed()).toBe("0.1");
    expect(btc!.acquiredCostJpy.toFixed(2)).toBe("1000000.00");
    expect(btc!.disposedQty.toFixed()).toBe("0");
    expect(btc!.closingQty.toFixed()).toBe("0.1");
    expect(btc!.closingCostJpy.toFixed(2)).toBe("1000000.00");
    expect(report.totalRealizedGainJpy.toFixed(2)).toBe("0.00");
    // PAXGはまだ存在しない
    expect(report.assets.find((a) => a.symbol === "PAXG")).toBeUndefined();
  });

  it("2026年: BTC平均単価¥12,000,000、譲渡原価¥600,000、実現益¥200,000、期末0.15/¥1,800,000", async () => {
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    const report = buildAnnualReport(expansion, 2026);
    const btc = report.assets.find((a) => a.symbol === "BTC");
    expect(btc).toBeDefined();
    expect(btc!.openingQty.toFixed()).toBe("0.1");
    expect(btc!.openingCostJpy.toFixed(2)).toBe("1000000.00");
    expect(btc!.averageUnitCost.toFixed(2)).toBe("12000000.00");
    expect(btc!.disposedQty.toFixed()).toBe("0.05");
    expect(btc!.disposedProceedsJpy.toFixed(2)).toBe("800000.00");
    expect(btc!.costOfGoodsSoldJpy.toFixed(2)).toBe("600000.00");
    expect(btc!.realizedGainJpy.toFixed(2)).toBe("200000.00");
    expect(btc!.closingQty.toFixed()).toBe("0.15");
    expect(btc!.closingCostJpy.toFixed(2)).toBe("1800000.00");
  });

  it("2026年: PAXG取得4.0/¥800,000、譲渡なし(受け入れ基準3: swapの両建て)", async () => {
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    const report = buildAnnualReport(expansion, 2026);
    const paxg = report.assets.find((a) => a.symbol === "PAXG");
    expect(paxg).toBeDefined();
    expect(paxg!.acquiredQty.toFixed()).toBe("4");
    expect(paxg!.acquiredCostJpy.toFixed(2)).toBe("800000.00");
    expect(paxg!.disposedQty.toFixed()).toBe("0");
    expect(paxg!.closingQty.toFixed()).toBe("4");
    expect(paxg!.closingCostJpy.toFixed(2)).toBe("800000.00");
  });

  it("swapの1行が同時にBTCの譲渡とPAXGの取得の両方に現れる(同一txId)", async () => {
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    const btcDisposal = expansion.disposals.find((d) => d.txId === 3);
    const paxgAcquisition = expansion.acquisitions.find((a) => a.txId === 3);
    expect(btcDisposal).toMatchObject({ symbol: "BTC", proceedsJpy: expect.any(Decimal) });
    expect(paxgAcquisition).toMatchObject({ symbol: "PAXG", costJpy: expect.any(Decimal) });
    expect(btcDisposal!.proceedsJpy.toFixed(2)).toBe(paxgAcquisition!.costJpy.toFixed(2));
  });

  it("quote=JPYのbuyはJPYの取得イベントを生成しない(JPYは計算対象外)", async () => {
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    expect(expansion.acquisitions.some((a) => a.symbol === "JPY")).toBe(false);
    expect(expansion.disposals.some((d) => d.symbol === "JPY")).toBe(false);
  });
});

describe("reward: 取得イベント + 報酬所得", () => {
  it("reward行はbaseの取得イベントと同額の報酬所得を両方生成する", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 10,
        executedAt: new Date("2026-08-01T12:00:00+09:00"),
        txType: "reward",
        baseSymbol: "BASIS",
        baseQty: "12.34",
        jpyValue: "5000",
        usdjpy: "150",
      },
    ];
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    expect(expansion.acquisitions).toEqual([
      expect.objectContaining({ symbol: "BASIS", qty: expect.any(Decimal), costJpy: expect.any(Decimal) }),
    ]);
    expect(expansion.rewardIncome).toEqual([expect.objectContaining({ year: 2026, jpy: expect.any(Decimal) })]);
    expect(expansion.rewardIncome[0].jpy.toFixed(2)).toBe("5000.00");

    const report = buildAnnualReport(expansion, 2026);
    expect(report.totalRewardIncomeJpy.toFixed(2)).toBe("5000.00");
    expect(report.miscIncomeJpy.toFixed(2)).toBe("5000.00");
  });
});

describe("fee: 単独ガス代 tx_type", () => {
  it("baseの時価譲渡として disposals に入り、同額が feeExpenses に計上される", async () => {
    const txs: ExpandableTransaction[] = [
      // 先にETHを取得しておく(取得原価0だと譲渡益とfee経費が偶然相殺して分かりにくいため)
      {
        id: 19,
        executedAt: new Date("2026-01-01T00:00:00Z"),
        txType: "buy",
        baseSymbol: "ETH",
        baseQty: "1",
        quoteSymbol: "JPY",
        quoteQty: "400000",
        jpyValue: "400000",
        usdjpy: "150",
      },
      {
        id: 20,
        executedAt: new Date("2026-05-01T00:00:00Z"),
        txType: "fee",
        baseSymbol: "ETH",
        baseQty: "0.002",
        jpyValue: "900",
        usdjpy: "150",
      },
    ];
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    const feeDisposal = expansion.disposals.find((d) => d.txId === 20);
    expect(feeDisposal).toMatchObject({ symbol: "ETH", proceedsJpy: expect.any(Decimal) });
    expect(expansion.feeExpenses[0].jpy.toFixed(2)).toBe("900.00");

    const report = buildAnnualReport(expansion, 2026);
    const eth = report.assets.find((a) => a.symbol === "ETH")!;
    // 平均単価400,000。0.002ETH分の原価800、譲渡収入900 -> 実現益100
    expect(eth.costOfGoodsSoldJpy.toFixed(2)).toBe("800.00");
    expect(eth.realizedGainJpy.toFixed(2)).toBe("100.00");
    expect(report.totalFeeExpenseJpy.toFixed(2)).toBe("900.00");
    // 雑所得 = 実現益100 + 報酬所得0 - 必要経費900 = -800
    expect(report.miscIncomeJpy.toFixed(2)).toBe("-800.00");
  });
});

describe("fee_qty: 全tx_type共通のガス代フィールド", () => {
  it("buy行にfee_qtyがあれば、fee資産の譲渡+経費として別途展開される", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 30,
        executedAt: new Date("2026-03-10T21:00:00+09:00"),
        txType: "buy",
        baseSymbol: "SOL",
        baseQty: "10",
        quoteSymbol: "USDC",
        quoteQty: "1450",
        jpyValue: "217500",
        usdjpy: "150",
        feeSymbol: "USDC",
        feeQty: "1.2",
        feeAssetId: 4,
      },
    ];
    const feeResolver = async () => new Decimal(1); // stable = $1
    const expansion = await expandTransactions(txs, feeResolver);

    expect(expansion.disposals).toHaveLength(2); // quote(USDC 1450) + fee(USDC 1.2)
    const feeDisposal = expansion.disposals.find((d) => d.qty.equals(new Decimal("1.2")));
    expect(feeDisposal).toBeDefined();
    expect(feeDisposal!.proceedsJpy.toFixed(2)).toBe("180.00"); // 1.2 * 1 * 150
    expect(expansion.feeExpenses[0].jpy.toFixed(2)).toBe("180.00");
  });

  it("fee資産の価格が取得できない場合は警告し、経費計算から除外する", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 31,
        executedAt: new Date("2026-03-10T21:00:00+09:00"),
        txType: "reward",
        baseSymbol: "BASIS",
        baseQty: "1",
        jpyValue: "100",
        usdjpy: "150",
        feeSymbol: "UNKNOWNCOIN",
        feeQty: "5",
        feeAssetId: 99,
      },
    ];
    const feeResolver = async () => null;
    const expansion = await expandTransactions(txs, feeResolver);
    expect(expansion.feeExpenses).toEqual([]);
    expect(expansion.disposals).toEqual([]);
    expect(expansion.warnings.some((w) => w.includes("UNKNOWNCOIN"))).toBe(true);
  });
});

describe("transfer_in / transfer_out", () => {
  it("base_qtyは計算に不参加。fee_qtyがあればそれのみ展開される", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 40,
        executedAt: new Date("2026-01-01T00:00:00Z"),
        txType: "transfer_out",
        baseSymbol: "ETH",
        baseQty: "1.5",
        jpyValue: "500000",
        usdjpy: "150",
        feeSymbol: "ETH",
        feeQty: "0.001",
        feeAssetId: 2,
      },
    ];
    const feeResolver = async () => new Decimal(3000);
    const expansion = await expandTransactions(txs, feeResolver);

    expect(expansion.acquisitions).toEqual([]);
    // disposals should only contain the fee leg (0.001 ETH), not the 1.5 ETH transfer itself
    expect(expansion.disposals).toHaveLength(1);
    expect(expansion.disposals[0].qty.toFixed()).toBe("0.001");
  });

  it("fee_qtyが無ければ何も展開されない", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 41,
        executedAt: new Date("2026-01-01T00:00:00Z"),
        txType: "transfer_in",
        baseSymbol: "ETH",
        baseQty: "1.5",
        jpyValue: "500000",
        usdjpy: "150",
      },
    ];
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    expect(expansion.acquisitions).toEqual([]);
    expect(expansion.disposals).toEqual([]);
  });
});

describe("sell: base=JPY (暗号資産をJPYで売却)", () => {
  it("base=JPYの取得イベントは生成されず、quoteの譲渡イベントのみ生成される", async () => {
    const txs: ExpandableTransaction[] = [
      {
        id: 50,
        executedAt: new Date("2026-04-01T00:00:00Z"),
        txType: "sell",
        baseSymbol: "JPY",
        baseQty: "500000",
        quoteSymbol: "BTC",
        quoteQty: "0.05",
        jpyValue: "500000",
        usdjpy: "150",
      },
    ];
    const expansion = await expandTransactions(txs, neverCalledFeeResolver);
    expect(expansion.acquisitions).toEqual([]);
    expect(expansion.disposals).toEqual([
      expect.objectContaining({ symbol: "BTC", proceedsJpy: expect.any(Decimal) }),
    ]);
    expect(expansion.disposals[0].proceedsJpy.toFixed(2)).toBe("500000.00");
  });
});

describe("computeAverageCostForAsset: データ不整合の検知", () => {
  it("取得も期首残高もない状態で譲渡があれば警告する", () => {
    const results = computeAverageCostForAsset({
      symbol: "BTC",
      acquisitions: [],
      disposals: [{ year: 2026, qty: new Decimal("1"), proceedsJpy: new Decimal("1000000") }],
      rewardIncomeByYear: new Map(),
      feeExpenseByYear: new Map(),
      throughYear: 2026,
    });
    // acquisitions/disposals両方が空なら対象年が無いので結果は0件ではなく、
    // disposalsに年があるのでfirstYear=2026として1件出るはず
    expect(results).toHaveLength(1);
    expect(results[0].warnings.some((w) => w.includes("数量不整合"))).toBe(true);
  });

  it("譲渡数量が保有数量を超えるとマイナス残高警告を出す", () => {
    const results = computeAverageCostForAsset({
      symbol: "BTC",
      acquisitions: [{ year: 2026, qty: new Decimal("1"), costJpy: new Decimal("10000000") }],
      disposals: [{ year: 2026, qty: new Decimal("2"), proceedsJpy: new Decimal("5000000") }],
      rewardIncomeByYear: new Map(),
      feeExpenseByYear: new Map(),
      throughYear: 2026,
    });
    expect(results[0].closingQty.isNegative()).toBe(true);
    expect(results[0].warnings.some((w) => w.includes("マイナス"))).toBe(true);
  });

  it("複数年にわたって期末残高が翌年の期首残高として繰り越される", () => {
    const results = computeAverageCostForAsset({
      symbol: "ETH",
      acquisitions: [
        { year: 2024, qty: new Decimal("1"), costJpy: new Decimal("300000") },
        { year: 2026, qty: new Decimal("1"), costJpy: new Decimal("500000") },
      ],
      disposals: [],
      rewardIncomeByYear: new Map(),
      feeExpenseByYear: new Map(),
      throughYear: 2026,
    });
    // 2024, 2025(活動なし), 2026の3年分が出るはず
    expect(results.map((r) => r.year)).toEqual([2024, 2025, 2026]);
    expect(results[1].openingQty.toFixed()).toBe("1");
    expect(results[1].openingCostJpy.toFixed(2)).toBe("300000.00");
    expect(results[2].openingQty.toFixed()).toBe("1");
    expect(results[2].averageUnitCost.toFixed(2)).toBe("400000.00"); // (300000+500000)/(1+1)
  });
});
