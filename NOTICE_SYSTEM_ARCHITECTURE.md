# お知らせシステム - アーキテクチャ図

## 🏗️ システム構成図

```
┌─────────────────────────────────────────────────────────────┐
│                         ユーザー                              │
│                     （ブラウザ）                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTPS リクエスト
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker                          │
│                   (hqweb-proxy)                              │
│                                                               │
│  環境変数: GAS_ENDPOINT = "https://script.google.com/..."   │
│                                                               │
│  役割:                                                        │
│  - リクエストのプロキシ                                      │
│  - CORS ヘッダーの追加                                       │
│  - レスポンスキャッシュ                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ プロキシ経由でリクエスト
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Apps Script (GAS)                        │
│                 GAS_コード.gs (622行)                        │
│                                                               │
│  エンドポイント:                                              │
│  - action=getNotices  → お知らせ取得 (523-546行)            │
│  - action=setNotices  → お知らせ保存 (548-581行)            │
│                                                               │
│  正規化関数:                                                  │
│  - coerceNoticeArray_()      (158-175行)                    │
│  - normalizeNoticeItem_()    (177-197行)                    │
│  - normalizeNoticesArray_()  (199-206行)                    │
│                                                               │
│  キャッシュ: CacheService (20秒)                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ 読み書き
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│            Script Properties (データストア)                   │
│                                                               │
│  キー形式: notices:{オフィス名}                               │
│  例: notices:nagoya, notices:tokyo                           │
│                                                               │
│  データ形式: JSON配列                                         │
│  [{title: "タイトル", content: "内容"}, ...]                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 データフロー

### 1️⃣ お知らせ取得フロー (getNotices)

```
[ブラウザ] js/notices.js - fetchNotices()
    │
    │ POST /gas?action=getNotices&office=nagoya&token=xxx&nocache=1
    │
    ▼
[Cloudflare Worker] プロキシ
    │
    │ 環境変数 GAS_ENDPOINT に転送
    │
    ▼
[GAS] doPost() - action === 'getNotices' (523-546行)
    │
    │ 1. トークン検証
    │ 2. オフィス権限チェック
    │ 3. キャッシュ確認 (cache.get)
    │ 4. Script Properties から取得
    │ 5. normalizeNoticesArray_() で正規化
    │ 6. キャッシュに保存
    │
    ▼
[レスポンス] {updated: 1731398400000, notices: [{title: "...", content: "..."}, ...]}
    │
    ▼
[ブラウザ] renderNotices() でHTML描画
```

### 2️⃣ お知らせ保存フロー (setNotices)

```
[ブラウザ] js/admin.js - saveNotices()
    │
    │ POST /gas?action=setNotices&office=nagoya&token=xxx
    │ Body: notices=[{title: "...", content: "..."}, ...]
    │
    ▼
[Cloudflare Worker] プロキシ
    │
    │ 環境変数 GAS_ENDPOINT に転送
    │
    ▼
[GAS] doPost() - action === 'setNotices' (548-581行)
    │
    │ 1. トークン検証
    │ 2. 管理者権限チェック
    │ 3. JSON パース
    │ 4. normalizeNoticesArray_() で正規化
    │ 5. LockService でロック取得
    │ 6. Script Properties に保存
    │ 7. キャッシュ更新
    │ 8. ロック解放
    │
    ▼
[レスポンス] {ok: true, notices: [{title: "...", content: "..."}, ...]}
    │
    ▼
[ブラウザ] fetchNotices() でリロード → renderNotices()
```

---

## 🎨 フロントエンド構造

### HTML構造 (index.html)

```html
<header class="main-header">
  <h1>本部システム</h1>
  <div>
    <button id="noticesBtn">お知らせ</button>      ← 新規追加
    <button id="adminBtn">管理</button>
    <button id="logoffBtn">ログオフ</button>
    <button id="manualBtn">マニュアル</button>
  </div>
</header>

<div id="noticesArea" class="notices-area">       ← 新規追加
  <div class="notices-container">
    <div class="notices-header">
      <h3 class="notices-title">📢 お知らせ</h3>
      <span id="noticesSummary" class="notices-summary"></span>
    </div>
    <div id="noticesList" class="notices-list">
      <!-- お知らせ項目が動的に挿入される -->
    </div>
  </div>
</div>

<div id="mainboard" class="mainboard">
  <!-- パネル表示エリア -->
</div>
```

### CSS状態管理 (styles.css)

```css
/* 通常状態（展開） */
.notices-area {
  display: block;
  transition: all 0.3s ease;
}
.notices-title { display: block; }
.notices-summary { display: none; }
.notices-list { display: block; }

/* 折りたたみ状態 */
.notices-area.collapsed {
  /* collapsed クラスが追加される */
}
.notices-area.collapsed .notices-title { display: none; }
.notices-area.collapsed .notices-summary { display: inline !important; }
.notices-area.collapsed .notices-list { display: none; }
```

### JavaScript イベントフロー (main.js + notices.js)

```javascript
// main.js - イベントリスナー登録
noticesBtn.addEventListener('click', () => {
  toggleNoticesArea();  // notices.js の関数を呼び出し
});

// notices.js - トグル関数
function toggleNoticesArea() {
  const noticesArea = document.getElementById('noticesArea');
  noticesArea.classList.toggle('collapsed');  // CSS クラスを切り替え
}
```

---

## 🔐 権限管理

### お知らせ閲覧権限
- **すべてのログインユーザー**: 自分のオフィスのお知らせを閲覧可能
- **スーパー管理者**: すべてのオフィスのお知らせを閲覧可能

### お知らせ編集権限
- **オフィス管理者**: 自分のオフィスのお知らせを追加・編集・削除可能
- **スーパー管理者**: すべてのオフィスのお知らせを追加・編集・削除可能

### GAS での権限チェック

```javascript
// getNotices (読み取り)
if (requestedOffice && requestedOffice !== tokenOffice) {
  if (canAdminOffice_(prop, token, requestedOffice)) {
    office = requestedOffice;  // スーパー管理者のみ他オフィス参照可
  }
}

// setNotices (書き込み)
if (!roleIsOfficeAdmin_(prop, token)) {
  return json_({ error: 'forbidden', debug: 'role=' + role });
}
```

---

## 📦 データ正規化

### 入力形式の柔軟性

GASの正規化関数は以下のすべての形式を受け入れます:

```javascript
// 形式1: 標準オブジェクト配列
[
  {title: "タイトル1", content: "内容1"},
  {title: "タイトル2", content: "内容2"}
]

// 形式2: 配列の配列
[
  ["タイトル1", "内容1"],
  ["タイトル2", "内容2"]
]

// 形式3: 文字列のみ（タイトルとして扱う）
["タイトル1", "タイトル2"]

// 形式4: オブジェクトのオブジェクト
{
  "1": {title: "タイトル1", content: "内容1"},
  "2": {title: "タイトル2", content: "内容2"}
}

// 形式5: JSON文字列
'[{"title":"タイトル1","content":"内容1"}]'
```

### 正規化後の統一形式

すべて以下の形式に変換されます:

```javascript
[
  {
    title: "タイトル1 (最大200文字)",
    content: "内容1 (最大2000文字)"
  },
  {
    title: "タイトル2",
    content: "内容2"
  }
]
```

---

## 🚨 現在の問題と解決策

### 問題: `{error: 'unknown_action'}` エラー

**症状:**
```javascript
// ブラウザコンソール
saveNotices: sending params: {action: 'setNotices', ...}
setNotices response: {error: 'unknown_action'}  ← エラー
```

**原因:**
- GASコードは正しく更新されている（622行、関数は存在）
- しかし、デプロイされたバージョンが古いまま
- Cloudflare Workerが古いGAS URLを参照している可能性

**診断方法:**
```bash
# 1. GASエディタで確認
- 総行数: 622行 ✓
- 523-524行: if(action === 'getNotices'){ ✓
- 548行: if(action === 'setNotices'){ ✓

# 2. ブラウザコンソールで確認
- リクエスト送信: ✓
- レスポンス: {error: 'unknown_action'} ✗

# 結論: デプロイの問題
```

**解決策:**
1. ✅ 新規GASデプロイを作成（既存の更新ではなく）
2. ✅ 新しいウェブアプリURLを取得
3. ✅ Cloudflare Worker環境変数 `GAS_ENDPOINT` を更新
4. ✅ すべてのキャッシュをクリア
5. ✅ 動作確認

---

## 📝 関連ファイル一覧

### バックエンド
- `GAS_コード.gs` (622行) - Google Apps Script メインコード

### フロントエンド
- `index.html` - HTML構造（ヘッダーボタン、お知らせエリア）
- `styles.css` - スタイリング（ボタン、折りたたみ状態）
- `js/globals.js` - グローバル変数とDOM要素参照
- `js/auth.js` - 認証とUI制御
- `js/notices.js` - お知らせ取得・描画・トグル機能
- `js/admin.js` - お知らせ保存機能
- `main.js` - イベントリスナー登録

### デプロイ関連
- `GAS_新規デプロイ手順.md` - 詳細なデプロイ手順
- `DEPLOYMENT_CHECKLIST.md` - デプロイチェックリスト
- `NOTICE_SYSTEM_ARCHITECTURE.md` - このファイル（アーキテクチャ図）

---

## 🎯 次のステップ

1. **GAS新規デプロイ作成** - `GAS_新規デプロイ手順.md` に従って実行
2. **Cloudflare Worker更新** - 環境変数を新しいURLに変更
3. **キャッシュクリア** - ブラウザとCloudflareのキャッシュをクリア
4. **動作確認** - `DEPLOYMENT_CHECKLIST.md` に従ってテスト
5. **完了報告** - すべてのチェック項目が完了したら報告

---

**作成日:** 2025-11-12  
**バージョン:** 1.0
