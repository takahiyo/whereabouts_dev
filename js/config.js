// 環境ごとの設定値
// REMOTE_ENDPOINT: APIのエンドポイント
// REMOTE_POLL_MS: 状態更新のポーリング間隔(ms)
// CONFIG_POLL_MS: 設定更新のポーリング間隔(ms)
// TOKEN_DEFAULT_TTL: トークンのデフォルト有効期限(ms)
const REMOTE_ENDPOINT = "https://presence-proxy-test.taka-hiyo.workers.dev";
const REMOTE_POLL_MS = 10000;
const CONFIG_POLL_MS = 30000;
const TOKEN_DEFAULT_TTL = 3600000;

// publicListOffices が利用できない環境で使用する拠点一覧（id, name）
const PUBLIC_OFFICE_FALLBACKS = [];

// Firebase Configuration (Compat版)
const firebaseConfig = {
    apiKey: "AIzaSyDRTr7h0diRJW6U1dQJaJgr303A5wm3aTE",
    authDomain: "whereabouts-438df.firebaseapp.com",
    projectId: "whereabouts-438df",
    storageBucket: "whereabouts-438df.firebasestorage.app",
    messagingSenderId: "955108979418",
    appId: "1:955108979418:web:31a7235eeec873018dabe3",
    measurementId: "G-26G0TS4HDW"
};

// Initialize Firebase (Compat版)
function initFirebase() {
    // SDKが正しく読み込まれているかチェック
    if (typeof firebase === 'undefined') {
        console.error("Firebase SDK not loaded.");
        return false;
    }
    // すでに初期化済みなら何もしない
    if (firebase.apps && firebase.apps.length > 0) {
        return true;
    }
    // 初期化を実行
    firebase.initializeApp(firebaseConfig);
    return true;
}

// 即座に初期化を試み、失敗したらロード完了を待って再試行
if (!initFirebase()) {
    window.addEventListener('load', () => {
        initFirebase();
    }, { once: true });
}
