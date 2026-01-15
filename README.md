# 在席確認表 (Whereabouts Board)

## 🤖 AI Development Guidelines (AI開発者向けガイドライン)

**本プロジェクトは AI Vibe Coding によって開発・運用されます。以下のアーキテクチャおよび制約を厳守してください。**

### 1. 技術スタックとインフラ (Technology Stack)
- **Code Management**: GitHub
- **Frontend Hosting**: **Cloudflare Pages** (NOT GitHub Pages)
- **Backend / API**: **Cloudflare Workers**
- **Database**: **Firebase** (Firestore / Realtime Database)
  - **Access Strategy**: **Graceful Degradation (ハイブリッド構成)**
    - **Read**: 基本はクライアント(Firebase SDK)からのリアルタイム監視。接続不可時にWorkers経由のポーリングへ自動的に切り替えます。
    - **Write**: データ整合性とファイアウォール回避のため、原則として **Cloudflare Workers を経由** します。
- **Language**: Vanilla JavaScript (ES6+), HTML5, CSS3

### 2. 禁止事項 (Constraints)
- **Google Apps Script (GAS) の使用禁止**: 旧バージョンのコードに含まれるGAS関連の記述やファイルは無視し、提案しないでください。
- **Write操作の直接実行禁止 (推奨)**: データの整合性とセキュリティを担保するため、書き込み操作は原則として Workers API を通じて行ってください。
- **複雑なビルドツールの回避**: 現状の Vanilla JS 構成を維持してください（必要最低限のバンドルは可）。
- **Service Worker の使用禁止**: オフラインキャッシュは未使用です。

---

## データフロー (Graceful Degradation)

本システムは、ネットワーク環境に応じて最適な通信手段を自動選択する「グレースフル・デグラデーション」設計を採用しています。

### 1. 読み取り (Read / Sync)
通信量削減とリアルタイム性向上のため、以下の優先順位で同期を行います。

1.  **Plan A: Firebase SDK (Realtime Listener)**
    * **接続**: クライアントからFirebaseへ直接接続 (`onSnapshot`)
    * **特徴**: 変更があった場合のみ通信発生（低コスト・低遅延）
    * **対象**: 一般的なネットワーク環境（PC、スマホ）
2.  **Plan B: Workers Polling (Fallback)**
    * **接続**: Cloudflare Workers 経由で定期取得 (`GET /members`)
    * **条件**: 社内ファイアウォール等でSDK接続が遮断された場合、またはタイムアウト時に自動切り替え
    * **特徴**: 約10秒ごとのポーリング（高コスト・遅延あり）

### 2. 書き込み (Write)
* **Method**: Client → Workers → Firebase
* **理由**: ネットワーク環境による書き込み失敗（データの不整合）を防ぐため、書き込みは常に HTTP(S) が通る Workers を経由させます。

### 3. 認証 (Auth)
* **認証基盤**: Firebase Auth (Anonymous / Custom) + Workers Token
* **フロー**:
    1.  ログイン時、Workersがパスワード検証し、Firebase Authのカスタムトークンを発行
    2.  クライアントはFirebase SDKでサインイン（Plan A用）
    3.  同時にWorkers用のセッショントークンも保持（Plan B / Write用）

---

## プロジェクト構成


```

.
├── webapp/                      # フロントエンド (Cloudflare Pagesデプロイ対象)
│   ├── index.html               # メインHTML（タイトル・CSP設定含む）
│   ├── config.js                # 環境設定（Firebase設定・Workerエンドポイント）
│   ├── main.js                  # アプリケーション起動処理
│   ├── styles.css               # スタイル定義
│   └── js/
│       ├── globals.js           # グローバル変数
│       ├── sync.js              # データ同期（ハイブリッド通信ロジック）
│       ├── auth.js              # 認証処理
│       └── ... (その他jsファイル)
├── workers/                     # バックエンド (Cloudflare Workers)
│   ├── src/
│   │   └── index.js             # Worker エントリポイント
│   └── wrangler.toml            # Workers設定
├── USER_MANUAL.md               # ユーザー向け詳細マニュアル
├── ADMIN_MANUAL.md              # 管理者向け詳細マニュアル
└── README.md                    # 本ドキュメント

```

---

## セットアップとデプロイ手順

### 1. Firebase プロジェクトの準備

1.  Firebase Console で新規プロジェクトを作成
2.  **Firestore (または Realtime Database)** を作成
3.  **セキュリティルールの設定 (重要)**
    SDKからの直接読み取りを許可するため、以下のルールを設定してください：
    ```
    // Firestoreの例
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /offices/{officeId}/members/{memberId} {
          // 認証済みユーザーは読み取り可能、書き込みはサーバー(Workers)経由のみのため拒否
          allow read: if request.auth != null;
          allow write: if false; 
        }
        // ...その他必要なルール（config, noticesなど）も同様にread許可
      }
    }
    ```
4.  Workers用: 「プロジェクトの設定」→「サービスアカウント」から **新しい秘密鍵の生成** を行い、JSONファイルをダウンロード
5.  Frontend用: 「プロジェクトの設定」→「全般」→「マイアプリ」から **ウェブアプリ** を追加し、`firebaseConfig` オブジェクトを取得

### 2. Cloudflare Workers (Backend) の設定

#### 環境変数 (Secrets) の設定

`wrangler secret put` または Cloudflare ダッシュボードで以下を設定：

```bash
# Firebase Database URL
npx wrangler secret put FIREBASE_DB_URL

# Firebase Service Account (JSON文字列)
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT

```

#### デプロイ

```bash
cd workers
npm install
npx wrangler deploy

```

### 3. Cloudflare Pages (Frontend) の設定

#### `config.js` の設定

Firebase SDKを利用するため、構成情報を追加します。

**ファイル**: `webapp/config.js`

```javascript
// Firebase SDK Configuration (Plan A用)
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "...",
  projectId: "...",
  // ... (Firebaseコンソールから取得した値)
};

// Workers Endpoint (Plan B / Write用)
const REMOTE_ENDPOINT = "[https://presence-proxy.taka-hiyo.workers.dev](https://presence-proxy.taka-hiyo.workers.dev)";

```

### 4. `index.html` の変更 (CSP)

SDKが Google のサーバーと通信できるように CSP を緩和する必要があります。

**ファイル**: `webapp/index.html`

**検索キーワード**: `connect-src`

```html
connect-src 'self' 
    [https://presence-proxy.taka-hiyo.workers.dev](https://presence-proxy.taka-hiyo.workers.dev) 
    https://*.googleapis.com 
    https://*.firebaseio.com 
    https://*.firebaseapp.com
    wss://*.firebaseio.com;

```

---

## 環境別設定ファイルの管理（推奨）

複数環境を管理する場合、設定ファイルを分けて管理することを推奨します。

```bash
cp config.js config.dev.js
cp config.js config.prod.js

```

---

## 変更チェックリスト

本番デプロイ前に以下を確認してください：

### Firebase設定

* [ ] **Security Rules**: 認証済みユーザーの `read` を許可するルールが適用されているか
* [ ] **Service Account**: WorkersにJSONが設定されているか

### フロントエンド設定

* [ ] **config.js**: `firebaseConfig` と `REMOTE_ENDPOINT` が正しく設定されているか
* [ ] **index.html**: CSP に `googleapis.com`, `firebaseio.com` 等が追加されているか

### 動作確認

* [ ] **Plan A確認**: 通常環境でコンソールに「SDK接続成功」等のログが出るか（または通信量が削減されているか）
* [ ] **Plan B確認**: ファイアウォール環境（またはSDKエラーを擬似的に発生させた状態）で、Workers経由でデータが同期されるか
* [ ] **Write確認**: ステータス変更が正常に保存されるか（Workers経由）

---

## 開発・デバッグ

### ローカル開発サーバー

```bash
npx http-server -p 8000

```

ブラウザで `http://localhost:8000` にアクセス

### デバッグログ

`js/sync.js` 内の接続モード切り替えログを確認することで、現在どちらのモードで動作しているか確認できます。

* SDKモード: `Using Firebase SDK (Realtime)`
* Workersモード: `Fallback to Workers Polling`

---

## ライセンス・サポート

このプロジェクトは開発者による内部利用を想定しています。

```

```
