import Link from "next/link";
import { listAssets } from "@/lib/db/assets";
import { AssetsTable } from "./AssetsTable";

export default async function AssetsPage() {
  const assets = await listAssets();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">資産マスタ管理</h1>
        <Link href="/transactions" className="text-sm text-blue-700 hover:underline">
          取引一覧に戻る
        </Link>
      </div>
      <AssetsTable assets={assets} />
    </div>
  );
}
