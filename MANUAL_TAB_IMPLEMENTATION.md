# マニュアルタブ化実装サマリー

## ✅ 実装完了日
**2025-11-12**

---

## 🎯 実装内容

### 問題点
- マニュアルモーダルでユーザーマニュアルと管理者マニュアルが縦に2ペイン表示されていた
- 長いマニュアルをスクロールして目的の情報を探す必要があり、見づらい
- 管理者以外のユーザーには管理者マニュアルは不要だが、常に表示されていた

### 解決策
**タブ方式のナビゲーションを実装し、ユーザー向けと管理者向けを切り替え可能に**

---

## 📐 実装詳細

### 1. HTML構造（index.html）

**追加されたタブボタン:**
```html
<div class="manual-tabs">
  <button class="manual-tab-btn active" data-tab="user">📖 ユーザー向け</button>
  <button class="manual-tab-btn" data-tab="admin">⚙️ 管理者向け</button>
</div>
```

**セクションのクラス変更:**
```html
<!-- 修正前 -->
<section id="manualUser" class="manual-section">
<section id="manualAdmin" class="manual-section">

<!-- 修正後 -->
<section id="manualUser" class="manual-section manual-tab-content active">
<section id="manualAdmin" class="manual-section manual-tab-content">
```

**完全な構造:**
```html
<div class="manual-card" role="document">
  <div>  <!-- Sticky header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 id="manualTitle" style="margin:0;">マニュアル</h3>
      <button id="manualClose" aria-label="閉じる">閉じる</button>
    </div>
    <div class="manual-tabs">
      <button class="manual-tab-btn active" data-tab="user">📖 ユーザー向け</button>
      <button class="manual-tab-btn" data-tab="admin">⚙️ 管理者向け</button>
    </div>
  </div>
  
  <section id="manualUser" class="manual-section manual-tab-content active">
    <!-- ユーザーマニュアルの内容 -->
  </section>
  
  <section id="manualAdmin" class="manual-section manual-tab-content">
    <!-- 管理者マニュアルの内容 -->
  </section>
</div>
```

---

### 2. CSS スタイリング（styles.css）

**タブコンテナ:**
```css
.manual-tabs{ 
  display:flex; 
  gap:8px; 
  margin-top:8px; 
}
```

**タブボタン（非アクティブ）:**
```css
.manual-tab-btn{
  padding:8px 16px; 
  border:1px solid #d1d5db; 
  border-radius:6px 6px 0 0;
  background:#f9fafb; 
  cursor:pointer; 
  font-size:14px; 
  font-weight:600;
  color:#6b7280; 
  transition:all .2s;
}
.manual-tab-btn:hover{ 
  background:#f3f4f6; 
}
```

**タブボタン（アクティブ）:**
```css
.manual-tab-btn.active{
  background:#fff; 
  border-bottom-color:#fff;  /* コンテンツと繋がる */
  color:#0073bb;             /* アクセントカラー */
  position:relative; 
  margin-bottom:-1px;        /* ボーダーを重ねる */
}
```

**タブコンテンツの表示切り替え:**
```css
.manual-tab-content{ 
  display:none;  /* デフォルトは非表示 */
}
.manual-tab-content.active{ 
  display:block; /* activeクラスで表示 */
}
```

**デザインの特徴:**
- タブボタンは上部が丸く、下部は直線（タブらしいデザイン）
- アクティブタブの下ボーダーが白色で、コンテンツエリアと視覚的に繋がる
- ホバー時に背景色が変わり、クリック可能であることを示す
- 青色のテキストでアクティブタブを強調

---

### 3. JavaScript 実装（js/auth.js）

#### タブ切り替え機能

**イベントリスナーの追加:**
```javascript
/* マニュアルタブ切り替え */
document.querySelectorAll('.manual-tab-btn').forEach(btn => {
  btn.addEventListener('click', ()=>{
    const targetTab = btn.dataset.tab;
    
    // すべてのタブボタンとコンテンツのactiveクラスを削除
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    
    // クリックされたタブボタンとそのコンテンツにactiveクラスを追加
    btn.classList.add('active');
    if(targetTab === 'user'){
      document.getElementById('manualUser').classList.add('active');
    } else if(targetTab === 'admin'){
      document.getElementById('manualAdmin').classList.add('active');
    }
  });
});
```

**動作フロー:**
1. タブボタンがクリックされる
2. `data-tab` 属性から対象タブを取得（`user` or `admin`）
3. すべてのタブボタンとコンテンツから `active` クラスを削除
4. クリックされたタブボタンに `active` クラスを追加
5. 対応するコンテンツセクションに `active` クラスを追加
6. CSS の `.active` ルールにより表示が切り替わる

#### 役割ベースのデフォルトタブ

**`applyRoleToManual()` 関数の拡張:**
```javascript
function applyRoleToManual(){
  const isAdmin = isOfficeAdmin();
  
  // 管理者タブボタンの表示/非表示
  const adminTabBtn = document.querySelector('.manual-tab-btn[data-tab="admin"]');
  if(adminTabBtn){
    adminTabBtn.style.display = isAdmin ? 'inline-block' : 'none';
  }
  
  // デフォルトタブの設定（管理者なら管理者タブ、それ以外はユーザータブ）
  const userTabBtn = document.querySelector('.manual-tab-btn[data-tab="user"]');
  if(isAdmin && adminTabBtn){
    // 管理者の場合は管理者タブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    adminTabBtn.classList.add('active');
    manualAdmin.classList.add('active');
  } else {
    // 一般ユーザーの場合はユーザータブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    if(userTabBtn) userTabBtn.classList.add('active');
    manualUser.classList.add('active');
  }
}
```

**ロジック:**
1. **管理者の場合:**
   - 管理者タブボタンを表示
   - デフォルトで管理者タブを開く（管理者は管理機能を確認することが多いため）
   - ユーザータブにも切り替え可能

2. **一般ユーザーの場合:**
   - 管理者タブボタンを非表示（混乱防止）
   - デフォルトでユーザータブを開く
   - 管理者タブは見えない

---

## 🎨 UI/UX デザイン

### タブの視覚デザイン

**非アクティブタブ:**
```
┌──────────────┐  ┌──────────────┐
│ 📖 ユーザー向け │  │ ⚙️ 管理者向け │ ← グレー背景、グレーテキスト
└──────────────┘  └──────────────┘
```

**アクティブタブ（ユーザー向け選択時）:**
```
┌──────────────┐  ┌──────────────┐
│ 📖 ユーザー向け │  │ ⚙️ 管理者向け │ ← 青テキスト、白背景
└──────────────┴──┴──────────────┘
────────────────────────────────────
  (コンテンツエリアと視覚的に繋がる)
```

### Before / After 比較

**修正前（縦スクロール）:**
```
┌────────────────────────────┐
│ [マニュアル]    [閉じる]   │
├────────────────────────────┤
│ 📖 ユーザーマニュアル       │
│   - ログイン               │
│   - 画面の見方             │
│   - 基本操作               │
│   ↓ スクロール             │
│   ↓                        │
│ ⚙️ 管理者マニュアル        │ ← 一般ユーザーには不要
│   - 管理者権限             │
│   - CSVエクスポート        │
│   - CSVインポート          │
│   ↓ スクロール             │
└────────────────────────────┘
```

**修正後（タブ切り替え）:**
```
┌────────────────────────────┐
│ [マニュアル]    [閉じる]   │
├────────────────────────────┤
│ [📖 ユーザー向け] [管理者] │ ← タブで切り替え
├────────────────────────────┤
│ ユーザーマニュアル          │
│   - ログイン               │
│   - 画面の見方             │
│   - 基本操作               │
│   (スクロール範囲が短い)   │
└────────────────────────────┘
```

---

## 📊 変更統計

| ファイル | 追加行 | 削除行 | 変更内容 |
|---------|--------|--------|----------|
| **index.html** | +5 | -2 | タブボタン追加、クラス変更 |
| **styles.css** | +17 | -0 | タブスタイリング追加 |
| **js/auth.js** | +36 | -4 | タブ切り替えロジック、役割ベース表示 |
| **合計** | **+58** | **-6** | **差分: +52行** |

---

## ✅ 実装の効果

### 1. **UI の整理**
- ✅ 一度に表示される情報量が半分になり、見やすくなった
- ✅ 関係ないマニュアルをスクロールする必要がなくなった
- ✅ タブで明確に区別され、どの情報を見ているか一目瞭然

### 2. **UX の向上**
- ✅ 必要な情報にすぐアクセスできる
- ✅ 管理者は管理者向けマニュアルがデフォルトで開く（効率的）
- ✅ 一般ユーザーには管理者タブが見えない（混乱防止）

### 3. **アクセシビリティ**
- ✅ 役割ベースで適切なコンテンツが表示される
- ✅ 直感的なタブインターフェース（一般的なUIパターン）
- ✅ ホバーエフェクトでクリック可能であることを明示

### 4. **保守性**
- ✅ 既存のマニュアルコンテンツはそのまま（変更なし）
- ✅ 将来的にタブを追加しやすい構造
- ✅ CSS と JavaScript が分離され、スタイル変更が容易

---

## 🔧 技術的なポイント

### CSS のタブデザインパターン
```css
/* アクティブタブの下ボーダーを消して、コンテンツと繋げる */
.manual-tab-btn.active{
  border-bottom-color:#fff;  /* 背景色と同じ */
  margin-bottom:-1px;        /* ボーダーを1px重ねる */
}
```
このテクニックにより、タブボタンとコンテンツエリアが視覚的に一体化します。

### data-* 属性の活用
```html
<button class="manual-tab-btn" data-tab="user">...</button>
<button class="manual-tab-btn" data-tab="admin">...</button>
```
`data-tab` 属性でタブの種類を識別し、JavaScriptで簡単に対象を判別できます。

### 役割ベースの動的UI
```javascript
const isAdmin = isOfficeAdmin();
adminTabBtn.style.display = isAdmin ? 'inline-block' : 'none';
```
ユーザーの役割に応じてUIを動的に変更することで、関係ない情報を隠し、UXを向上させます。

---

## 🧪 動作確認チェックリスト

### 一般ユーザーとして
- [ ] ログイン後、マニュアルボタンをクリック
- [ ] **「📖 ユーザー向け」タブのみが表示される**ことを確認
- [ ] **管理者向けタブが表示されない**ことを確認
- [ ] ユーザーマニュアルの内容が表示されることを確認
- [ ] 閉じるボタンが常に表示されることを確認（前の改善）

### 管理者として
- [ ] 管理者権限でログイン
- [ ] マニュアルボタンをクリック
- [ ] **両方のタブが表示される**ことを確認
- [ ] **デフォルトで「⚙️ 管理者向け」タブが開いている**ことを確認
- [ ] 管理者マニュアルの内容が表示されることを確認
- [ ] **「📖 ユーザー向け」タブをクリック**
- [ ] ユーザーマニュアルに切り替わることを確認
- [ ] 再度「⚙️ 管理者向け」タブをクリック
- [ ] 管理者マニュアルに戻ることを確認

### タブのビジュアル
- [ ] アクティブなタブが青色のテキストで表示される
- [ ] 非アクティブなタブはグレーのテキストで表示される
- [ ] アクティブなタブの背景が白色
- [ ] タブにホバーすると背景色が変わる
- [ ] タブとコンテンツエリアが視覚的に繋がっている

---

## 🔄 Git コミット履歴

```bash
commit 86e893a - feat: Add tab-based navigation to manual modal
  - HTML: Added tab buttons in sticky header
  - CSS: Tab styling with active state
  - JavaScript: Tab switching logic + role-based defaults
  - Benefits: Cleaner UI, easier to read, role-based default tab
```

---

## 📚 今後の拡張可能性

### 追加できるタブ
- 「🔧 トラブルシューティング」タブ
- 「📝 FAQ」タブ
- 「🎬 動画チュートリアル」タブ

### 機能拡張
- タブの状態を localStorage に保存（次回開くときも同じタブ）
- キーボードショートカット（Ctrl+1, Ctrl+2 でタブ切り替え）
- タブ内検索機能
- 印刷時は全タブの内容を出力

### アクセシビリティ向上
- ARIA属性の追加（`role="tablist"`, `role="tab"`, `role="tabpanel"`）
- キーボードナビゲーション（矢印キーでタブ移動）
- スクリーンリーダー対応の強化

---

## 💡 実装時の学び

### 成功要因
1. **既存コンテンツを変更しない**: マニュアルの内容はそのまま、構造のみ変更
2. **段階的な実装**: HTML → CSS → JavaScript の順で確実に
3. **役割ベースの配慮**: 管理者と一般ユーザーで異なる体験を提供

### 注意したポイント
1. **タブボタンをstickyヘッダー内に配置**: スクロールしても常に見える
2. **デフォルトタブの設定**: ユーザーの役割に応じた最適なタブを表示
3. **CSSのz-index管理**: タブのボーダーが適切に重なるように調整

---

**実装者**: Claude Code AI  
**確認者**: ユーザー  
**ステータス**: ✅ 実装完了・本番反映待ち
