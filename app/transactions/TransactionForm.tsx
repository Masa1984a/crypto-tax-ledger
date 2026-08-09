"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { TX_TYPES } from "@/lib/db/schema";
import { formatJst } from "@/lib/datetime";
import { transactionInputSchema, transactionUpdateSchema, TX_TYPE_LABELS } from "@/lib/validation/transaction";
import { AssetCombobox, type AssetOption } from "@/components/asset-combobox";
import { createTransaction, updateTransaction, previewConversion, type PreviewResult } from "./actions";

const EXCHANGE_TYPES = new Set(["buy", "sell", "swap"]);

interface FormValues {
  executedAt: string;
  txType: (typeof TX_TYPES)[number];
  baseSymbol: string;
  baseQty: string;
  quoteSymbol: string;
  quoteQty: string;
  priceUsd: string;
  usdjpy: string;
  jpyValue: string;
  priceSource: string;
  feeSymbol: string;
  feeQty: string;
  venue: string;
  txHash: string;
  memo: string;
}

export interface TransactionFormProps {
  assets: AssetOption[];
  mode: "create" | "edit";
  transactionId?: number;
  initialData?: Partial<FormValues>;
}

function defaultExecutedAt(): string {
  return `${formatJst(new Date(), "yyyy-MM-dd'T'HH:mm")}:00+09:00`;
}

const PRICE_SOURCE_LABELS: Record<string, string> = {
  manual: "手動指定",
  derived: "取引レートから算出",
  daily_close: "日次終値",
  daily_close_prev: "日次終値(繰越)",
};

export function TransactionForm({ assets, mode, transactionId, initialData }: TransactionFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult>({ status: "pending" });

  const {
    register,
    control,
    watch,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    // 編集時はjpy_value/price_sourceも直接値として必須になるtransactionUpdateSchemaを使う。
    // create用のtransactionInputSchemaのままだとこの2フィールドがスキーマ未定義のため
    // resolverの出力(values)からstripされ、updateTransaction呼び出し時にundefinedになる。
    resolver: zodResolver(mode === "create" ? transactionInputSchema : transactionUpdateSchema) as never,
    defaultValues: {
      executedAt: defaultExecutedAt(),
      txType: "buy",
      baseSymbol: "",
      baseQty: "",
      quoteSymbol: "",
      quoteQty: "",
      priceUsd: "",
      usdjpy: "",
      jpyValue: "",
      priceSource: "",
      feeSymbol: "",
      feeQty: "",
      venue: "",
      txHash: "",
      memo: "",
      ...initialData,
    },
  });

  const txType = watch("txType");
  const executedAt = watch("executedAt");
  const baseSymbol = watch("baseSymbol");
  const baseQty = watch("baseQty");
  const quoteSymbol = watch("quoteSymbol");
  const quoteQty = watch("quoteQty");
  const priceUsd = watch("priceUsd");
  const usdjpy = watch("usdjpy");
  const needsQuote = EXCHANGE_TYPES.has(txType);

  // tx_typeが切り替わってquoteが不要になったら、隠れたフィールドの残存値でバリデーションが
  // 落ちないようクリアする。
  useEffect(() => {
    if (!needsQuote) {
      setValue("quoteSymbol", "");
      setValue("quoteQty", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsQuote]);

  // §5.1 UX要件: executed_at・銘柄入力時にprice_usd/usdjpyをプリフィルし、円換算をライブプレビュー。
  // 編集画面では「再取得」ボタンを押した場合のみ再計算するため、ここでは新規作成時のみ動作する。
  useEffect(() => {
    if (mode !== "create") return;
    const timer = setTimeout(() => {
      void runPreview({ writeBackIfUnlocked: true });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, executedAt, txType, baseSymbol, baseQty, quoteSymbol, quoteQty, priceUsd, usdjpy]);

  async function runPreview(opts: { writeBackIfUnlocked: boolean }) {
    const current = getValues();
    const priceUsdLocked = current.priceUsd.trim() !== "";
    const usdjpyLocked = current.usdjpy.trim() !== "";

    const result = await previewConversion({
      executedAt: current.executedAt,
      txType: current.txType,
      baseSymbol: current.baseSymbol,
      baseQty: current.baseQty,
      quoteSymbol: needsQuote ? current.quoteSymbol : null,
      quoteQty: needsQuote ? current.quoteQty : null,
      priceUsd: priceUsdLocked ? current.priceUsd : null,
      usdjpy: usdjpyLocked ? current.usdjpy : null,
    });

    setPreview(result);
    if (result.status === "ok") {
      if (opts.writeBackIfUnlocked && !priceUsdLocked) setValue("priceUsd", result.priceUsd);
      if (opts.writeBackIfUnlocked && !usdjpyLocked) setValue("usdjpy", result.usdjpy);
      if (mode === "create") setValue("jpyValue", result.jpyValue);
      setValue("priceSource", result.priceSource);
    }
    return result;
  }

  async function handleRefetch() {
    const current = getValues();
    const result = await previewConversion({
      executedAt: current.executedAt,
      txType: current.txType,
      baseSymbol: current.baseSymbol,
      baseQty: current.baseQty,
      quoteSymbol: needsQuote ? current.quoteSymbol : null,
      quoteQty: needsQuote ? current.quoteQty : null,
      // 明示上書きは送らない = 常に参照テーブルから再取得する
    });
    setPreview(result);
    if (result.status === "ok") {
      setValue("priceUsd", result.priceUsd);
      setValue("usdjpy", result.usdjpy);
      setValue("jpyValue", result.jpyValue);
      setValue("priceSource", result.priceSource);
    }
  }

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    setFormError(null);
    startTransition(async () => {
      const payload = {
        executedAt: values.executedAt,
        txType: values.txType,
        baseSymbol: values.baseSymbol,
        baseQty: values.baseQty,
        quoteSymbol: needsQuote ? values.quoteSymbol : undefined,
        quoteQty: needsQuote ? values.quoteQty : undefined,
        priceUsd: values.priceUsd || undefined,
        usdjpy: values.usdjpy || undefined,
        feeSymbol: values.feeSymbol || undefined,
        feeQty: values.feeQty || undefined,
        venue: values.venue || undefined,
        txHash: values.txHash || undefined,
        memo: values.memo || undefined,
      };

      const result =
        mode === "create"
          ? await createTransaction(payload)
          : await updateTransaction(transactionId!, {
              ...payload,
              jpyValue: values.jpyValue,
              priceSource: values.priceSource || "manual",
            });

      if (!result.success) {
        setFormError(result.error ?? "登録に失敗しました");
        return;
      }
      router.push("/transactions");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6">
      {formError && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</div>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">日時 (JST)</label>
          <Controller
            control={control}
            name="executedAt"
            render={({ field }) => (
              <input
                type="datetime-local"
                step={1}
                value={field.value ? field.value.slice(0, 16) : ""}
                onChange={(e) => field.onChange(e.target.value ? `${e.target.value}:00+09:00` : "")}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            )}
          />
          {errors.executedAt && <p className="mt-1 text-xs text-red-600">{errors.executedAt.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium">取引種別</label>
          <select {...register("txType")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
            {TX_TYPES.map((t) => (
              <option key={t} value={t}>
                {TX_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">base 銘柄(増えた資産)</label>
          <Controller
            control={control}
            name="baseSymbol"
            render={({ field }) => (
              <AssetCombobox assets={assets} value={field.value} onChange={field.onChange} placeholder="例: BTC" />
            )}
          />
          {errors.baseSymbol && <p className="mt-1 text-xs text-red-600">{errors.baseSymbol.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium">base 数量</label>
          <input
            {...register("baseQty")}
            inputMode="decimal"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          {errors.baseQty && <p className="mt-1 text-xs text-red-600">{errors.baseQty.message}</p>}
        </div>
      </div>

      {needsQuote && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">quote 銘柄(減った資産)</label>
            <Controller
              control={control}
              name="quoteSymbol"
              render={({ field }) => (
                <AssetCombobox assets={assets} value={field.value} onChange={field.onChange} placeholder="例: JPY" />
              )}
            />
            {errors.quoteSymbol && <p className="mt-1 text-xs text-red-600">{errors.quoteSymbol.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium">quote 数量</label>
            <input
              {...register("quoteQty")}
              inputMode="decimal"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            {errors.quoteQty && <p className="mt-1 text-xs text-red-600">{errors.quoteQty.message}</p>}
          </div>
        </div>
      )}

      <fieldset className="rounded border border-gray-200 p-3">
        <legend className="px-1 text-sm font-medium text-gray-600">
          円換算(空欄は自動補完 {mode === "edit" && "・「再取得」で参照テーブルから再計算"})
        </legend>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">price_usd</label>
            <input
              {...register("priceUsd")}
              inputMode="decimal"
              placeholder="自動補完"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">usdjpy (TTM)</label>
            <input
              {...register("usdjpy")}
              inputMode="decimal"
              placeholder="自動補完"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">jpy_value(円換算額)</label>
            <input
              {...register("jpyValue")}
              inputMode="decimal"
              readOnly={mode === "create"}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm read-only:bg-gray-100"
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-sm">
          {preview.status === "ok" && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
              source: {PRICE_SOURCE_LABELS[preview.priceSource] ?? preview.priceSource}
            </span>
          )}
          {preview.status === "ok" && preview.warning && <span className="text-xs text-amber-700">⚠ {preview.warning}</span>}
          {preview.status === "error" && <span className="text-xs text-red-600">{preview.reason}</span>}
          {mode === "edit" && (
            <button
              type="button"
              onClick={() => void handleRefetch()}
              className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              参照テーブルから価格を再取得
            </button>
          )}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">fee 銘柄(任意)</label>
          <Controller
            control={control}
            name="feeSymbol"
            render={({ field }) => <AssetCombobox assets={assets} value={field.value} onChange={field.onChange} placeholder="任意" />}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">fee 数量(任意)</label>
          <input
            {...register("feeQty")}
            inputMode="decimal"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          {errors.feeQty && <p className="mt-1 text-xs text-red-600">{errors.feeQty.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium">venue</label>
          <input {...register("venue")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">tx_hash</label>
          <input {...register("txHash")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium">memo</label>
          <input {...register("memo")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "保存中..." : mode === "create" ? "登録" : "保存"}
        </button>
      </div>
    </form>
  );
}
