import { Decimal } from "@/lib/decimal";
import type { TxType } from "@/lib/db/schema";

export interface HoldingsTransaction {
  txType: TxType;
  baseSymbol: string;
  baseQty: string;
  quoteSymbol?: string | null;
  quoteQty?: string | null;
  feeSymbol?: string | null;
  feeQty?: string | null;
}

const EXCHANGE_TYPES = new Set<TxType>(["buy", "sell", "swap"]);
const BASE_INCREASE_TYPES = new Set<TxType>(["buy", "sell", "swap", "reward"]);

/**
 * §5.5 保有数量の集計:
 * +base_qty: buy/sell/swap/reward
 * -quote_qty: buy/sell/swap
 * -base_qty: fee
 * -fee_qty: fee_qtyが入っている全行
 * transfer_in/transfer_outのbase_qtyは集計に含めない
 */
export function computeHoldings(txs: HoldingsTransaction[]): Map<string, Decimal> {
  const holdings = new Map<string, Decimal>();
  const add = (symbol: string, delta: Decimal) => {
    holdings.set(symbol, (holdings.get(symbol) ?? new Decimal(0)).plus(delta));
  };

  for (const tx of txs) {
    if (BASE_INCREASE_TYPES.has(tx.txType)) {
      add(tx.baseSymbol, new Decimal(tx.baseQty));
    }
    if (EXCHANGE_TYPES.has(tx.txType) && tx.quoteSymbol && tx.quoteQty) {
      add(tx.quoteSymbol, new Decimal(tx.quoteQty).negated());
    }
    if (tx.txType === "fee") {
      add(tx.baseSymbol, new Decimal(tx.baseQty).negated());
    }
    if (tx.feeSymbol && tx.feeQty) {
      add(tx.feeSymbol, new Decimal(tx.feeQty).negated());
    }
  }

  return holdings;
}

export interface LocationTaggedTransaction {
  txType: TxType;
  baseSymbol: string;
  baseQty: string;
  location?: string | null;
}

export interface LocationBreakdownRow {
  symbol: string;
  location: string;
  qty: Decimal;
}

/**
 * 保管場所タグの内訳(取得ベース・参考値)。buy/sell/swap/rewardで取得したbase_qtyを
 * (symbol, location) ごとに合計する。その後の売却・移動までは追跡しない(§5.5の厳密な
 * 保有数量集計とは別の、ユーザーが付けた保管場所メモの単純集計)。
 */
export function computeLocationBreakdown(txs: LocationTaggedTransaction[]): LocationBreakdownRow[] {
  const nested = new Map<string, Map<string, Decimal>>();

  for (const tx of txs) {
    if (!BASE_INCREASE_TYPES.has(tx.txType)) continue;
    if (!tx.location) continue;
    const bySymbol = nested.get(tx.baseSymbol) ?? new Map<string, Decimal>();
    bySymbol.set(tx.location, (bySymbol.get(tx.location) ?? new Decimal(0)).plus(tx.baseQty));
    nested.set(tx.baseSymbol, bySymbol);
  }

  const result: LocationBreakdownRow[] = [];
  for (const [symbol, byLocation] of nested) {
    for (const [location, qty] of byLocation) {
      result.push({ symbol, location, qty });
    }
  }
  result.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.location.localeCompare(b.location));
  return result;
}
