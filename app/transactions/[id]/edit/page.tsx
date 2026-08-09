import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions } from "@/lib/db/schema";
import { listAssets } from "@/lib/db/assets";
import { toJstIsoString } from "@/lib/datetime";
import { TransactionForm } from "../../TransactionForm";

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const [assets, tx] = await Promise.all([
    listAssets(),
    db.query.transactions.findFirst({
      where: eq(transactions.id, id),
      with: { baseAsset: true, quoteAsset: true, feeAsset: true },
    }),
  ]);

  if (!tx) notFound();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">取引を編集(ID: {tx.id})</h1>
        <Link href="/transactions" className="text-sm text-blue-700 hover:underline">
          一覧に戻る
        </Link>
      </div>
      <TransactionForm
        mode="edit"
        assets={assets}
        transactionId={tx.id}
        initialData={{
          executedAt: toJstIsoString(tx.executedAt),
          txType: tx.txType as never,
          baseSymbol: tx.baseAsset.symbol,
          baseQty: tx.baseQty,
          quoteSymbol: tx.quoteAsset?.symbol ?? "",
          quoteQty: tx.quoteQty ?? "",
          priceUsd: tx.priceUsd ?? "",
          usdjpy: tx.usdjpy ?? "",
          jpyValue: tx.jpyValue ?? "",
          priceSource: tx.priceSource ?? "",
          feeSymbol: tx.feeAsset?.symbol ?? "",
          feeQty: tx.feeQty ?? "",
          venue: tx.venue ?? "",
          txHash: tx.txHash ?? "",
          memo: tx.memo ?? "",
        }}
      />
    </div>
  );
}
