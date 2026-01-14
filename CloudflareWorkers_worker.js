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
      const firestoreFetchOptional = async (path) => {
        const url = `${baseUrl}/${path}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 404) return null;
        const json = await res.json();
        if (res.status !== 200) {
          throw new Error(`Firestore Error (${res.status}): ${JSON.stringify(json.error || json)}`);
        }
        return json;
      };
      const firestorePatch = async (path, body, updateMask = []) => {
        const params = updateMask.length
          ? `?${updateMask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}`
          : '';
        const url = `${baseUrl}/${path}${params}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        if (res.status !== 200) {
          throw new Error(`Firestore Error (${res.status}): ${JSON.stringify(json.error || json)}`);
        }
        return json;
      };
      const firestoreDelete = async (path) => {
        const url = `${baseUrl}/${path}`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.status !== 200) {
          const json = await res.json();
          throw new Error(`Firestore Error (${res.status}): ${JSON.stringify(json.error || json)}`);
        }
        return true;
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
            workHours: f.workHours?.stringValue || '',
            ext: f.ext?.stringValue || ''
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

      if (action === 'getFor') {
        const officeId = formData.get('office') || formData.get('tokenOffice') || 'nagoya_chuo';
        const json = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);
        const dataMap = {};
        const updatedCandidates = (json.documents || [])
          .map(doc => doc.updateTime)
          .filter(Boolean)
          .map(v => Date.parse(v))
          .filter(v => Number.isFinite(v));
        const updated = updatedCandidates.length ? Math.max(...updatedCandidates) : Date.now();
        (json.documents || []).forEach(doc => {
          const f = doc.fields || {};
          dataMap[doc.name.split('/').pop()] = {
            status: f.status?.stringValue || '',
            time: f.time?.stringValue || '',
            note: f.note?.stringValue || '',
            workHours: f.workHours?.stringValue || '',
            ext: f.ext?.stringValue || ''
          };
        });
        return new Response(JSON.stringify({ updated, data: dataMap }), { headers: corsHeaders });
      }

      if (action === 'getConfigFor') {
        const officeId = formData.get('office') || formData.get('tokenOffice') || 'nagoya_chuo';
        const cfgDoc = await firestoreFetchOptional(`offices/${officeId}/config`);
        let cfgFromDoc = null;
        if (cfgDoc) {
          cfgFromDoc = normalizeConfig(fromFirestoreDoc(cfgDoc));
          const hasMembers = (cfgFromDoc.groups || []).some(g => (g.members || []).length > 0);
          if (hasMembers) {
            return new Response(JSON.stringify(cfgFromDoc), { headers: corsHeaders });
          }
        }
        const json = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);
        const members = (json.documents || []).map(doc => {
          const f = doc.fields || {};
          return {
            id: doc.name.split('/').pop(),
            name: f.name?.stringValue || '',
            group: f.group?.stringValue || '',
            order: Number(f.order?.integerValue || f.order?.doubleValue || 0),
            ext: f.ext?.stringValue || '',
            mobile: f.mobile?.stringValue || '',
            email: f.email?.stringValue || '',
            workHours: f.workHours?.stringValue || ''
          };
        });
        const groupsMap = {};
        members.sort((a, b) => a.order - b.order).forEach(m => {
          if (!groupsMap[m.group]) groupsMap[m.group] = { title: m.group, members: [] };
          groupsMap[m.group].members.push({
            id: m.id,
            name: m.name,
            ext: m.ext,
            mobile: m.mobile,
            email: m.email,
            workHours: m.workHours
          });
        });
        const updatedCandidates = (json.documents || [])
          .map(doc => doc.updateTime)
          .filter(Boolean)
          .map(v => Date.parse(v))
          .filter(v => Number.isFinite(v));
        const updatedFromMembers = updatedCandidates.length ? Math.max(...updatedCandidates) : Date.now();
        const merged = {
          groups: Object.values(groupsMap),
          updated: cfgFromDoc ? Math.max(cfgFromDoc.updated || 0, updatedFromMembers) : updatedFromMembers,
          menus: cfgFromDoc?.menus || undefined
        };
        const cfg = normalizeConfig(merged);
        return new Response(JSON.stringify(cfg), { headers: corsHeaders });
      }

      if (action === 'setConfigFor') {
        const officeId = formData.get('office') || formData.get('tokenOffice') || 'nagoya_chuo';
        let incoming;
        try {
          incoming = JSON.parse(formData.get('data') || '{}') || {};
        } catch (e) {
          return new Response(JSON.stringify({ error: 'bad_json' }), { headers: corsHeaders });
        }
        const nowTs = Date.now();
        const parsed = normalizeConfig({ ...incoming, updated: nowTs });
        const configFields = {
          version: toFirestoreValue(parsed.version),
          updated: toFirestoreValue(parsed.updated),
          groups: toFirestoreValue(parsed.groups || []),
          menus: toFirestoreValue(parsed.menus || {})
        };
        await firestorePatch(`offices/${officeId}/config`, { fields: configFields });

        const desiredIds = new Set();
        let order = 0;
        const memberWrites = [];
        (parsed.groups || []).forEach(group => {
          const title = group.title || '';
          (group.members || []).forEach(member => {
            const id = String(member.id || '').trim();
            if (!id) return;
            desiredIds.add(id);
            order += 1;
            const fields = {
              name: toFirestoreValue(member.name || ''),
              group: toFirestoreValue(title),
              order: toFirestoreValue(order),
              ext: toFirestoreValue(member.ext || ''),
              mobile: toFirestoreValue(member.mobile || ''),
              email: toFirestoreValue(member.email || ''),
              workHours: toFirestoreValue(member.workHours == null ? '' : String(member.workHours))
            };
            memberWrites.push(
              firestorePatch(`offices/${officeId}/members/${encodeURIComponent(id)}`, {
                fields
              }, ['name', 'group', 'order', 'ext', 'mobile', 'email', 'workHours'])
            );
          });
        });
        await Promise.all(memberWrites);

        const existing = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);
        const deletions = (existing.documents || [])
          .map(doc => doc.name.split('/').pop())
          .filter(id => id && !desiredIds.has(id))
          .map(id => firestoreDelete(`offices/${officeId}/members/${encodeURIComponent(id)}`));
        await Promise.all(deletions);

        return new Response(JSON.stringify(parsed), { headers: corsHeaders });
      }

      if (action === 'setFor') {
        const officeId = formData.get('office') || formData.get('tokenOffice') || 'nagoya_chuo';
        let incoming;
        try {
          incoming = JSON.parse(formData.get('data') || '{}') || {};
        } catch (e) {
          return new Response(JSON.stringify({ error: 'bad_json' }), { headers: corsHeaders });
        }
        const incomingData = incoming.data || {};
        const full = !!incoming.full;

        if (full) {
          const existing = await firestoreFetch(`offices/${officeId}/members?pageSize=300`);
          const incomingIds = new Set(Object.keys(incomingData));
          const clears = (existing.documents || [])
            .map(doc => doc.name.split('/').pop())
            .filter(id => id && !incomingIds.has(id))
            .map(id => firestorePatch(`offices/${officeId}/members/${encodeURIComponent(id)}`, {
              fields: {
                status: toFirestoreValue(''),
                time: toFirestoreValue(''),
                note: toFirestoreValue(''),
                workHours: toFirestoreValue('')
              }
            }, ['status', 'time', 'note', 'workHours']));
          await Promise.all(clears);
        }

        const updates = Object.keys(incomingData).map(async (userId) => {
          const s = incomingData[userId] || {};
          const fields = {
            status: toFirestoreValue(s.status == null ? '' : String(s.status)),
            time: toFirestoreValue(s.time == null ? '' : String(s.time)),
            note: toFirestoreValue(s.note == null ? '' : String(s.note))
          };
          const updateMask = ['status', 'time', 'note'];
          if (Object.prototype.hasOwnProperty.call(s, 'workHours')) {
            fields.workHours = toFirestoreValue(s.workHours == null ? '' : String(s.workHours));
            updateMask.push('workHours');
          }
          if (Object.prototype.hasOwnProperty.call(s, 'ext')) {
            fields.ext = toFirestoreValue(s.ext == null ? '' : String(s.ext));
            updateMask.push('ext');
          }
          return firestorePatch(`offices/${officeId}/members/${encodeURIComponent(userId)}`,
            { fields },
            updateMask
          );
        });
        await Promise.all(updates);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
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

function defaultMenus() {
  return {
    timeStepMinutes: 30,
    statuses: [
      { value: "在席", class: "st-here", clearOnSet: true },
      { value: "外出", requireTime: true, class: "st-out" },
      { value: "在宅勤務", class: "st-remote", clearOnSet: true },
      { value: "出張", requireTime: true, class: "st-trip" },
      { value: "研修", requireTime: true, class: "st-training" },
      { value: "健康診断", requireTime: true, class: "st-health" },
      { value: "コアドック", requireTime: true, class: "st-coadoc" },
      { value: "帰宅", class: "st-home", clearOnSet: true },
      { value: "休み", class: "st-off", clearOnSet: true }
    ],
    noteOptions: ["直出", "直帰", "直出・直帰"],
    businessHours: [
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
    ]
  };
}

function normalizeConfig(cfg) {
  const groupsSrc = Array.isArray(cfg?.groups) ? cfg.groups : [];
  return {
    version: 2,
    updated: Number(cfg?.updated || 0),
    groups: groupsSrc.map(g => {
      const members = Array.isArray(g?.members) ? g.members : [];
      return {
        title: String(g?.title || ''),
        members: members.map(m => ({
          id: String(m?.id || '').trim(),
          name: String(m?.name || ''),
          ext: String(m?.ext || ''),
          mobile: String(m?.mobile || ''),
          email: String(m?.email || ''),
          workHours: m?.workHours == null ? '' : String(m.workHours)
        })).filter(m => m.id || m.name)
      };
    }),
    menus: (cfg?.menus && typeof cfg.menus === 'object') ? cfg.menus : defaultMenus()
  };
}

function fromFirestoreDoc(doc) {
  const fields = doc?.fields || {};
  const out = {};
  Object.keys(fields).forEach(key => {
    out[key] = fromFirestoreValue(fields[key]);
  });
  return out;
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    const values = value.arrayValue.values || [];
    return values.map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    const fields = value.mapValue.fields || {};
    const out = {};
    Object.keys(fields).forEach(key => {
      out[key] = fromFirestoreValue(fields[key]);
    });
    return out;
  }
  return null;
}

function toFirestoreValue(value) {
  if (value == null) return { nullValue: null };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'object') {
    const fields = {};
    Object.keys(value).forEach(key => {
      fields[key] = toFirestoreValue(value[key]);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}
