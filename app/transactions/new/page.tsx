import Link from "next/link";
import { listAssets } from "@/lib/db/assets";
import { TransactionForm } from "../TransactionForm";

export default async function NewTransactionPage() {
  const assets = await listAssets();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">取引を手入力</h1>
        <Link href="/transactions" className="text-sm text-blue-700 hover:underline">
          一覧に戻る
        </Link>
      </div>
      <TransactionForm mode="create" assets={assets} />
    </div>
  );
}
