# 在席確認表 (Whereabouts Board)

## 🤖 AI Development Guidelines (AI開発者向けガイドライン)

**本プロジェクトは AI Vibe Coding によって開発・運用されます。以下のアーキテクチャおよび制約を厳守してください。**

### 1. 技術スタックとインフラ (Technology Stack)
- **Code Management**: GitHub
- **Frontend Hosting**: **Cloudflare Pages** (NOT GitHub Pages)
- **Backend / API**: **Cloudflare Workers**
- **Database**: **Firebase Realtime Database** (via Cloudflare Workers)
  - ※ クライアント(Frontend)からFirebaseへ直接アクセスしてはいけません。必ずWorkersを経由します。
- **Language**: Vanilla JavaScript (ES6+), HTML5, CSS3

### 2. 禁止事項 (Constraints)
- **Google Apps Script (GAS) の使用禁止**: 旧バージョンのコードに含まれるGAS関連の記述やファイルは無視し、提案しないでください。
- **Frontendからの直接DB接続禁止**: APIキーの露出を防ぐため、DB操作は全て Cloudflare Workers 上の API を通じて行ってください。
- **複雑なビルドツールの回避**: 現状の Vanilla JS 構成を維持してください（必要最低限のバンドルは可）。
- **Service Worker の使用禁止**: オフラインキャッシュは未使用です。

---

## プロジェクト構成

```
.
├── webapp/                      # フロントエンド (Cloudflare Pagesデプロイ対象)
│   ├── index.html               # メインHTML（タイトル・CSP設定含む）
│   ├── config.js                # 環境設定（エンドポイント・ポーリング間隔）
│   ├── main.js                  # アプリケーション起動処理
│   ├── styles.css               # スタイル定義
│   └── js/
│       ├── globals.js           # グローバル変数・要素参照・長期休暇状態管理
│       ├── utils.js             # ユーティリティ関数
│       ├── layout.js            # レイアウト制御
│       ├── filters.js           # 検索・絞り込み機能
│       ├── board.js             # 画面描画・入力制御
│       ├── vacations.js         # 長期休暇ガントチャート制御
│       ├── notices.js           # お知らせ機能
│       ├── offices.js           # 拠点管理
│       ├── auth.js              # 認証処理
│       ├── sync.js              # メニュー設定・データ同期
│       └── admin.js             # 管理パネル機能（お知らせ・長期休暇管理含む）
├── workers/                     # バックエンド (Cloudflare Workers)
│   ├── src/
│   │   ├── index.js             # Worker エントリポイント
│   │   └── firebase.js          # Firebase接続ロジック
│   ├── wrangler.toml            # Workers設定
│   └── package.json             # 依存関係 (firebase-admin等)
├── USER_MANUAL.md               # ユーザー向け詳細マニュアル
├── ADMIN_MANUAL.md              # 管理者向け詳細マニュアル
└── README.md                    # 本ドキュメント（開発者向け）
```

**補足**: `rg "serviceWorker"` を `index.html` と `main.js` を含む全体で実行し、Service Worker の登録コードが存在しないことを確認済みです（オフラインキャッシュは未使用）。

---

## セットアップとデプロイ手順

### 1. Firebase プロジェクトの準備

1. Firebase Console で新規プロジェクトを作成
2. **Realtime Database** を作成し、ルールを設定（WorkersからのAdmin SDKアクセスを前提とするため、一旦ロックダウンでも可）
3. 「プロジェクトの設定」→「サービスアカウント」から **新しい秘密鍵の生成** を行い、JSONファイルをダウンロード
4. JSONの内容を Cloudflare Workers の環境変数（Secret）として設定します

### 2. Cloudflare Workers (Backend) の設定

Firebase との通信を担う API プロキシです。

#### 環境変数 (Secrets) の設定

`wrangler secret put` または Cloudflare ダッシュボードで以下を設定：

```bash
# Firebase Database URL
npx wrangler secret put FIREBASE_DB_URL

# Firebase Service Account (JSON文字列)
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

**設定値**:
- `FIREBASE_DB_URL`: Firebase Realtime Database の URL（例: `https://your-project.firebaseio.com`）
- `FIREBASE_SERVICE_ACCOUNT`: ダウンロードしたJSONの中身（文字列として保存）

#### Worker名の変更（開発 → 本番）
- 開発: `presence-proxy-test`
- 本番: `presence-proxy` または `presence-proxy-prod`

#### デプロイ

```bash
cd workers
npm install
npx wrangler deploy
```

### 3. Cloudflare Pages (Frontend) の設定

静的アセットを配信します。

1. Cloudflare ダッシュボードの「Pages」から「Gitに接続」を選択
2. 本リポジトリを選択
3. ビルド設定：
   - **フレームワーク プリセット**: なし (None)
   - **ビルドコマンド**: 空欄 (または必要なら `npm run build`)
   - **ビルド出力ディレクトリ**: `webapp` (index.htmlがあるディレクトリ)
4. 環境変数設定 (必要に応じて):
   - `API_ENDPOINT`: WorkersのURL (config.jsで読み込む想定の場合)

### 4. `config.js` の変更

**ファイル**: `webapp/config.js`

```javascript
// テスト環境（現在の設定）
const REMOTE_ENDPOINT = "https://presence-proxy-test.taka-hiyo.workers.dev";

// 本番環境へ切替する場合
const REMOTE_ENDPOINT = "https://presence-proxy.taka-hiyo.workers.dev";
// または
const REMOTE_ENDPOINT = "https://presence-proxy-prod.taka-hiyo.workers.dev";
```

**検索キーワード**: `const REMOTE_ENDPOINT`

### 5. `index.html` の変更（2箇所）

**ファイル**: `webapp/index.html`

#### 5-1. CSP (Content Security Policy) の変更

**行番号**: 17行目付近  
**検索キーワード**: `connect-src`

```html
<!-- テスト環境（現在の設定） -->
connect-src 'self' https://presence-proxy-test.taka-hiyo.workers.dev;

<!-- 本番環境へ切替する場合 -->
connect-src 'self' https://presence-proxy.taka-hiyo.workers.dev;
```

**注意**: `config.js` の `REMOTE_ENDPOINT` と同じ Worker URL が `connect-src` に含まれていることを確認してください。

#### 5-2. タイトル・表示文言の変更（4箇所）

**検索キーワード**: `在席確認表【開発用】`

| 行番号 | 場所 | 変更内容 |
|--------|------|----------|
| 6行目 | `<title>` タグ | `在席確認表【開発用】` → `在席確認表` |
| 27行目 | ヘッダーボタン初期値 | `在席確認表【開発用】` → `在席確認表` |
| 100行目 | マニュアル内の見出し | `在席確認表【開発用】` → `在席確認表` |
| 128行目 | ログイン画面の見出し | `在席確認表【開発用】` → `在席確認表` |

**注意**: `main.js` 内（24行目・72行目）でタイトルが動的に上書きされるため、実行時は拠点名が反映されます。

---

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

---

## 変更チェックリスト

本番デプロイ前に以下を確認してください：

### Firebase設定
- [ ] **Firebase**: プロジェクト作成、Realtime Database有効化
- [ ] **Firebase**: サービスアカウントJSONをダウンロード

### Cloudflare Workers設定
- [ ] **Cloudflare Worker**: 環境変数 `FIREBASE_DB_URL` を設定
- [ ] **Cloudflare Worker**: 環境変数 `FIREBASE_SERVICE_ACCOUNT` にJSONを設定
- [ ] **Cloudflare Worker**: Worker 名を `-test` から `-prod` に変更
- [ ] **Cloudflare Worker**: デプロイ完了、動作確認

### フロントエンド設定
- [ ] **config.js**: `REMOTE_ENDPOINT` を本番 Worker URL に変更
- [ ] **index.html**: CSP の `connect-src` を本番 Worker URL に変更
- [ ] **index.html**: タイトル「在席確認表【開発用】」→「在席確認表」に変更（4箇所）

### Cloudflare Pages設定
- [ ] **Cloudflare Pages**: リポジトリ接続完了
- [ ] **Cloudflare Pages**: ビルド出力ディレクトリを `webapp` に設定
- [ ] **Cloudflare Pages**: デプロイ完了、URL確認

### 動作確認
- [ ] **動作確認**: 本番環境でログイン・データ更新・同期をテスト
- [ ] **動作確認**: お知らせ機能のテスト
- [ ] **動作確認**: 長期休暇機能のテスト
- [ ] **動作確認**: 管理パネルのテスト

### デプロイ後のブラウザキャッシュクリア手順

デプロイ後に古いキャッシュが残る場合は、以下を周知してください（Service Worker は未登録ですが、ブラウザキャッシュが残る可能性があります）。

1. ブラウザでページを開いた状態で、ハードリロード（Windows: Ctrl+Shift+R / macOS: Cmd+Shift+R）を実行
2. それでも更新されない場合は、ブラウザの設定から「閲覧データの削除（キャッシュ）」を実行

---

## 開発・デバッグ

### ローカル開発サーバー

```bash
# Python 3 の場合
python3 -m http.server 8000

# Node.js の場合
npx http-server -p 8000
```

ブラウザで `http://localhost:8000` にアクセス

### Workers のローカルテスト

```bash
cd workers
npx wrangler dev
```

### ブラウザキャッシュのクリア

開発中に古いキャッシュが残る場合：
1. ブラウザの開発者ツール（F12）を開く
2. Application → Storage → Clear site data
3. ページをリロード（Ctrl+Shift+R / Cmd+Shift+R）

**注意**: Service Worker は使用していないため、Unregister は不要です。

### デバッグログ

`js/utils.js` の `diagAdd()` 関数がデバッグログを画面下部に出力します。  
本番環境では必要に応じて無効化を検討してください。

---

## 開発フロー (AI Vibe Coding)

AIアシスタントと共に開発を行う際は、以下の手順を推奨します。

1. **機能追加**: 「Firebaseの `users` ノードに新しいフィールドを追加したい」のようにデータ構造を含めて指示する
2. **API修正**: 「Frontendの `sync.js` から新しいパラメータを送信し、Workersで受け取ってFirebaseに保存する処理を書いて」と指示する
3. **リファクタリング**: 「`js/board.js` が肥大化したので、機能ごとに分割して」と指示する

---

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

### 3. 長期休暇管理
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

---

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

長期休暇データは Firebase Realtime Database に JSON 形式で保存されます：

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

---

## データフロー

### 基本フロー
* **Read**: Client → Workers → Firebase (get)
* **Write**: Client → Workers → Firebase (update/set)
* **Sync**: クライアントは定期ポーリング（約10秒ごと）で最新状態を取得

### 認証フロー
1. ユーザーがログイン情報を入力
2. Workers が認証を検証し、トークンを発行（有効期限1時間）
3. クライアントはセッションストレージにトークンを保存
4. 以降のリクエストにトークンを付与

### 同期・競合制御
- 行ごとにデバウンス（約1秒）して送信
- 入力中・変換中のフィールドは更新を保留
- サーバー側で rev（リビジョン番号）を管理
- 競合時はサーバー値を優先

---

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

#### バックエンド (Workers + Firebase)
- **Workers API**: 長期休暇エンドポイント
  - `GET /vacations`: 拠点の長期休暇一覧取得
  - `POST /vacations`: 長期休暇の作成・更新
  - `DELETE /vacations/:id`: 長期休暇の削除
  - データは Firebase Realtime Database に JSON として保存

#### データフロー
1. 管理者が長期休暇を作成 → Workers → Firebase に保存
2. ユーザーがログイン → Workers → Firebase から長期休暇一覧を取得（visible=true のみ）
3. ユーザーが長期休暇を選択 → 今日の日付のビットを解析
4. 該当メンバーの行にハイライトを適用 → ステータス欄に休暇名表示

### お知らせ機能の実装詳細

#### フロントエンド
- **js/notices.js**: お知らせ機能全般
  - `renderNotices()`: お知らせの描画
  - `toggleNoticesArea()`: 折りたたみ/展開
  - `fetchNotices()`: サーバーからの取得（30秒ごとのポーリング）
  - `saveNotices()`: 管理者による保存

#### バックエンド (Workers + Firebase)
- **Workers API**: お知らせエンドポイント
  - `GET /notices`: 拠点のお知らせ一覧取得
  - `POST /notices`: お知らせの保存（最大20件）
  - データは Firebase Realtime Database に JSON 配列として保存

### 認証・セッション管理

- トークンベース認証（有効期限1時間）
- ロール: `user`, `officeAdmin`, `superAdmin`
- セッションストレージにトークンを保存
- 自動更新機能でトークンを延長

---

## トラブルシューティング

### 「通信エラー」が表示される

1. `config.js` の `REMOTE_ENDPOINT` が正しいか確認
2. `index.html` の CSP `connect-src` に Worker URL が含まれているか確認
3. Cloudflare Worker が正常に動作しているか確認（`wrangler tail` でログ確認）
4. Worker の環境変数 `FIREBASE_DB_URL` と `FIREBASE_SERVICE_ACCOUNT` が正しいか確認

### データベースに接続できない

- Cloudflare Workers のログ (`wrangler tail`) を確認してください
- 環境変数 `FIREBASE_SERVICE_ACCOUNT` のJSONフォーマットが正しいか確認してください
- Firebase Console でデータベースが有効化されているか確認してください

### CORSエラーが出る

- Workers のレスポンスヘッダに `Access-Control-Allow-Origin` が適切に設定されているか確認してください
- `config.js` のエンドポイントURLが正しいか確認してください

### Firebase の URL を変更した場合

1. Cloudflare Workers の環境変数 `FIREBASE_DB_URL` を新しい URL に更新
2. Worker を再デプロイまたは再起動
   ```bash
   npx wrangler deploy
   ```
3. キャッシュをクリアしてテスト

### 画面更新が反映されない

Service Worker は導入していないため、ブラウザキャッシュが原因の可能性があります。以下を試してください。

1. ハードリロード（Windows: Ctrl+Shift+R / macOS: Cmd+Shift+R）
2. ブラウザ設定からキャッシュを削除し、再読み込み

### 「拠点またはパスワードが違います」エラー

1. Firebase で拠点データが正しく保存されているか確認
2. 拠点ID・パスワードが正しいか確認
3. Workers のログを確認（`wrangler tail`）

---

## セキュリティに関する注意事項

- **CORS設定**: Cloudflare Worker のレスポンスヘッダで適切に設定
- **CSP設定**: `index.html` の CSP を必要最小限に制限
- **パスワード管理**: Firebase で管理（ハッシュ化推奨）
- **認証トークン**: セッションストレージに保存、有効期限は1時間（デフォルト）
- **APIキーの保護**: Firebase の認証情報は全て Workers の環境変数で管理し、フロントエンドに露出させない

---

## ライセンス・サポート

このプロジェクトは開発者による内部利用を想定しています。  
商用利用する場合は、適切なライセンスを設定してください。
