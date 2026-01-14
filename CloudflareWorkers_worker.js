/**
 * Cloudflare Worker for Whereabouts Board (Firestore Backend)
 */

export default {
  async fetch(req, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: corsHeaders });

    try {
      const formData = await req.formData();
      const action = formData.get('action');

      // 1. Google認証トークンの取得
      const accessToken = await getGoogleAuthToken(env);
      const projectId = env.FIREBASE_PROJECT_ID;
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

      // --- Helper: Firestore通信用の共通関数 ---
      const firestoreFetch = async (path) => {
        const url = `${baseUrl}/${path}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = await res.json();
        if (res.status !== 200) {
          throw new Error(`Firestore Error (${res.status}): ${JSON.stringify(json.error || json)}`);
        }
        return json;
      };

      // 2. アクションごとの処理

      // LOGIN: パスワード照合
      if (action === 'login') {
        const officeId = formData.get('office');
        const password = formData.get('password');
        const json = await firestoreFetch(`offices/${officeId}`);
        const f = json.fields || {};

        let role = '';
        if (password === f.adminPassword?.stringValue) role = 'officeAdmin';
        else if (password === f.password?.stringValue) role = 'user';
        else return new Response(JSON.stringify({ error: 'unauthorized' }), { headers: corsHeaders });

        return new Response(JSON.stringify({
          ok: true,
          role,
          office: officeId,
          officeName: f.name?.stringValue || officeId
        }), { headers: corsHeaders });
      }

      // getConfig: 名簿構造の取得（最重要）
      if (action === 'getConfig') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const json = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);

        const members = (json.documents || []).map(doc => {
          const f = doc.fields || {};
          return {
            id: doc.name.split('/').pop(),
            name: f.name?.stringValue || '',
            group: f.group?.stringValue || '',
            order: Number(f.order?.integerValue || f.order?.doubleValue || 0),
            status: f.status?.stringValue || '',
            time: f.time?.stringValue || '',
            note: f.note?.stringValue || '',
            workHours: f.workHours?.stringValue || ''
          };
        });

        // グループ分け
        const groupsMap = {};
        members.sort((a, b) => a.order - b.order).forEach(m => {
          if (!groupsMap[m.group]) groupsMap[m.group] = { title: m.group, members: [] };
          groupsMap[m.group].members.push(m);
        });

        const updatedCandidates = (json.documents || [])
          .map(doc => doc.updateTime)
          .filter(Boolean)
          .map(v => Date.parse(v))
          .filter(v => Number.isFinite(v));
        const updated = updatedCandidates.length ? Math.max(...updatedCandidates) : Date.now();

        return new Response(JSON.stringify({
          ok: true,
          groups: Object.values(groupsMap),
          updated
        }), { headers: corsHeaders });
      }

      // get: ステータスのみ取得
      if (action === 'get') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const json = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);
        const dataMap = {};
        (json.documents || []).forEach(doc => {
          const f = doc.fields || {};
          dataMap[doc.name.split('/').pop()] = {
            status: f.status?.stringValue || '',
            time: f.time?.stringValue || '',
            note: f.note?.stringValue || '',
            workHours: f.workHours?.stringValue || ''
          };
        });
        return new Response(JSON.stringify({ ok: true, data: dataMap }), { headers: corsHeaders });
      }

      // set: ステータス更新
      if (action === 'set') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const updates = JSON.parse(formData.get('data')).data || {};

        const promises = Object.keys(updates).map(async (userId) => {
          const s = updates[userId];
          const url = `${baseUrl}/offices/${officeId}/members/${userId}?updateMask.fieldPaths=status&updateMask.fieldPaths=time&updateMask.fieldPaths=note&updateMask.fieldPaths=workHours`;
          return fetch(url, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                status: { stringValue: s.status || '' },
                time: { stringValue: s.time || '' },
                note: { stringValue: s.note || '' },
                workHours: { stringValue: s.workHours || '' }
              }
            })
          });
        });
        await Promise.all(promises);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      // getNotices: お知らせ取得
      if (action === 'getNotices') {
        const officeId = formData.get('tokenOffice') || 'nagoya_chuo';
        const json = await firestoreFetch(`offices/${officeId}/notices?pageSize=50`);
        const notices = (json.documents || []).map(doc => {
          const f = doc.fields || {};
          return { id: doc.name.split('/').pop(), title: f.title?.stringValue || '', content: f.content?.stringValue || '' };
        });
        return new Response(JSON.stringify({ ok: true, notices }), { headers: corsHeaders });
      }

      // publicListOffices: 拠点一覧
      if (action === 'publicListOffices') {
        const json = await firestoreFetch(`offices`);
        const offices = (json.documents || []).map(doc => ({
          id: doc.name.split('/').pop(),
          name: doc.fields?.name?.stringValue || doc.name.split('/').pop()
        }));
        return new Response(JSON.stringify({ ok: true, offices }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'unknown_action' }), { headers: corsHeaders });

    } catch (e) {
      // ★エラーが起きた場合、その内容をブラウザに返す
      return new Response(JSON.stringify({ error: e.message, ok: false }), { status: 500, headers: corsHeaders });
    }
  }
};

// --- Google Auth ---
async function getGoogleAuthToken(env) {
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const binaryDer = Uint8Array.from(atob(pem.split('-----')[2].replace(/\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binaryDer.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(JSON.stringify({ iss: clientEmail, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const strSig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.${strSig}`
  });
  return (await res.json()).access_token;
}
