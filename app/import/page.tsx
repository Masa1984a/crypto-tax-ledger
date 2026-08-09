import Link from "next/link";
import { ImportClient } from "./ImportClient";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">CSV一括登録</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/assets" className="text-blue-700 hover:underline">
            資産マスタ
          </Link>
          <Link href="/import/batches" className="text-blue-700 hover:underline">
            バッチ一覧
          </Link>
          <Link href="/transactions" className="text-blue-700 hover:underline">
            取引一覧に戻る
          </Link>
        </div>
      </div>
      <ImportClient />
    </div>
  );
}
