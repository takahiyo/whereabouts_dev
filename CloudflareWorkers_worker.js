// 【ここに貼る】Cloudflare Worker（presence-proxy）: index.js（全置換）
// ・GAS（ウェブアプリURL）へ POST プロキシ
// ・CORS: takahiyo.github.io および *.pages.dev (プレビュー含む) を許可
// ・レスポンスは no-store。login/renewの role/office/officeName をそのまま転送
export default {
  async fetch(req, env, ctx) {
    const GAS_ENDPOINT = env.GAS_ENDPOINT || "https://script.google.com/macros/s/AKfycbx1f8DmHkQjleOV-B2hwqNyQho5VZslJG-1jriEbgJgNhNYw9WDtfiaH5fL2yyp9Sbh/exec";
    const origin = req.headers.get('origin') || '';

    // ▼▼▼ 変更箇所: CORS 許可判定ロジック ▼▼▼
    // 1. https://takahiyo.github.io (完全一致)
    // 2. .pages.dev で終わるドメイン (Cloudflare Pagesの本番・プレビュー全て)
    const isAllowed = origin === 'https://takahiyo.github.io' || origin.endsWith('.pages.dev');
    
    // 許可されたオリジンならその値を、そうでなければ空文字をセット
    const allowOrigin = isAllowed ? origin : '';
    // ▲▲▲ 変更箇所ここまで ▲▲▲

    // Preflight
    if (req.method === 'OPTIONS') {
      if (!allowOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (!allowOrigin) {
      return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    // 受け取った application/x-www-form-urlencoded をそのままGASへ
    const body = await req.text();

    // GASへ転送
    const r = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // Cloudflare 側のキャッシュ抑止
      cf: { cacheTtl: 0, cacheEverything: false }
    });

    // JSON以外はエラー扱い
    const ct = r.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('application/json')) {
      return new Response(JSON.stringify({ error: 'upstream_bad_content_type' }), {
        status: 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': allowOrigin,
          'cache-control': 'no-store'
        }
      });
    }

    const json = await r.json();

    // 常に no-store + CORS ヘッダ
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': allowOrigin,
        'cache-control': 'no-store'
      }
    });
  }
};
