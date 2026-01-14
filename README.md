# 在席確認表 - 開発者向けドキュメント

## プロジェクト構成

```
webapp/
├── index.html                    # メインHTML（タイトル・CSP設定含む）
├── config.js                     # 環境設定（エンドポイント・ポーリング間隔）
├── main.js                       # アプリケーション起動処理
├── styles.css                    # スタイル定義
├── js/
│   ├── globals.js               # グローバル変数・要素参照・長期休暇状態管理
│   ├── utils.js                 # ユーティリティ関数
│   ├── layout.js                # レイアウト制御
│   ├── filters.js               # 検索・絞り込み機能
│   ├── board.js                 # 画面描画・入力制御
│   ├── vacations.js             # 長期休暇ガントチャート制御
│   ├── notices.js               # お知らせ機能
│   ├── offices.js               # 拠点管理
│   ├── auth.js                  # 認証処理
│   ├── sync.js                  # メニュー設定・データ同期
│   └── admin.js                 # 管理パネル機能（お知らせ・長期休暇管理含む）
├── CloudflareWorkers_worker.js  # Cloudflare Workerコード
├── GAS_コード.gs                # Google Apps Scriptメインコード
├── GAS_admin_super.gs           # GAS管理者用スクリプト
├── USER_MANUAL.md               # ユーザー向け詳細マニュアル
├── ADMIN_MANUAL.md              # 管理者向け詳細マニュアル
└── README.md                    # 開発者向けドキュメント（このファイル）
```

**補足**: `rg "serviceWorker"` を `index.html` と `main.js` を含む全体で実行し、Service Worker の登録コードが存在しないことを確認済みです（オフラインキャッシュは未使用）。

## 開発環境 → 本番環境への切り替え手順

本番環境へデプロイする際は、以下の項目を**必ず全て**変更してください。

### 1. Cloudflare Worker のデプロイと設定

#### 1-1. Worker のデプロイ
```bash
# Cloudflare Workers のプロジェクトをデプロイ
npx wrangler deploy
```

#### 1-2. Worker名の変更（-test → -prod）
- Cloudflare ダッシュボードで Worker名を変更
  - 開発: `presence-proxy-test`
  - 本番: `presence-proxy` または `presence-proxy-prod`

#### 1-3. 環境変数 `GAS_ENDPOINT` の設定
Cloudflare Workers の環境変数に GAS のウェブアプリURL を設定：

```bash
# wrangler CLI で設定
npx wrangler secret put GAS_ENDPOINT
# または Cloudflare ダッシュボードから設定
```

**重要**: GAS のウェブアプリをデプロイして取得したURLを設定してください。  
例: `https://script.google.com/macros/s/[デプロイID]/exec`

参考: `CloudflareWorkers_worker.js` 7行目のデフォルトURL

### 2. `config.js` の変更

**ファイル**: `config.js`

```javascript
// 変更前（開発環境）
const REMOTE_ENDPOINT = "https://presence-proxy-test.taka-hiyo.workers.dev";

// 変更後（本番環境）
const REMOTE_ENDPOINT = "https://presence-proxy.taka-hiyo.workers.dev";
// または
const REMOTE_ENDPOINT = "https://presence-proxy-prod.taka-hiyo.workers.dev";
```

**検索キーワード**: `const REMOTE_ENDPOINT`

### 3. `index.html` の変更（2箇所）

**ファイル**: `index.html`

#### 3-1. CSP (Content Security Policy) の変更

**行番号**: 17行目付近  
**検索キーワード**: `connect-src`

```html
<!-- 変更前（開発環境） -->
connect-src 'self' https://presence-proxy-test.taka-hiyo.workers.dev;

<!-- 変更後（本番環境） -->
connect-src 'self' https://presence-proxy.taka-hiyo.workers.dev;
```

#### 3-2. タイトル・表示文言の変更（4箇所）

**検索キーワード**: `在席確認表【開発用】`

| 行番号 | 場所 | 変更内容 |
|--------|------|----------|
| 6行目 | `<title>` タグ | `在席確認表【開発用】` → `在席確認表` |
| 27行目 | ヘッダーボタン初期値 | `在席確認表【開発用】` → `在席確認表` |
| 100行目 | マニュアル内の見出し | `在席確認表【開発用】` → `在席確認表` |
| 128行目 | ログイン画面の見出し | `在席確認表【開発用】` → `在席確認表` |

**注意**: `main.js` 内（24行目・72行目）でタイトルが動的に上書きされるため、実行時は拠点名が反映されます。

### 4. GAS (Google Apps Script) のデプロイ

#### 5-1. GAS プロジェクトへのコード配置
1. Google Apps Script プロジェクトを作成
2. `GAS_コード.gs` の内容をコピー＆ペースト
3. 管理者機能が必要な場合は `GAS_admin_super.gs` も追加

#### 5-2. ウェブアプリとしてデプロイ
1. GAS エディタで「デプロイ」→「新しいデプロイ」
2. デプロイタイプ: 「ウェブアプリ」を選択
3. 実行ユーザー: 自分
4. アクセス権限: 「全員」
5. デプロイ → **ウェブアプリURL をコピー**

#### 5-3. デプロイURLの反映
取得したウェブアプリURLを以下に設定：
- **Cloudflare Workers の環境変数** `GAS_ENDPOINT`（必須）
- `CloudflareWorkers_worker.js` 7行目のデフォルト値（任意・フォールバック用）

#### 5-4. 拠点一覧 (Script Properties) の初期化
新規デプロイ直後は Script Properties に拠点一覧が未設定のため、ログイン画面に拠点が表示されません。運用する拠点のみを登録するため、初回に Apps Script で `setOffices_` を実行してください。

1. Apps Script エディタで `GAS_コード.gs` を開く
2. 上部の「実行」ドロップダウンから `setOffices_` を選択し、初回実行を許可する
3. 実行ダイアログの引数に以下のようなオブジェクトを設定して再実行

```javascript
// 例: 本番で使う拠点だけを登録する
setOffices_({
  tokyo: { name: '東京', password: '***', adminPassword: '***' },
  nagoya:{ name: '名古屋', password: '***', adminPassword: '***' }
});
```

> 既に Script Properties に拠点が存在する場合は `getOffices_()` を実行して内容を確認し、必要な場合のみ `setOffices_` で上書きしてください。

### 5. GitHub Pages へのデプロイ

#### 5-1. リポジトリ設定
```bash
# 変更をコミット
git add .
git commit -m "chore: 本番環境用に設定を変更"
git push origin main
```

#### 5-2. GitHub Pages 設定
1. GitHub リポジトリの Settings → Pages
2. Source: `main` ブランチの `/` (root) または `/docs` を選択
3. Save

#### 5-3. カスタムドメインの設定（任意）
- Settings → Pages → Custom domain で設定
- 必要に応じて `index.html` の CSP を追加更新

## 環境別設定ファイルの管理（推奨）

複数環境を管理する場合、設定ファイルを分けて管理することを推奨します。

```bash
# 設定ファイルを環境別に作成
cp config.js config.dev.js
cp config.js config.prod.js

# 環境に応じて切り替え
# 開発環境
cp config.dev.js config.js

# 本番環境
cp config.prod.js config.js
```

**注意**: `config.dev.js` と `config.prod.js` は `.gitignore` に追加するか、別途管理してください。

## 変更チェックリスト

本番デプロイ前に以下を確認してください：

- [ ] **GAS**: ウェブアプリとしてデプロイ済み、URLを取得
- [ ] **Cloudflare Worker**: 環境変数 `GAS_ENDPOINT` に GAS の URL を設定
- [ ] **Cloudflare Worker**: Worker 名を `-test` から `-prod` に変更
- [ ] **config.js**: `REMOTE_ENDPOINT` を本番 Worker URL に変更
- [ ] **index.html**: CSP の `connect-src` を本番 Worker URL に変更
- [ ] **index.html**: タイトル「在席確認表【開発用】」→「在席確認表」に変更（4箇所）
- [ ] **GitHub Pages**: デプロイ設定完了、URL確認
- [ ] **動作確認**: 本番環境でログイン・データ更新・同期をテスト

### デプロイ後のブラウザキャッシュクリア手順

デプロイ後に古いキャッシュが残る場合は、以下を周知してください（Service Worker は未登録ですが、ブラウザキャッシュが残る可能性があります）。

1. ブラウザでページを開いた状態で、ハードリロード（Windows: Ctrl+Shift+R / macOS: Cmd+Shift+R）を実行
2. それでも更新されない場合は、ブラウザの設定から「閲覧データの削除（キャッシュ）」を実行

## 開発・デバッグ

### ローカル開発サーバー

```bash
# Python 3 の場合
python3 -m http.server 8000

# Node.js の場合
npx http-server -p 8000
```

ブラウザで `http://localhost:8000` にアクセス

### ブラウザキャッシュのクリア

開発中に古いキャッシュが残る場合：
1. ブラウザの開発者ツール（F12）を開く
2. Application → Service Workers → Unregister
3. Application → Storage → Clear site data
4. ページをリロード（Ctrl+Shift+R / Cmd+Shift+R）

### デバッグログ

`js/utils.js` の `diagAdd()` 関数がデバッグログを画面下部に出力します。  
本番環境では必要に応じて無効化を検討してください。

## 主要機能

### 1. 在席管理
- メンバーごとの業務時間、ステータス、戻り時間、備考を管理
- リアルタイム同期（約10秒ごと）
- 入力中の競合回避機能

### 2. お知らせ機能
- 管理者が拠点メンバー全員に通知を配信
- 折りたたみ/展開切り替え可能
- 約30秒ごとに自動更新
- 最大20件まで登録可能

### 3. 長期休暇管理（NEW）
- GW、年末年始、夏季休暇などの複数日休暇を管理
- ガントチャート形式で視覚的に設定
- メンバーごと・日付ごとに休暇を指定可能
- ユーザーが選択して表示、該当メンバーをハイライト
- 表示/非表示の切り替え機能

### 4. 管理機能
- CSV入出力（名簿の一括更新）
- 拠点名・パスワード変更
- メニュー設定（ステータス、業務時間候補など）
- お知らせ管理
- 長期休暇管理

## データ構造

### メニュー設定 (`MENUS`)

管理パネルから JSON で編集可能：

```json
{
  "statuses": [
    { "value": "在席", "class": "st-here", "clearOnSet": true },
    { "value": "外出", "requireTime": true, "class": "st-out" },
    { "value": "会議", "requireTime": true, "class": "st-meeting" },
    { "value": "テレワーク", "class": "st-remote", "clearOnSet": true },
    { "value": "休み", "class": "st-off", "clearOnSet": true }
  ],
  "noteOptions": ["直出", "直帰", "直出・直帰"],
  "businessHours": [
    "07:00-15:30",
    "07:30-16:00",
    "08:00-16:30",
    "08:30-17:00",
    "09:00-17:30",
    "09:30-18:00",
    "10:00-18:30",
    "10:30-19:00",
    "11:00-19:30",
    "11:30-20:00",
    "12:00-20:30"
  ],
  "timeStepMinutes": 30
}
```

**注意**: 業務時間の空白時プレースホルダーは `js/board.js` で `'09:00-17:30'` に固定されています。

### CSV フォーマット

**エクスポート・インポート共通**:
```
グループ番号,グループ名,表示順,id,氏名,内線,業務時間,ステータス,戻り時間,備考
```

### 長期休暇データ構造

長期休暇データは GAS の ScriptProperties に JSON 形式で保存されます：

```json
{
  "id": "vacation_001",
  "title": "GW期間休暇",
  "startDate": "2024-04-27",
  "endDate": "2024-05-06",
  "note": "10連休です",
  "office": "tokyo",
  "visible": true,
  "membersBits": "2024-04-27:100101010;2024-04-28:100101010;..."
}
```

**membersBits形式**：
- セミコロン`;`で日付ごとに区切り
- 各部分は `日付:ビット文字列` の形式
- ビット文字列は各メンバーの休暇状態を `0`（休暇なし）または `1`（休暇）で表現
- メンバーの順序はグループ・表示順に従う

## トラブルシューティング

### 「通信エラー」が表示される

1. `config.js` の `REMOTE_ENDPOINT` が正しいか確認
2. `index.html` の CSP `connect-src` に Worker URL が含まれているか確認
3. Cloudflare Worker が正常に動作しているか確認
4. Worker の環境変数 `GAS_ENDPOINT` が正しい GAS URL か確認

### GAS のウェブアプリ URL を変更した場合

1. Cloudflare Workers の環境変数 `GAS_ENDPOINT` を新しい URL に更新
2. Worker を再デプロイまたは再起動
3. キャッシュをクリアしてテスト

### 画面更新が反映されない

Service Worker は導入していないため、ブラウザキャッシュが原因の可能性があります。以下を試してください。

1. ハードリロード（Windows: Ctrl+Shift+R / macOS: Cmd+Shift+R）
2. ブラウザ設定からキャッシュを削除し、再読み込み

### 「拠点またはパスワードが違います」エラー

1. GAS でスクリプトプロパティが正しく設定されているか確認
2. 拠点ID・パスワードが正しいか確認
3. GAS のログを確認（Apps Script エディタの実行ログ）

## セキュリティに関する注意事項

- **CORS設定**: Cloudflare Worker の `ALLOW_ORIGINS` を適切に設定
- **CSP設定**: `index.html` の CSP を必要最小限に制限
- **パスワード管理**: GAS のスクリプトプロパティで管理（平文保存のため強力なパスワードを使用）
- **認証トークン**: セッションストレージに保存、有効期限は1時間（デフォルト）

## 技術的な補足

### 長期休暇機能の実装詳細

#### フロントエンド
- **js/vacations.js**: ガントチャートの描画とビット文字列の管理
  - `createVacationGantt()`: ガントチャートコントローラーの生成
  - ドラッグ&ドロップによる複数セル選択
  - 祝日API連携（オプション）
  
- **js/globals.js**: 長期休暇の状態管理
  - `loadLongVacations()`: 長期休暇データの取得
  - `applyLongVacationHighlight()`: メイン画面へのハイライト適用
  - `autoApplySavedLongVacation()`: 保存された選択の自動復元

- **js/admin.js**: 管理パネルの長期休暇タブ
  - CRUD操作（作成・読み込み・更新・削除）
  - 表示/非表示の切り替え

#### バックエンド (GAS)
- **GAS_コード.gs**: 長期休暇API
  - `getVacation`: 拠点の長期休暇一覧取得
  - `setVacation`: 長期休暇の作成・更新
  - `deleteVacation`: 長期休暇の削除
  - データは ScriptProperties に JSON 配列として保存

#### データフロー
1. 管理者が長期休暇を作成 → GAS に保存
2. ユーザーがログイン → 長期休暇一覧を取得（visible=true のみ）
3. ユーザーが長期休暇を選択 → 今日の日付のビットを解析
4. 該当メンバーの行にハイライトを適用 → ステータス欄に休暇名表示

### お知らせ機能の実装詳細

#### フロントエンド
- **js/notices.js**: お知らせ機能全般
  - `renderNotices()`: お知らせの描画
  - `toggleNoticesArea()`: 折りたたみ/展開
  - `fetchNotices()`: サーバーからの取得（30秒ごとのポーリング）
  - `saveNotices()`: 管理者による保存

#### バックエンド (GAS)
- **GAS_コード.gs**: お知らせAPI
  - `getNotices`: 拠点のお知らせ一覧取得
  - `setNotices`: お知らせの保存（最大20件）
  - データは ScriptProperties に JSON 配列として保存

### 認証・セッション管理

- トークンベース認証（有効期限1時間）
- ロール: `user`, `officeAdmin`, `superAdmin`
- セッションストレージにトークンを保存
- 自動更新機能でトークンを延長

### 同期・競合制御

- 行ごとにデバウンス（約1秒）して送信
- 入力中・変換中のフィールドは更新を保留
- サーバー側で rev（リビジョン番号）を管理
- 競合時はサーバー値を優先

## ライセンス・サポート

このプロジェクトは開発者による内部利用を想定しています。  
商用利用する場合は、適切なライセンスを設定してください。
