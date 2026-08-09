# 暗号資産 税務台帳アプリ 実装SPEC

- プロジェクト名: `crypto-tax-ledger`
- バージョン: v1.0 (2026-08-09)
- 実装者: Claude Code
- 利用者: 単一ユーザー(本人)の個人用ツール

---

## 0. 背景と目的

2026年分の暗号資産損益(想定 $20K 規模)の確定申告(2027年3月)に向け、取引記録・円換算・総平均法計算を一元管理する Web アプリを構築する。

- 対象資産: BTC / ETH / PAXG / SOL を初期対象とし、マスタ追加で拡張可能にする(HYPE、USDC、BASIS 等)
- 税制前提(2026年分): 雑所得・総合課税。評価方法は**総平均法**(法定評価方法。移動平均法は本アプリのスコープ外)
- 暗号資産同士の swap も**譲渡=課税イベント**として扱う
- ステーキング報酬・DRR 等の報酬は**受取時の時価で所得認識**し、同額が取得原価になる

### スコープ外 (実装しないこと)

- venue 別(取引所/DEX別)CSV の自動変換 — 変換は外部(Claude)で行い、本アプリは**正規CSVのみ**を受け付ける
- 取引所 API 連携・オンチェーン自動取得
- 移動平均法、2028年以降の分離課税対応、税額そのものの計算
- 複数ユーザー対応

---

## 1. 技術スタック

| 項目 | 採用技術 |
|---|---|
| フレームワーク | Next.js (App Router) + TypeScript (`strict: true`) |
| ホスティング | Vercel (Hobby プラン想定。Cron は日次2本まで) |
| DB | Neon Postgres |
| DB アクセス | Drizzle ORM + drizzle-kit (migration) + `@neondatabase/serverless` (HTTP ドライバ) |
| バリデーション | Zod (クライアント/サーバで同一スキーマを共用) |
| フォーム | react-hook-form |
| CSV パース | Papa Parse |
| 数値演算 | decimal.js — **数量・金額の演算に JS の number を直接使うことを禁止**。Drizzle の numeric は string モードで受け渡す |
| 日時 | date-fns + date-fns-tz (タイムゾーン変換は `Asia/Tokyo` / `UTC` のみ) |
| 文字コード | iconv-lite (みずほ CSV の Shift_JIS デコード用) |
| UI | Tailwind CSS。装飾は最小限でよい(個人用ツール) |

---

## 2. 重要な規約(全機能共通のコンベンション)

実装全体で以下を厳守すること。**どの基準を採るかより、一貫していることが税務上の説明力になる。**

1. **日次終値は UTC 締め**。`daily_prices.price_date` = その UTC 日の終値
2. **為替はみずほ TTM(仲値)**。`fx_rates.rate_date` は JST 営業日。土日祝は**直前営業日のレートを参照**(前方フィル)
3. **参照キーの決定**
   - 価格参照日: `price_date = date(executed_at AT TIME ZONE 'UTC')`
   - 為替参照日: `rate_date = date(executed_at AT TIME ZONE 'Asia/Tokyo')` から `<=` で直前レコードを1件取得
4. **税務年度の帰属**: `executed_at` を `Asia/Tokyo` に変換した暦年
5. **日付しか分からないデータ(DRR 日次報酬等)は `12:00+09:00` を付与**して記録する。正午 JST = 03:00 UTC なので、UTC/JST どちらの暦日も一致し、価格・為替の参照日がズレない
6. **取引方向の規約**: `base` = 増えた資産、`quote` = 減った資産(「SOL を売って USDC を得た」は base=USDC, quote=SOL)。例外は `tx_type='fee'` のみ(後述)
7. **`price_usd` は base 資産 1 単位あたりの USD 時価**
8. **スナップショット原則**: `transactions.price_usd / usdjpy / jpy_value` は登録時に確定した値であり、参照テーブルを後から再取得しても**自動では再計算しない**(過去の申告値がブレない監査性のため)。再計算はユーザーが編集画面で明示的にボタンを押した場合のみ
9. **円換算額の端数は四捨五入で小数2位**(表示は円単位に四捨五入)。この丸め方を全箇所で統一する

---

## 3. データモデル

Drizzle スキーマとして実装し、migration は drizzle-kit で管理する。以下は等価な DDL。

```sql
-- 資産マスタ
CREATE TABLE assets (
  id           SERIAL PRIMARY KEY,
  symbol       TEXT UNIQUE NOT NULL,          -- 'BTC','ETH','PAXG','SOL','USDC','JPY'...
  name         TEXT,
  asset_class  TEXT NOT NULL DEFAULT 'crypto' -- 'crypto' | 'stable' | 'fiat'
               CHECK (asset_class IN ('crypto','stable','fiat')),
  cc_symbol    TEXT,                          -- CryptoCompare のシンボル。NULL なら価格自動取得対象外
  binance_pair TEXT,                          -- 予備(v1では未使用)
  track_price  BOOLEAN NOT NULL DEFAULT true, -- 日次価格 cron の取得対象か
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 日次終値(USD建て・UTC締め)
CREATE TABLE daily_prices (
  asset_id   INT  NOT NULL REFERENCES assets(id),
  price_date DATE NOT NULL,
  close_usd  NUMERIC(20,8) NOT NULL,
  source     TEXT NOT NULL,                   -- 'cryptocompare' 等
  fetched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (asset_id, price_date)
);

-- USDJPY(みずほ TTM)
CREATE TABLE fx_rates (
  rate_date DATE PRIMARY KEY,
  ttm  NUMERIC(10,4) NOT NULL,
  ttb  NUMERIC(10,4),                         -- v1 では NULL のまま
  tts  NUMERIC(10,4),                         -- v1 では NULL のまま
  source TEXT NOT NULL DEFAULT 'mizuho'
);

-- インポートバッチ
CREATE TABLE import_batches (
  id         BIGSERIAL PRIMARY KEY,
  filename   TEXT,
  row_count  INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 取引台帳(コア)
CREATE TABLE transactions (
  id             BIGSERIAL PRIMARY KEY,
  executed_at    TIMESTAMPTZ NOT NULL,
  tx_type        TEXT NOT NULL
                 CHECK (tx_type IN ('buy','sell','swap','reward','fee','transfer_in','transfer_out')),
  base_asset_id  INT NOT NULL REFERENCES assets(id),
  base_qty       NUMERIC(30,12) NOT NULL CHECK (base_qty > 0),
  quote_asset_id INT REFERENCES assets(id),
  quote_qty      NUMERIC(30,12) CHECK (quote_qty IS NULL OR quote_qty > 0),
  price_usd      NUMERIC(20,8),               -- base 資産 1 単位の USD 時価
  usdjpy         NUMERIC(10,4),               -- 適用した TTM
  jpy_value      NUMERIC(20,2),               -- 取引の円換算総額(スナップショット)
  price_source   TEXT,                        -- 'manual' | 'derived' | 'daily_close' | 'daily_close_prev'
  fee_asset_id   INT REFERENCES assets(id),
  fee_qty        NUMERIC(30,12),
  venue          TEXT,                        -- 'KAST','BASIS','CowSwap'...
  tx_hash        TEXT,
  memo           TEXT,
  import_batch_id BIGINT REFERENCES import_batches(id), -- 手入力は NULL
  row_hash       TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uniq_tx_row_hash ON transactions (row_hash) WHERE row_hash IS NOT NULL;
CREATE INDEX idx_tx_asset_time ON transactions (base_asset_id, executed_at);
CREATE INDEX idx_tx_time ON transactions (executed_at);
```

### 3.1 tx_type の意味論

| tx_type | base(増) | quote(減) | 税務上の展開 |
|---|---|---|---|
| `buy` | 取得した暗号資産 | 支払った法定通貨/ステーブル | quote の譲渡 + base の取得 (quote=JPY のときは譲渡イベントなし) |
| `sell` | 受け取った法定通貨/ステーブル | 売却した暗号資産 | 同上 |
| `swap` | 受取資産 | 支払資産 | quote の譲渡 + base の取得 |
| `reward` | 受け取った報酬資産 | (なし) | base の取得 + **同額を報酬所得に計上** |
| `fee` | **例外: 支払った資産**(単独ガス代等) | (なし) | base の時価譲渡 + 同額を必要経費に計上 |
| `transfer_in` / `transfer_out` | 移動した資産 | (なし) | **数量・原価計算に不参加**(自己ウォレット間移動の監査記録)。`fee_qty` があればそれのみ fee と同様に展開 |

buy / sell / swap は計算エンジン上は同一処理(交換)であり、区別は入力 UI とレポート表示の可読性のためにある。

### 3.2 row_hash(冪等性キー)

重複登録防止のため、以下の正規化文字列の SHA-256 を `row_hash` に格納する。手入力・CSV とも同一ロジックで付与し、INSERT は `ON CONFLICT (row_hash) DO NOTHING` とする。

```
iso_utc_seconds(executed_at) | tx_type | upper(base_symbol) | norm(base_qty) |
upper(quote_symbol or '') | norm(quote_qty or '') | upper(venue or '') | lower(tx_hash or '')
```

- `norm(数値)`: 前後空白除去、指数表記禁止、末尾ゼロと末尾小数点を除去した10進文字列("10.500"→"10.5"、"10.0"→"10")
- **price_usd / usdjpy / jpy_value はハッシュに含めない**(補完値の差で重複判定が壊れないようにするため)
- 行の編集時は row_hash を再計算して更新する

### 3.3 シードデータ

migration 後に投入する初期マスタ:

| symbol | asset_class | cc_symbol | track_price |
|---|---|---|---|
| BTC | crypto | BTC | true |
| ETH | crypto | ETH | true |
| PAXG | crypto | PAXG | true |
| SOL | crypto | SOL | true |
| USDC | stable | USDC | false |
| USDT | stable | USDT | false |
| JPY | fiat | (NULL) | false |

---

## 4. 円換算・価格補完ロジック (`lib/pricing/`)

手入力・CSV 取り込みの両方から呼ばれる共通関数として実装する。

### 4.1 price_usd の決定順位

1. 入力/CSV で明示指定があればそれを使う → `price_source='manual'`
2. quote 資産が `stable`(USDC/USDT 等)なら `quote_qty ÷ base_qty` で導出 → `'derived'`(実約定価格として最も正確)
3. `daily_prices` の該当 UTC 日の終値 → `'daily_close'`
4. 該当日がなければ**最大3日**遡って直近終値を使い、警告を付す → `'daily_close_prev'`
5. それでも取れない(cc_symbol が NULL の資産等)場合はエラー: 「price_usd を明示指定してください」

補足: `asset_class='stable'` の資産自身が base のときは price_usd=1.0 とみなしてよい。

### 4.2 usdjpy の決定

1. 明示指定があればそれ
2. `fx_rates` から `rate_date <= JST日付` の直近1件(前方フィル。遡り制限なし)

### 4.3 jpy_value の算出

- `quote_symbol = 'JPY'` の場合: `jpy_value = quote_qty`(国内での円建て購入。price_usd は `jpy_value ÷ usdjpy ÷ base_qty` で逆算して保存)
- それ以外: `jpy_value = base_qty × price_usd × usdjpy`(小数2位、四捨五入)

### 4.4 手数料の円換算

`fee_qty × (fee資産の daily_close または stable=1.0) × 行の usdjpy`。fee 資産の価格が取れない場合は取り込み時に警告し、経費計算から除外(数量減のみ反映)。

---

## 5. 機能仕様

### 5.1 手入力フォーム `/transactions/new`

- react-hook-form + Zod。**同一の Zod スキーマを Server Action 側でも再検証**してから INSERT
- `tx_type` に応じたフィールド出し分け: reward/transfer は quote 系を非表示、buy/sell/swap は quote 必須、fee は base のみ
- 銘柄は assets マスタからの combobox(symbol 検索可)
- **UX 要件**: `executed_at` と銘柄を入力した時点で §4 のロジックにより price_usd / usdjpy をプリフィル(編集可)し、円換算額をリアルタイムでプレビュー表示する
- row_hash 衝突時は「同一取引が登録済みです(ID: xx)」と表示して登録しない

### 5.2 正規CSV一括登録 `/import`

#### 正規CSVフォーマット(13列・ヘッダ行必須・UTF-8、BOM許容)

```csv
executed_at,tx_type,base_symbol,base_qty,quote_symbol,quote_qty,price_usd,usdjpy,fee_symbol,fee_qty,venue,tx_hash,memo
2026-05-28T09:30:00+09:00,swap,PAXG,0.5,BTC,0.015,,,BTC,0.0001,CowSwap,0xabc...,BTC→PAXG入替
2026-08-01T12:00:00+09:00,reward,BASIS,12.34,,,,,,,BASIS,,DRR日次報酬
2026-03-10T21:00:00+09:00,buy,SOL,10,USDC,1450,,,USDC,1.2,KAST,,
```

| 列 | 必須 | 仕様 |
|---|---|---|
| executed_at | ✔ | **タイムゾーンオフセット付き ISO 8601 必須**(`+09:00` / `Z`)。オフセットなしはエラー |
| tx_type | ✔ | §3.1 の enum |
| base_symbol / base_qty | ✔ | symbol は assets と突合。数値はカンマ・全角を除去して受理 |
| quote_symbol / quote_qty | 条件付 | buy/sell/swap で必須、それ以外は空 |
| price_usd / usdjpy | — | 空欄なら §4 で自動補完 |
| fee_symbol / fee_qty | — | 任意 |
| venue / tx_hash / memo | — | 任意テキスト |

#### 2段階フロー

1. **検証(dry-run)** — この段階では DB に一切書かない
   - アップロード(FormData → Server Action) → Papa Parse → 行ごとに Zod 検証 → symbol 解決 → §4 の補完実行
   - 未知 symbol はエラー行とし、「マスタに追加して再検証」ボタンを提供する
   - **暗黙単価チェック**: 各行の導出単価(derived または manual)と該当日の daily_close を比較し、**±20% を超える乖離は警告**として表示(桁誤り・日付ズレ・base/quote 取り違えの検出)。警告はブロックしない
   - プレビュー表: OK n 行 / 警告 m 行 / エラー k 行。各行に補完値と `price_source` バッジ、エラー理由と行番号を表示
   - row_hash を事前計算し、既存重複行は「スキップ予定」として表示
2. **確定** — `db.transaction()` で `import_batches` に 1 行 + `transactions` へ一括 INSERT(`ON CONFLICT DO NOTHING`)。結果として「登録 n 件・スキップ m 件」を返す

エラー行が 1 件でもあっても、OK 行のみの部分確定を選べるようにする(デフォルトは全行 OK 時のみ確定)。

#### バッチ管理 `/import/batches`

バッチ一覧(ファイル名・件数・日時)と「このバッチを取り消す」= `DELETE FROM transactions WHERE import_batch_id = X` を提供。確認ダイアログ必須。

### 5.3 取引一覧 `/transactions`

- フィルタ: 年(JST)・資産・venue・tx_type。executed_at 降順
- 表示時刻は JST。円換算額・price_source を表示
- 行の編集/削除。編集画面には「参照テーブルから価格を再取得」ボタンを置き、**押した場合のみ**再補完する(§2-8)

### 5.4 マスタ管理 `/assets`

assets の CRUD(symbol, name, asset_class, cc_symbol, track_price)。取引が存在する資産の削除は禁止。

### 5.5 ダッシュボード `/`

- **保有数量**(transactions からの集計):
  - `+base_qty`: buy / sell / swap / reward
  - `−quote_qty`: buy / sell / swap
  - `−base_qty`: fee
  - `−fee_qty`: fee_qty が入っている全行
  - transfer_in / transfer_out の base_qty は集計に**含めない**
- 評価額 = 保有数量 × 最新 daily_close × 最新 TTM(円・USD 併記)
- 当年(JST)の実現損益・報酬所得のサマリ(§6 のエンジンを流用)
- **データ鮮度バッジ**: daily_prices / fx_rates の最終取得日を表示し、2日以上古い場合は警告表示(cron 失敗の検知)

### 5.6 年次レポート `/reports/[year]`

§6 の計算結果を資産別テーブルで表示し、CSV エクスポートを提供する。列は §6.4 の通り。

---

## 6. 総平均法 計算仕様 (`lib/tax/average-cost.ts`)

### 6.1 イベント展開

JPY 以外の全資産(stable 含む)が計算対象。transactions を以下のイベントに展開する:

- **取得イベント** (数量, 取得価額JPY): base_asset に着目 — buy/sell/swap/reward の `(base_qty, jpy_value)`
- **譲渡イベント** (数量, 譲渡収入JPY): quote_asset に着目 — buy/sell/swap の `(quote_qty, jpy_value)`(quote=JPY を除く)
- **fee**: fee_asset(または tx_type='fee' の base)の `(qty, 時価円換算)` を譲渡イベントに追加し、**同額を必要経費**に計上
- **reward**: 取得イベントに加え、`jpy_value` を**報酬所得**に計上
- **transfer_in/out**: 展開しない(fee_qty を除く)

swap の両建て: 1 行の `jpy_value`(=base 側の時価円換算)が、quote 資産の譲渡収入と base 資産の取得価額の**両方**に使われる。

### 6.2 年次ロールフォワード

資産ごとに、最古の取引年から対象年まで JST 暦年で逐次計算する:

```
平均単価(年Y) = (期首残高の取得価額 + 年中取得価額合計) ÷ (期首数量 + 年中取得数量)
譲渡原価(年Y) = 平均単価 × 年中譲渡数量合計
実現損益(年Y) = 年中譲渡収入合計 − 譲渡原価
期末数量     = 期首数量 + 年中取得数量 − 年中譲渡数量
期末取得価額 = 平均単価 × 期末数量   ← 翌年の期首残高に繰り越す
```

取得も期首残高もない年に譲渡があればデータ不整合として警告(マイナス残高検知も同様)。

### 6.3 年間サマリ

```
雑所得(参考値) = Σ実現損益(全資産) + Σ報酬所得 − Σ必要経費(手数料)
```

### 6.4 レポート出力列(資産別)

symbol / 期首数量 / 期首取得価額 / 年中購入数量 / 年中購入金額 / 年中売却数量 / 年中売却金額 / 平均単価 / 譲渡原価 / 実現損益 / 期末数量 / 期末取得価額 / 報酬所得 / 手数料経費

※ 「購入数量・購入金額・売却数量・売却金額」の 4 値が国税庁「暗号資産の計算書(総平均法用)」への転記値。

### 6.5 検証用数値例(受け入れ基準に使用)

入力:

| executed_at (JST) | type | base | base_qty | quote | quote_qty | jpy_value |
|---|---|---|---|---|---|---|
| 2025-10-01 | buy | BTC | 0.10 | JPY | 1,000,000 | 1,000,000 |
| 2026-02-01 | buy | BTC | 0.10 | JPY | 1,400,000 | 1,400,000 |
| 2026-06-01 | swap | PAXG | 4.0 | BTC | 0.05 | 800,000 |

期待結果:

- 2025年 BTC: 取得 0.10 / ¥1,000,000。譲渡なし。期末 0.10 BTC / ¥1,000,000
- 2026年 BTC: 平均単価 = (1,000,000 + 1,400,000) ÷ (0.10 + 0.10) = **¥12,000,000/BTC**。譲渡 0.05 BTC、収入 ¥800,000、原価 ¥600,000 → **実現益 ¥200,000**。期末 0.15 BTC / ¥1,800,000
- 2026年 PAXG: 取得 4.0 / ¥800,000。譲渡なし

---

## 7. 外部データ取得

### 7.1 日次価格 — CryptoCompare

- `GET https://min-api.cryptocompare.com/data/v2/histoday?fsym={cc_symbol}&tsym=USD&limit={n}&api_key={KEY}`
- レスポンス `Data.Data[]` の `{time, close}` を使用。`time`(UTC 日境界の epoch)→ `price_date`、`close` → `close_usd`
- 対象: `track_price = true AND cc_symbol IS NOT NULL` の全資産

### 7.2 為替 — みずほ銀行ヒストリカルデータ

- `https://www.mizuhobank.co.jp/market/csv/quote.csv`(URL は定数化し変更に備える)
- **Shift_JIS** → iconv-lite でデコード。ヘッダ行から `USD` 列位置を動的に特定する(列位置ハードコード禁止)
- 日付列(`YYYY/M/D`)+ USD 列 = TTM。ttb/tts は NULL のまま
- 営業日のみ収録されている。土日祝の穴埋めは**しない**(参照側の前方フィルで解決。§4.2)

### 7.3 Cron ルート

```json
// vercel.json (schedule は UTC)
{
  "crons": [
    { "path": "/api/cron/daily-prices", "schedule": "15 0 * * *" },
    { "path": "/api/cron/fx-rates",     "schedule": "0 2 * * *" }
  ]
}
```

- 00:15 UTC(09:15 JST)に前日終値、02:00 UTC(11:00 JST)に当日 TTM を取得する配置
- 認証: `Authorization: Bearer ${CRON_SECRET}` を検証(Vercel Cron が自動付与)。不一致は 401
- **自己修復**: daily-prices は毎回**直近 7 日分**を、fx-rates は**直近 30 日分**を upsert(`ON CONFLICT ... DO UPDATE`)し、取りこぼしを自動回復する

### 7.4 バックフィルスクリプト `scripts/backfill.ts`

- ローカル実行: `npx tsx scripts/backfill.ts --from 2023-01-01`(`DATABASE_URL` を使用)
- 価格: 資産ごとに histoday を `limit` 計算して取得(2000 日/コールまで可、必要ならページング)
- 為替: quote.csv 全量をパースし `--from` 以降を upsert
- 実行結果(資産別件数・期間)を標準出力にサマリ表示

---

## 8. 認証

- `middleware.ts` で **Basic 認証**(env: `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`)。全ルートに適用
- 例外: `/api/cron/*` は Basic 認証から除外し、CRON_SECRET のみで保護

---

## 9. 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Neon 接続文字列 |
| `CRYPTOCOMPARE_API_KEY` | 価格 API |
| `CRON_SECRET` | Cron ルート認証 |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Basic 認証 |

`.env.example` を用意すること。

---

## 10. ディレクトリ構成(推奨)

```
app/
  page.tsx                        # ダッシュボード
  transactions/page.tsx           # 一覧
  transactions/new/page.tsx       # 手入力
  import/page.tsx                 # CSV取り込み(dry-run→確定)
  import/batches/page.tsx         # バッチ一覧・取消
  assets/page.tsx                 # マスタ管理
  reports/[year]/page.tsx         # 年次レポート
  api/cron/daily-prices/route.ts
  api/cron/fx-rates/route.ts
lib/
  db/{index.ts, schema.ts}
  validation/transaction.ts       # Zod スキーマ(共用)
  pricing/lookup.ts               # §4 補完ロジック
  tax/average-cost.ts             # §6 計算エンジン
  csv/{canonical.ts, parse.ts}    # 正規CSV定義・パース
  hash.ts                         # row_hash
middleware.ts
scripts/backfill.ts
drizzle/                          # migrations
vercel.json
```

---

## 11. 受け入れ基準

以下を自動テスト(最低限 §6 エンジンと §4 補完はユニットテスト)または手動確認で満たすこと:

1. §6.5 の数値例が期待結果と一致する(2025/2026 両年)
2. 同一 CSV を 2 回取り込むと、2 回目は登録 0 件・全件スキップになる
3. swap 1 行が quote 資産の譲渡と base 資産の取得の両方に反映される
4. 土曜日の executed_at に対する TTM が直前金曜のレートになる
5. `2026-08-01T12:00:00+09:00` の reward が price_date=2026-08-01(UTC)、rate_date=2026-08-01(JST) を参照する
6. 暗黙単価が終値から ±20% を超える行が dry-run で警告表示される(ブロックはされない)
7. quote.csv(Shift_JIS)が文字化けなくパースされ USD 列が取得できる
8. バッチ取消で該当バッチの行のみが削除される
9. `/api/cron/*` は Bearer 不一致で 401、その他ページは Basic 認証なしで 401
10. 当日取引(終値未確定)でも quote=USDC なら derived 価格で登録できる
11. executed_at にオフセットのない日時文字列はバリデーションエラーになる
12. 数量 `0.000000000001` の行で浮動小数点誤差が発生しない(decimal.js 経由)

---

## 12. 実装マイルストーン

この順に段階実装し、各段階で受け入れ基準の該当項目を確認してから次へ進むこと:

1. **M1**: プロジェクト雛形 + Drizzle スキーマ/migration + シード + Basic 認証 middleware
2. **M2**: §4 補完ロジック + §7 バックフィルスクリプト + Cron 2 本(基準 4, 5, 7, 9)
3. **M3**: 手入力フォーム + 取引一覧(基準 10, 11, 12)
4. **M4**: CSV 取り込み(dry-run → 確定)+ バッチ取消(基準 2, 6, 8)
5. **M5**: 総平均法エンジン + 年次レポート + CSV エクスポート(基準 1, 3)
6. **M6**: ダッシュボード + データ鮮度バッジ + 仕上げ
