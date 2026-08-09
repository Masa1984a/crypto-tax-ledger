import { NextResponse } from "next/server";
import { generateAnnualReport } from "@/lib/tax/db";
import { buildAnnualReportCsv } from "@/lib/csv/export";

export async function GET(_request: Request, { params }: { params: Promise<{ year: string }> }) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  const report = await generateAnnualReport(year);
  const csv = buildAnnualReportCsv(report);
  // Excelでの文字化け対策としてUTF-8 BOMを付与する
  const withBom = String.fromCharCode(0xfeff) + csv;

  return new NextResponse(withBom, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="crypto-tax-report-${year}.csv"`,
    },
  });
}
