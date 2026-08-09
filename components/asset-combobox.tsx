"use client";

import { useId } from "react";

export interface AssetOption {
  symbol: string;
  name?: string | null;
}

interface AssetComboboxProps {
  assets: AssetOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

/** §5.1: 銘柄はassetsマスタからのcombobox(symbol検索可)。装飾は最小限、ネイティブdatalistで実装。 */
export function AssetCombobox({ assets, value, onChange, placeholder, id, disabled }: AssetComboboxProps) {
  const listId = useId();
  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={placeholder ?? "銘柄"}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm uppercase disabled:bg-gray-100"
      />
      <datalist id={listId}>
        {assets.map((a) => (
          <option key={a.symbol} value={a.symbol}>
            {a.name ? `${a.symbol} - ${a.name}` : a.symbol}
          </option>
        ))}
      </datalist>
    </>
  );
}
