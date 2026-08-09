import { config } from "dotenv";

// Next.js と同じ優先順位で読み込む(.env.local を優先し、.env で不足分を補う)。
// tsx 経由でスクリプトを直接実行する場合(Next.jsの自動env読込を経由しない場合)に使う。
config({ path: ".env.local" });
config();
