import Link from "next/link";

const LINKS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/transactions", label: "取引一覧" },
  { href: "/import", label: "CSV取込" },
  { href: "/assets", label: "資産マスタ" },
] as const;

export function TopNav() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-2 text-sm">
        <span className="font-semibold text-gray-900">crypto-tax-ledger</span>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-gray-600 hover:text-gray-900 hover:underline">
            {l.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
