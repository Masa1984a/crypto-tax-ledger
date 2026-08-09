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
