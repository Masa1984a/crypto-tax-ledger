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

const TRANSFER_TYPES = new Set<TxType>(["transfer_in", "transfer_out"]);

export interface LocationTaggedTransaction extends HoldingsTransaction {
  location?: string | null;
  sourceLocation?: string | null;
}

export interface LocationBreakdownRow {
  symbol: string;
  /** null は「タグなし」(保有数量のうち、どの保管場所にも割り当たっていない分) */
  location: string | null;
  qty: Decimal;
}

/**
 * 保管場所の内訳。保管場所タグごとに数量の出入りを追跡する:
 * +base_qty → location: buy/sell/swap/reward(受け取った資産)、transfer(移動先)
 * -quote_qty → source_location: buy/sell/swap(支払った資産)
 * -base_qty → source_location: fee(単独手数料)、transfer(移動元)
 * -fee_qty: transferは移動元から。それ以外は、受け取った資産と同じ銘柄なら location から
 *           (受取額から差し引かれた手数料)、別銘柄なら source_location から
 * 最後に銘柄ごとに「タグなし = §5.5の保有数量 − タグ別数量の合計」を加えるので、銘柄ごとの
 * 合計は保有数量と必ず一致する。タグなしがマイナスなら、タグか支払元の付け忘れ・誤りを示す。
 * JPYは保有評価と同じく対象外。数量0の行は返さない。
 */
export function computeLocationBreakdown(txs: LocationTaggedTransaction[]): LocationBreakdownRow[] {
  const nested = new Map<string, Map<string, Decimal>>();
  const add = (symbol: string, location: string | null | undefined, delta: Decimal) => {
    if (!location || symbol === "JPY") return;
    const bySymbol = nested.get(symbol) ?? new Map<string, Decimal>();
    bySymbol.set(location, (bySymbol.get(location) ?? new Decimal(0)).plus(delta));
    nested.set(symbol, bySymbol);
  };

  for (const tx of txs) {
    const baseQty = new Decimal(tx.baseQty);
    const isTransfer = TRANSFER_TYPES.has(tx.txType);

    if (BASE_INCREASE_TYPES.has(tx.txType)) {
      add(tx.baseSymbol, tx.location, baseQty);
    }
    if (EXCHANGE_TYPES.has(tx.txType) && tx.quoteSymbol && tx.quoteQty) {
      add(tx.quoteSymbol, tx.sourceLocation, new Decimal(tx.quoteQty).negated());
    }
    if (tx.txType === "fee") {
      add(tx.baseSymbol, tx.sourceLocation, baseQty.negated());
    }
    if (isTransfer) {
      add(tx.baseSymbol, tx.sourceLocation, baseQty.negated());
      add(tx.baseSymbol, tx.location, baseQty);
    }
    if (tx.feeSymbol && tx.feeQty) {
      const feeFrom =
        !isTransfer && BASE_INCREASE_TYPES.has(tx.txType) && tx.feeSymbol === tx.baseSymbol
          ? tx.location
          : tx.sourceLocation;
      add(tx.feeSymbol, feeFrom, new Decimal(tx.feeQty).negated());
    }
  }

  const holdings = computeHoldings(txs);
  const symbols = new Set([...holdings.keys(), ...nested.keys()]);
  symbols.delete("JPY");

  const result: LocationBreakdownRow[] = [];
  for (const symbol of symbols) {
    const byLocation = nested.get(symbol) ?? new Map<string, Decimal>();
    let tagged = new Decimal(0);
    for (const [location, qty] of byLocation) {
      tagged = tagged.plus(qty);
      if (!qty.isZero()) result.push({ symbol, location, qty });
    }
    const untagged = (holdings.get(symbol) ?? new Decimal(0)).minus(tagged);
    if (!untagged.isZero()) result.push({ symbol, location: null, qty: untagged });
  }

  // 銘柄順、同一銘柄内は保管場所名順で「タグなし」は末尾
  result.sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      (a.location === null ? 1 : 0) - (b.location === null ? 1 : 0) ||
      (a.location ?? "").localeCompare(b.location ?? "")
  );
  return result;
}
