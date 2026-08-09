"use server";

import { revalidatePath } from "next/cache";
import { commitImport, runDryRun, type CommitResult, type DryRunReport } from "@/lib/csv/dry-run";

export async function dryRunImportAction(csvText: string): Promise<DryRunReport> {
  return runDryRun(csvText);
}

export async function commitImportAction(
  csvText: string,
  filename: string,
  acknowledgeErrors: boolean
): Promise<CommitResult> {
  const result = await commitImport(csvText, filename, { acknowledgeErrors });
  if (result.success) {
    revalidatePath("/transactions");
    revalidatePath("/import/batches");
    revalidatePath("/");
  }
  return result;
}
