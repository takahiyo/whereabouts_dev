/**
 * Cloudflare Worker for Whereabouts Board (Firestore Backend)
 * Environment Variables required:
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
      const formData = await req.formData();
      const action = formData.get('action');

      // 認証情報と設定
      const accessToken = await getGoogleAuthToken(env);
      const projectId = env.FIREBASE_PROJECT_ID;
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

      // === API Actions ===

      // 1. LOGIN: パスワード認証
      if (action === 'login') {
        const officeId = formData.get('office'); // 例: "nagoya_chuo"
        const password = formData.get('password');

        if (!officeId || !password) return new Response(JSON.stringify({ error: 'invalid_request' }), { headers: corsHeaders });

        // Firestoreからオフィス設定（パスワード）を取得
        const url = `${baseUrl}/offices/${officeId}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

        if (resp.status !== 200) {
          return new Response(JSON.stringify({ error: 'unauthorized', debug: 'office_not_found' }), { headers: corsHeaders });
        }

        const json = await resp.json();
        const fields = json.fields || {};

        // パスワード照合
        const storedPw = fields.password?.stringValue || '';
        const storedAdminPw = fields.adminPassword?.stringValue || '';

        let role = '';
        if (password === storedAdminPw) {
          role = 'officeAdmin';
        } else if (password === storedPw) {
          role = 'user';
        } else {
          return new Response(JSON.stringify({ error: 'unauthorized', debug: 'pw_mismatch' }), { headers: corsHeaders });
        }

        // 成功時
        return new Response(JSON.stringify({
          ok: true,
          token: 'session_valid',
          role: role,
          office: officeId,
          officeName: fields.name?.stringValue || officeId,
          exp: 3600 * 1000
        }), { headers: corsHeaders });
      }

      // 2. GET: データ取得
      if (action === 'get') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';

        const url = `${baseUrl}/offices/${officeId}/members?pageSize=300`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await resp.json();

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
              rev: 1
            };
          });
        }
        return new Response(JSON.stringify({ updated: Date.now(), data: dataMap }), { headers: corsHeaders });
      }

      // 3. SET: データ更新
      if (action === 'set') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const rawData = formData.get('data');
        if (!rawData) throw new Error('No data');

        const payload = JSON.parse(rawData);
        const updates = payload.data || {};

        const promises = Object.keys(updates).map(async (userId) => {
          const userState = updates[userId];
          // 部分更新（PATCH）
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

      // 4. publicListOffices: 拠点一覧の取得
      if (action === 'publicListOffices') {
        const url = `${baseUrl}/offices`; // Firestoreのofficesコレクションを見に行く
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await resp.json();

        const offices = [];
        if (json.documents) {
          json.documents.forEach(doc => {
            const id = doc.name.split('/').pop();
            const fields = doc.fields || {};
            offices.push({
              id: id,
              name: fields.name?.stringValue || id
            });
          });
        }
        return new Response(JSON.stringify({ ok: true, offices: offices }), { headers: corsHeaders });
      }

      // 5. getConfig: 名簿構造（グループ・メンバー一覧）の取得
      if (action === 'getConfig') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        // Firestoreのmembersコレクションから全メンバーを取得（表示順でソート）
        const url = `${baseUrl}/offices/${officeId}/members?pageSize=300`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await resp.json();

        const members = [];
        if (json.documents) {
          json.documents.forEach(doc => {
            const id = doc.name.split('/').pop();
            const f = doc.fields || {};
            members.push({
              id: id,
              name: f.name?.stringValue || '',
              group: f.group?.stringValue || '',
              order: Number(f.order?.integerValue || f.order?.doubleValue || 0),
              ext: f.ext?.stringValue || '',
              mobile: f.mobile?.stringValue || '',
              email: f.email?.stringValue || '',
              workHours: f.workHours?.stringValue || '',
              status: f.status?.stringValue || '',
              time: f.time?.stringValue || '',
              note: f.note?.stringValue || ''
            });
          });
        }

        // グループごとにまとめる処理（フロントエンドが期待する形式に変換）
        const groupsMap = {};
        members.sort((a, b) => a.order - b.order).forEach(m => {
          if (!groupsMap[m.group]) groupsMap[m.group] = { title: m.group, members: [] };
          groupsMap[m.group].members.push(m);
        });

        return new Response(JSON.stringify({
          ok: true,
          config: { groups: Object.values(groupsMap) },
          updated: Date.now()
        }), { headers: corsHeaders });
      }

      // 6. getNotices: お知らせ一覧の取得
      if (action === 'getNotices') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const url = `${baseUrl}/offices/${officeId}/notices?pageSize=50`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await resp.json();

        const notices = [];
        if (json.documents) {
          json.documents.forEach(doc => {
            const f = doc.fields || {};
            notices.push({
              id: doc.name.split('/').pop(),
              title: f.title?.stringValue || '',
              content: f.content?.stringValue || '',
              updatedAt: f.updatedAt?.timestampValue || ''
            });
          });
        }
        return new Response(JSON.stringify({ ok: true, notices: notices }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'unknown_action' }), { headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};

async function getGoogleAuthToken(env) {
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter)).replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binaryDer.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: clientEmail, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const strHeader = btoa(JSON.stringify(header));
  const strClaim = btoa(JSON.stringify(claim));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${strHeader}.${strClaim}`));
  const strSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${strHeader}.${strClaim}.${strSignature}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const tokenJson = await tokenResp.json();
  return tokenJson.access_token;
}
