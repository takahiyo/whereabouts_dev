/**
 * Cloudflare Worker for Whereabouts Board (Firestore Backend)
 * * Environment Variables required:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (PEM format)
 */

export default {
  async fetch(req, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: corsHeaders });
    }

    try {
      // フォームデータのパース
      const formData = await req.formData();
      const action = formData.get('action');
      const token = formData.get('token'); // 将来的には Firebase ID Token として扱う
      
      // TODO: 本格的な認証実装までは簡易チェックまたはスルー
      // const decodedToken = await verifyFirebaseToken(token); 

      // アクセストークンの取得 (Firestore REST API用)
      const accessToken = await getGoogleAuthToken(env);
      const projectId = env.FIREBASE_PROJECT_ID;
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

      // === API Actions ===

      // 1. GET: データ取得 (GASのレスポンス形式に変換)
      if (action === 'get') {
        const officeId = 'nagoya'; // 仮: トークンから特定すべきだが一旦固定
        
        // Firestoreからメンバー一覧を取得
        const url = `${baseUrl}/offices/${officeId}/members?pageSize=300`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await resp.json();
        
        // GAS形式 ({data: {userId: {status...}}}) に変換
        const dataMap = {};
        if (json.documents) {
          json.documents.forEach(doc => {
            const id = doc.name.split('/').pop();
            const fields = doc.fields || {};
            dataMap[id] = {
              status: fields.status?.stringValue || '',
              time: fields.time?.stringValue || '',
              note: fields.note?.stringValue || '',
              workHours: fields.workHours?.stringValue || '',
              // serverUpdated: fields.updatedAt?.timestampValue ... 必要なら変換
            };
          });
        }
        
        return new Response(JSON.stringify({ updated: Date.now(), data: dataMap }), { headers: corsHeaders });
      }

      // 2. SET: データ更新
      if (action === 'set') {
        const officeId = 'nagoya'; // 仮
        const rawData = formData.get('data');
        if (!rawData) throw new Error('No data');
        
        const payload = JSON.parse(rawData);
        const updates = payload.data || {}; // { userId: { status: '...', ... } }
        
        // Firestoreへの書き込み (BatchWrite推奨だが、ここでは個別書き込みで実装)
        // ※ 本番では `commit` API を使ってトランザクション化を推奨
        const promises = Object.keys(updates).map(async (userId) => {
          const userState = updates[userId];
          const docUrl = `${baseUrl}/offices/${officeId}/members/${userId}?updateMask.fieldPaths=status&updateMask.fieldPaths=time&updateMask.fieldPaths=note&updateMask.fieldPaths=workHours&updateMask.fieldPaths=updatedAt`;
          
          const body = {
            fields: {
              status: { stringValue: userState.status || '' },
              time: { stringValue: userState.time || '' },
              note: { stringValue: userState.note || '' },
              workHours: { stringValue: userState.workHours || '' },
              updatedAt: { timestampValue: new Date().toISOString() }
            }
          };

          return fetch(docUrl, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        });

        await Promise.all(promises);
        return new Response(JSON.stringify({ ok: true, updated: Date.now() }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'unknown_action' }), { headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: corsHeaders });
    }
  }
};

/**
 * Google Service Account 用の OAuth2 トークン生成ヘルパー
 * (Web Crypto API 使用 - Node.js依存なし)
 */
async function getGoogleAuthToken(env) {
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  
  // PEMヘッダー除去とバイナリ変換
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter)).replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const strHeader = btoa(JSON.stringify(header));
  const strClaim = btoa(JSON.stringify(claim));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${strHeader}.${strClaim}`)
  );
  const strSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${strHeader}.${strClaim}.${strSignature}`;

  // Google OAuth2 トークンエンドポイントへ交換リクエスト
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  
  const tokenJson = await tokenResp.json();
  return tokenJson.access_token;
}
