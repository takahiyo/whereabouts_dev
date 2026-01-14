/** 在席確認表 API（Apps Script）CAS対応・拠点別メニュー設定
 *  - 認証：ユーザー / 拠点管理者
 *  - データ：ScriptProperties(JSON) に保存（既存データ互換）
 *  - キャッシュ：CacheService（短期）
 *  - 競合制御：各レコードに rev / serverUpdated を付与（厳格CASはプロパティでON）
 *  - 互換性：既存データに rev/serverUpdated が無くても返却時に補完
 *
 * フロントからの主API：
 *  publicListOffices, login, renew, get, set, getConfig,
 *  listOffices, getFor, getConfigFor, setFor, renameOffice,
 *  setOfficePassword
 */

/* ===== 設定 ===== */
const TOKEN_TTL_MS   = 60 * 60 * 1000;  // 1時間
const CACHE_TTL_SEC  = 20;              // 20秒
const MAX_SET_BYTES  = 120 * 1024;      // set payload サイズ制限
const MAX_NOTICES_PER_OFFICE = 100;     // お知らせ最大件数
const MAX_EVENT_COLOR_ENTRIES = 400;    // 日付カラーの上限件数
const MAX_TOOLS_PER_OFFICE = 300;       // ツール最大件数

const EVENT_COLOR_KEYS = ['amber','blue','green','pink','purple','teal','gray'];

/* ===== ScriptProperties キー ===== */
const KEY_PREFIX          = 'presence:';
const OFFICES_KEY         = KEY_PREFIX + 'OFFICES_JSON';     // 拠点一覧（id→{name,password,adminPassword}）

const TOKEN_PREFIX         = 'tok_';
const TOKEN_OFFICE_PREFIX  = 'toff_';
const TOKEN_ROLE_PREFIX    = 'trole_';

/* ===== ユーティリティ ===== */
const CTL_RE = /[\u0000-\u001F\u007F]/g;
function now_(){ return Date.now(); }
function json_(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function p_(e, k, d){ return (e && e.parameter && e.parameter[k] != null) ? String(e.parameter[k]) : d; }

/* ===== データ保存キー ===== */
function dataKeyForOffice_(office){ return `presence-board-${office}`; }
function configKeyForOffice_(office){ return `presence-config-${office}`; }
function noticesKeyForOffice_(office){ return `presence-notices-${office}`; }
function vacationsKeyForOffice_(office){ return `presence-vacations-${office}`; }
function eventColorsKeyForOffice_(office){ return `presence-event-colors-${office}`; }
function toolsKeyForOffice_(office){ return `presence-tools-${office}`; }

/* ===== 拠点一覧（初期値） ===== */
const DEFAULT_OFFICES = {};
function getOffices_(){
  const prop = PropertiesService.getScriptProperties();
  const v = prop.getProperty(OFFICES_KEY);
  if(!v){
    prop.setProperty(OFFICES_KEY, JSON.stringify(DEFAULT_OFFICES));
    return JSON.parse(JSON.stringify(DEFAULT_OFFICES));
  }
  try{ return JSON.parse(v); }catch(e){
    return JSON.parse(JSON.stringify(DEFAULT_OFFICES));
  }
}
function setOffices_(obj){
  PropertiesService.getScriptProperties().setProperty(OFFICES_KEY, JSON.stringify(obj||{}));
}

/* ===== トークン管理 ===== */
function setToken_(prop, token, office, role){
  prop.setProperty(TOKEN_PREFIX + token, String(now_() + TOKEN_TTL_MS));
  prop.setProperty(TOKEN_OFFICE_PREFIX + token, office);
  prop.setProperty(TOKEN_ROLE_PREFIX + token, role);
}
function checkToken_(prop, token){
  const exp = Number(prop.getProperty(TOKEN_PREFIX + token) || 0);
  return (exp && exp >= now_());
}
function renewToken_(prop, token){
  const ok = checkToken_(prop, token);
  if(ok){ prop.setProperty(TOKEN_PREFIX + token, String(now_() + TOKEN_TTL_MS)); }
  return ok;
}
function getOfficeByToken_(prop, token){ return prop.getProperty(TOKEN_OFFICE_PREFIX + token) || ''; }
function getRoleByToken_(prop, token){ return prop.getProperty(TOKEN_ROLE_PREFIX + token) || 'user'; }
function roleIsOfficeAdmin_(prop, token){
  const role = getRoleByToken_(prop, token);
  return role === 'officeAdmin' || role === 'superAdmin';
}
function canAdminOffice_(prop, token, office){
  const role = getRoleByToken_(prop, token);
  if(role === 'superAdmin') return true;
  const own = getOfficeByToken_(prop, token);
  return role === 'officeAdmin' && own === office;
}

/* ===== CAS厳格化スイッチ（Script Properties） =====
 * presence:CAS_ENFORCE = "1" で厳格CAS（baseRev古いと conflict）
 * 未設定 or "0" なら緩和（常に受理してサーバでrev++）
 */
function getCasEnforce_(){
  try{
    const v = PropertiesService.getScriptProperties().getProperty('presence:CAS_ENFORCE');
    return String(v) === '1';
  }catch(e){ return false; }
}


/* ===== 既定メニュー／設定 ===== */
const DEFAULT_BUSINESS_HOURS = [
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
  "12:00-20:30",
];
function defaultMenus_(){
  return {
    timeStepMinutes: 30,
    statuses: [
      { value: "在席",       class: "st-here",    clearOnSet: true  },
      { value: "外出",       requireTime: true,   class: "st-out"   },
      { value: "在宅勤務",   class: "st-remote",  clearOnSet: true  },
      { value: "出張",       requireTime: true,   class: "st-trip"   },
      { value: "研修",       requireTime: true,   class: "st-training" },
      { value: "健康診断",   requireTime: true,   class: "st-health" },
      { value: "コアドック", requireTime: true,   class: "st-coadoc" },
      { value: "帰宅",       class: "st-home",    clearOnSet: true  },
      { value: "休み",       class: "st-off",     clearOnSet: true  }
      ],
    noteOptions: ["直出","直帰","直出・直帰"],
    businessHours: DEFAULT_BUSINESS_HOURS.slice()
  };
}
function defaultConfig_(){
  return { version: 2, updated: 0, groups: [], menus: defaultMenus_() };
}
function normalizeConfig_(cfg){
  if(!cfg || typeof cfg !== 'object') return defaultConfig_();
  const groups = Array.isArray(cfg.groups) ? cfg.groups : [];
  const out = {
    version: 2,
    updated: Number(cfg.updated || 0),
    groups: groups.map(g=>{
      const members = Array.isArray(g.members) ? g.members : [];
      return {
        title: String(g.title || ''),
        members: members.map(m=>({
          id:        String(m.id || '').trim(),
          name:      String(m.name || ''),
          ext:       String(m.ext || ''),
          mobile:    String(m.mobile || ''),
          email:     String(m.email || ''),
          workHours: m.workHours == null ? '' : String(m.workHours)
        })).filter(m=>m.id || m.name)
      };
    }),
    menus: (cfg.menus && typeof cfg.menus === 'object') ? cfg.menus : defaultMenus_()
  };
  return out;
}

function coerceNoticeArray_(src){
  if(src == null) return [];
  if(Array.isArray(src)) return src;
  if(typeof src === 'string'){
    const trimmed = src.trim();
    if(!trimmed) return [];
    if(trimmed[0] === '[' || trimmed[0] === '{'){
      try{ return coerceNoticeArray_(JSON.parse(trimmed)); }catch(_){ /* fallthrough */ }
    }
    return [ trimmed ];
  }
  if(typeof src === 'object'){
    if(Array.isArray(src.list)) return src.list;
    if(Array.isArray(src.items)) return src.items;
    return Object.keys(src).sort().map(k=>src[k]).filter(v=>v!=null);
  }
  return [];
}

function coerceNoticeVisibleFlag_(raw){
  if(raw === false) return false;
  if(raw === true || raw == null) return true;
  const s = String(raw).toLowerCase();
  return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
}

function coerceToolArray_(raw){
  if(raw == null) return [];
  if(Array.isArray(raw)) return raw;
  if(typeof raw === 'string'){
    const trimmed = raw.trim();
    if(!trimmed) return [];
    if(trimmed[0] === '[' || trimmed[0] === '{'){
      try{ return coerceToolArray_(JSON.parse(trimmed)); }catch(_){ /* fallthrough */ }
    }
    return [ trimmed ];
  }
  if(typeof raw === 'object'){
    if(Array.isArray(raw.list)) return raw.list;
    if(Array.isArray(raw.items)) return raw.items;
    return Object.keys(raw).sort().map(k=> raw[k]).filter(v=> v != null);
  }
  return [];
}

function coerceToolVisibleFlag_(raw){
  if(raw === true || raw == null) return true;
  if(raw === false) return false;
  const s = String(raw).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
}

function ensureUniqueToolId_(ctx, preferred){
  let base = (preferred == null ? '' : String(preferred)).trim();
  if(!base){ base = 'tool_' + ctx.seq; ctx.seq += 1; }
  let id = base;
  let i = 1;
  while(ctx.seen.has(id)){
    id = base + '_' + i;
    i += 1;
  }
  ctx.seen.add(id);
  return id;
}

function normalizeToolItem_(raw, ctx, parentId){
  if(raw == null) return null;
  if(typeof raw === 'string'){
    const text = raw.trim();
    if(!text) return null;
    const id = ensureUniqueToolId_(ctx, 'tool_' + ctx.seq);
    return { id, title: text, url:'', note:'', visible:true, display:true, parentId: parentId||'', children: [] };
  }
  if(typeof raw !== 'object') return null;

  const idRaw = raw.id ?? raw.toolId ?? raw.key;
  const id = ensureUniqueToolId_(ctx, idRaw);
  const titleSrc = raw.title ?? raw.name ?? raw.label ?? '';
  const urlSrc = raw.url ?? raw.link ?? '';
  const noteSrc = raw.note ?? raw.memo ?? raw.remark ?? '';
  const visible = coerceToolVisibleFlag_(raw.visible ?? raw.display ?? raw.show ?? true);
  const parentSrc = raw.parentId != null ? String(raw.parentId) : '';
  const titleStr = String(titleSrc || '').trim();
  const urlStr = String(urlSrc || '').trim();
  const noteStr = String(noteSrc || '').trim();
  const parent = parentSrc.trim() || parentId || '';
  const node = {
    id,
    title: titleStr || urlStr || id,
    url: urlStr,
    note: noteStr,
    visible,
    display: visible,
    parentId: parent,
    children: []
  };
  const childrenRaw = coerceToolArray_(raw.children ?? raw.items ?? []);
  childrenRaw.forEach(child => {
    const c = normalizeToolItem_(child, ctx, id);
    if(c){ ctx.nodes.push(c); }
  });
  return node;
}

function normalizeToolsArray_(raw){
  const arr = coerceToolArray_(raw);
  const ctx = { seq: 0, seen: new Set(), nodes: [], warnings: [] };

  arr.forEach(item=>{
    const n = normalizeToolItem_(item, ctx, '');
    if(n){ ctx.nodes.push(n); }
  });

  const filtered = ctx.nodes.filter(n => n && (n.title || n.url || n.note));
  const map = new Map();
  filtered.forEach(n=>{ n.children = []; map.set(n.id, n); });

  filtered.forEach(n=>{
    let pid = n.parentId || '';
    if(pid && (!map.has(pid) || pid === n.id)){
      if(pid === n.id){ ctx.warnings.push(`ツール ${n.id} が自身を親にしていたためルートに移動しました`); }
      if(!map.has(pid)){ ctx.warnings.push(`ツール ${n.id} の親 ${pid} が存在しないためルートに移動しました`); }
      pid = '';
    }
    n.parentId = pid;
  });

  filtered.forEach(n=>{
    const visited = new Set();
    let pid = n.parentId;
    while(pid){
      if(visited.has(pid)){
        ctx.warnings.push(`ツール ${n.id} の親子関係に循環が見つかったためルートに移動しました`);
        n.parentId = '';
        break;
      }
      visited.add(pid);
      const p = map.get(pid);
      if(!p){ n.parentId = ''; break; }
      pid = p.parentId;
    }
  });

  filtered.forEach(n=>{
    if(n.parentId && map.has(n.parentId)){
      map.get(n.parentId).children.push(n);
    }
  });

  const roots = filtered.filter(n => !n.parentId);
  let count = 0;
  function prune(list){
    const out = [];
    list.forEach(item=>{
      if(count >= MAX_TOOLS_PER_OFFICE){ return; }
      count += 1;
      if(item.children && item.children.length){
        item.children = prune(item.children);
      }
      out.push(item);
    });
    return out;
  }
  const pruned = prune(roots);
  if(count < filtered.length){
    ctx.warnings.push(`ツールが${MAX_TOOLS_PER_OFFICE}件を超えたため、超過分を省略しました`);
  }

  return { list: pruned, warnings: ctx.warnings };
}

function filterVisibleTools_(list){
  if(!Array.isArray(list)) return [];
  const out = [];
  list.forEach(item=>{
    if(!item) return;
    const visible = coerceToolVisibleFlag_(item.visible != null ? item.visible : (item.display != null ? item.display : true));
    if(!visible) return;
    const copy = Object.assign({}, item);
    copy.children = filterVisibleTools_(item.children || []);
    out.push(copy);
  });
  return out;
}

function coerceVacationVisibleFlag_(raw){
  if(raw === true) return true;
  if(raw === false) return false;
  if(typeof raw === 'number') return raw !== 0;
  if(typeof raw === 'string'){
    const s = raw.trim().toLowerCase();
    if(!s) return false;
    return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
  }
  return false;
}

function coerceVacationTypeFlag_(raw){
  if(raw === true) return true;
  if(raw === false) return false;
  if(typeof raw === 'string'){
    const s = raw.trim().toLowerCase();
    if(!s) return true;
    return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
  }
  if(typeof raw === 'number') return raw !== 0;
  return true;
}

function normalizeDateStr_(str){
  if(!str) return '';
  const d = new Date(str);
  if(Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = `${d.getMonth()+1}`.padStart(2,'0');
  const day = `${d.getDate()}`.padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function normalizeEventColorKey_(raw){
  const s = String(raw || '').trim().toLowerCase();
  return EVENT_COLOR_KEYS.includes(s) ? s : '';
}

function normalizeEventColorMap_(raw){
  const source = (raw && typeof raw === 'object' && raw.colors && typeof raw.colors === 'object')
    ? raw.colors
    : (raw && typeof raw === 'object' ? raw : {});
  const out = { colors:{}, updated: Number(raw && raw.updated || 0) || 0 };
  Object.keys(source || {}).sort().slice(0, MAX_EVENT_COLOR_ENTRIES).forEach(date => {
    const normalizedDate = normalizeDateStr_(date);
    const colorKey = normalizeEventColorKey_(source[date]);
    if(normalizedDate && colorKey){
      out.colors[normalizedDate] = colorKey;
    }
  });
  if(!out.updated){
    out.updated = now_();
  }
  return out;
}

function normalizeVacationItem_(raw, office){
  if(raw == null) return null;
  const id = String(raw.id || raw.vacationId || '').trim();
  const title = String(raw.title || raw.subject || '').substring(0, 200);
  const startDate = String(raw.startDate || raw.start || raw.from || '').trim();
  const endDate = String(raw.endDate || raw.end || raw.to || '').trim();
  const noticeId = String(raw.noticeId || raw.noticeKey || '').trim();
  const noticeTitle = String(raw.noticeTitle || '').substring(0, 200);
  const note = String(raw.note || raw.memo || noticeTitle || '').substring(0, 2000);
  const membersBits = String(raw.membersBits || raw.bits || '').trim();
  const visible = coerceVacationVisibleFlag_(raw.visible);
  const isVacation = coerceVacationTypeFlag_(raw.isVacation);
  const color = String(raw.color || raw.eventColor || 'amber').trim() || 'amber';
  const orderRaw = Number(raw.order || raw.sortOrder || raw.position || 0);
  const order = Number.isFinite(orderRaw) && orderRaw > 0 ? orderRaw : 0;
  const updated = Number(raw.updated || raw.serverUpdated || 0) || now_();
  return { id, office: String(raw.office || office || ''), title, startDate, endDate, note, noticeId, noticeTitle, membersBits, updated, visible, isVacation, color, order };
}

function normalizeNoticeItem_(raw){
  if(raw == null) return null;
  if(typeof raw === 'string'){
    const text = raw.trim();
    if(!text) return null;
    return { title: text.substring(0, 200), content: '', display: true, visible: true };
  }
  if(Array.isArray(raw)){
    const title = raw[0] == null ? '' : String(raw[0]).substring(0, 200);
    const content = raw[1] == null ? '' : String(raw[1]).substring(0, 2000);
    if(!title.trim() && !content.trim()) return null;
    return { title, content, display: true, visible: true };
  }
  if(typeof raw !== 'object') return null;
  const id = raw.id != null ? raw.id : (raw.noticeId != null ? raw.noticeId : (raw.uid != null ? raw.uid : undefined));
  const titleSrc = raw.title != null ? raw.title : (raw.subject != null ? raw.subject : raw.headline);
  const contentSrc = raw.content != null ? raw.content : (raw.body != null ? raw.body : (raw.text != null ? raw.text : raw.description));
  const title = titleSrc == null ? '' : String(titleSrc).substring(0, 200);
  const content = contentSrc == null ? '' : String(contentSrc).substring(0, 2000);
  const visible = coerceNoticeVisibleFlag_(raw.visible != null ? raw.visible : (raw.display != null ? raw.display : (raw.show != null ? raw.show : true)));
  if(!title.trim() && !content.trim()) return null;
  const result = { title, content, display: visible, visible: visible };
  if(id != null) result.id = id;
  return result;
}

function normalizeNoticesArray_(raw){
  const arr = coerceNoticeArray_(raw);
  const normalized = arr.map(normalizeNoticeItem_).filter(Boolean);
  if(normalized.length > MAX_NOTICES_PER_OFFICE){
    return normalized.slice(0, MAX_NOTICES_PER_OFFICE);
  }
  return normalized;
}

function notifyConfigPush_(office){
  CacheService.getScriptCache().put(KEY_PREFIX + 'cfgpush:' + office, String(now_()), CACHE_TTL_SEC);
}


function adminSetConfigFor(office, cfg){
  const prop = PropertiesService.getScriptProperties();
  const parsed = normalizeConfig_(cfg);
  parsed.updated = now_();
  const CONFIG_KEY = configKeyForOffice_(office);
  const out = JSON.stringify(parsed);
  prop.setProperty(CONFIG_KEY, out);
  CacheService.getScriptCache().put(KEY_PREFIX+'cfg:'+office, out, CACHE_TTL_SEC);
  notifyConfigPush_(office);
  return parsed;
}

function syncStatuses(){
  const prop = PropertiesService.getScriptProperties();
  const defStatuses = defaultMenus_().statuses;
  const defJson = JSON.stringify(defStatuses);
  (prop.getKeys() || []).filter(k=>k.indexOf('presence-config-')===0).forEach(k=>{
    let cfg; try{ cfg = JSON.parse(prop.getProperty(k) || '') || {}; }catch(_){ cfg = {}; }
    const curJson = JSON.stringify((cfg.menus && cfg.menus.statuses) || []);
    if(curJson !== defJson){
      cfg.menus = cfg.menus || {};
      cfg.menus.statuses = defStatuses;
      const office = k.replace('presence-config-','');
      adminSetConfigFor(office, cfg);
    }
  });
}

/* ===== メイン ===== */
function doPost(e){
  const action = p_(e, 'action', '');
  const prop   = PropertiesService.getScriptProperties();
  const cache  = CacheService.getScriptCache();
  syncStatuses();

  /* --- 無認証API --- */
  if(action === 'publicListOffices'){
    const offs = getOffices_();
    const offices = Object.keys(offs).map(id => ({ id, name: offs[id].name }));
    return json_({ offices });
  }
  if(action === 'login'){
    const office = p_(e,'office','');
    const offs = getOffices_();
    if(!office || !offs[office]) return json_({ error:'unauthorized' });
    const pw = p_(e,'password','');
    if(!pw) return json_({ error:'unauthorized' });
    let role = '';
    if(pw === String(offs[office].adminPassword || '')){
      role = (office === 'admin') ? 'superAdmin' : 'officeAdmin';
    }else if(pw === String(offs[office].password || '')) role = 'user';
    else return json_({ error:'unauthorized' });
    const token = Utilities.getUuid().replace(/-/g,'');
    setToken_(prop, token, office, role);
    return json_({ token, role, office, officeName:offs[office].name, exp: TOKEN_TTL_MS });
  }
  if(action === 'renew'){
    const token = p_(e,'token','');
    if(!renewToken_(prop, token)) return json_({ error:'unauthorized' });
    const offs = getOffices_();
    const office = getOfficeByToken_(prop, token);
    const officeName = office && offs[office] ? offs[office].name : '';
    return json_({ ok:true, role:getRoleByToken_(prop, token), office, officeName, exp:TOKEN_TTL_MS });
  }

  /* --- ここから認証必須 --- */
  const token = p_(e,'token','');
  if(!checkToken_(prop, token)) return json_({ error:'unauthorized' });
  const tokenOffice = getOfficeByToken_(prop, token);
  if(!tokenOffice) return json_({ error:'unauthorized' });

  /* ===== ユーザAPI ===== */
  if(action === 'get'){
    const office = tokenOffice;
    const DATA_KEY = dataKeyForOffice_(office);
    const noCache  = p_(e,'nocache','') === '1';
    const cKey     = KEY_PREFIX + 'data:' + office;

    const hit = noCache ? null : cache.get(cKey);
    if(hit){ try{ return json_(JSON.parse(hit)); }catch(_){ /* fallthrough */ } }

    let obj;
    try{ obj = JSON.parse(prop.getProperty(DATA_KEY) || '') || { updated:0, data:{} }; }
    catch(_){ obj = { updated:0, data:{} }; }

    // 互換補完：各レコードに rev / serverUpdated を付与（なければ）
    const nowTs = now_();
    if(obj && obj.data && typeof obj.data === 'object'){
      Object.keys(obj.data).forEach(id=>{
        const r = obj.data[id] || {};
        if(typeof r.rev !== 'number') r.rev = 1;
        if(typeof r.serverUpdated !== 'number') r.serverUpdated = nowTs;
        obj.data[id] = r;
      });
    }

    const out = JSON.stringify(obj);
    if(!noCache) cache.put(cKey, out, CACHE_TTL_SEC);
    return json_(obj);
  }

  if(action === 'set'){
    const office = tokenOffice;
    const DATA_KEY = dataKeyForOffice_(office);

    const raw = p_(e,'data','{"updated":0,"data":{}}');
    if(raw && raw.length > MAX_SET_BYTES) return json_({ error:'too_large' });

    let incoming;
    try{
      incoming = JSON.parse(raw);
      if(!incoming || typeof incoming !== 'object' || typeof incoming.data !== 'object'){
        return json_({ error:'bad_data' });
      }
    }catch(_){ return json_({ error:'bad_json' }); }

    let baseRev = {};
    try{ baseRev = JSON.parse(p_(e,'baseRev','{}')) || {}; }catch(_){ baseRev = {}; }

    const enforce = getCasEnforce_();

    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      let cur;
      try{ cur = JSON.parse(prop.getProperty(DATA_KEY) || '') || { updated:0, data:{} }; }
      catch(_){ cur = { updated:0, data:{} }; }

      const outData = Object.assign({}, cur.data || {});
      const nowTs = now_();
      const conflicts = [];
      const revMap = {};
      const tsMap  = {};

      Object.keys(incoming.data).forEach(id=>{
        const client = incoming.data[id] || {};
        const prev   = outData[id] || {};
        const prevRev = (typeof prev.rev === 'number') ? prev.rev : 0;
        const clientBase = Number(baseRev[id] || 0);

        if(enforce && clientBase < prevRev){
          conflicts.push({ id, server: prev });
          return;
        }
        const nextRev = prevRev + 1; // 緩和/厳格いずれでもサーバ採番
        const hasWorkHours = Object.prototype.hasOwnProperty.call(client, 'workHours');
        let workHoursValue = prev.workHours;
        if(hasWorkHours){
          workHoursValue = client.workHours == null ? '' : String(client.workHours);
        }

        const rec = {
          ext:   client.ext   == null ? '' : String(client.ext),
          status:client.status== null ? '' : String(client.status),
          workHours: workHoursValue,
          time:  client.time  == null ? '' : String(client.time),
          note:  client.note  == null ? '' : String(client.note),
          rev: nextRev,
          serverUpdated: nowTs
        };
        outData[id] = rec;
        revMap[id] = nextRev;
        tsMap[id]  = nowTs;
      });

      if(enforce && conflicts.length){
        return json_({ error:'conflict', conflicts, rev:revMap, serverUpdated:tsMap });
      }

      const out = { updated: nowTs, data: outData };
      prop.setProperty(DATA_KEY, JSON.stringify(out));
      CacheService.getScriptCache().put(KEY_PREFIX+'data:'+office, JSON.stringify(out), CACHE_TTL_SEC);
      return json_({ ok:true, rev:revMap, serverUpdated:tsMap, conflicts: conflicts.length ? conflicts : undefined });
    } finally {
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  if(action === 'getConfig'){
    const office = tokenOffice;
    const CONFIG_KEY = configKeyForOffice_(office);
    const noCache = p_(e,'nocache','') === '1';
    const cKey = KEY_PREFIX + 'cfg:' + office;

    const hit = noCache ? null : cache.get(cKey);
    if(hit){ try{ return json_(JSON.parse(hit)); }catch(_){ /* fallthrough */ } }

    let cfg;
    try{ cfg = JSON.parse(prop.getProperty(CONFIG_KEY) || '') || defaultConfig_(); }
    catch(_){ cfg = defaultConfig_(); }
    const parsed = normalizeConfig_(cfg);
    if(!parsed.updated) parsed.updated = now_();

    const out = JSON.stringify(parsed);
    if(!noCache) cache.put(cKey, out, CACHE_TTL_SEC);
    return json_(parsed);
  }

  /* ===== 管理API ===== */
  if(action === 'listOffices'){
    const offs = getOffices_();
    const role = getRoleByToken_(prop, token);
    if(role === 'superAdmin'){
      const offices = Object.keys(offs).map(id => ({ id, name: offs[id].name }));
      return json_({ offices });
    }
    const id = tokenOffice;
    return json_({ offices: [{ id, name: offs[id].name }] });
  }

  if(action === 'getFor'){
    const office = p_(e,'office', tokenOffice);
    if(!canAdminOffice_(prop, token, office)) return json_({ error:'forbidden' });
    const DATA_KEY = dataKeyForOffice_(office);
    let obj;
    try{ obj = JSON.parse(prop.getProperty(DATA_KEY) || '') || { updated:0, data:{} }; }
    catch(_){ obj = { updated:0, data:{} }; }
    return json_(obj);
  }

  if(action === 'getConfigFor'){
    const office = p_(e,'office', tokenOffice);
    if(!canAdminOffice_(prop, token, office)) return json_({ error:'forbidden' });
    const CONFIG_KEY = configKeyForOffice_(office);
    let cfg;
    try{ cfg = JSON.parse(prop.getProperty(CONFIG_KEY) || '') || defaultConfig_(); }
    catch(_){ cfg = defaultConfig_(); }
    return json_(normalizeConfig_(cfg));
  }

  if(action === 'setConfigFor'){
    const office = p_(e,'office', tokenOffice);
    if(!canAdminOffice_(prop, token, office)) return json_({ error:'forbidden' });
    let cfg;
    try{ cfg = JSON.parse(p_(e,'data','{}')); }catch(_){ return json_({ error:'bad_json' }); }
    const parsed = adminSetConfigFor(office, cfg);
    return json_(parsed);
  }

  if(action === 'setFor'){
    const office = p_(e,'office', tokenOffice);
    if(!canAdminOffice_(prop, token, office)) return json_({ error:'forbidden' });

    let incoming;
    try{ incoming = JSON.parse(p_(e,'data','{}')) || {}; }catch(_){ return json_({ error:'bad_json' }); }
    const full = !!incoming.full;

    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      const DATA_KEY = dataKeyForOffice_(office);
      let cur; try{ cur = JSON.parse(prop.getProperty(DATA_KEY) || '') || { updated:0, data:{} }; }
      catch(_){ cur = { updated:0, data:{} }; }

      const base = full ? {} : (cur.data || {});
      const outData = Object.assign({}, base);
      const nowTs = now_();

      Object.keys(incoming.data || {}).forEach(id=>{
        const v = incoming.data[id] || {};
        const prev = cur.data && cur.data[id] || {};
        let workHoursValue = prev.workHours;
        if(Object.prototype.hasOwnProperty.call(v, 'workHours')){
          workHoursValue = v.workHours == null ? '' : String(v.workHours);
        }
        const nextRev = (typeof prev.rev === 'number' ? prev.rev : 0) + 1;
        outData[id] = {
          ext:   v.ext   == null ? '' : String(v.ext),
          status:v.status== null ? '' : String(v.status),
          time:  v.time  == null ? '' : String(v.time),
          note:  v.note  == null ? '' : String(v.note),
          workHours: workHoursValue,
          rev: nextRev,
          serverUpdated: nowTs
        };
      });

      const out = { updated: nowTs, data: outData };
      prop.setProperty(DATA_KEY, JSON.stringify(out));
      CacheService.getScriptCache().put(KEY_PREFIX+'data:'+office, JSON.stringify(out), CACHE_TTL_SEC);
      return json_({ ok:true });
    } finally{
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  if(action === 'renameOffice'){
    const office = p_(e,'office', tokenOffice);
    if(!canAdminOffice_(prop, token, office)) return json_({ error:'forbidden' });
    const name = p_(e,'name','').trim();
    if(!name) return json_({ error:'bad_request' });
    const offs = getOffices_();
    offs[office].name = name;
    setOffices_(offs);
    return json_({ ok:true });
  }


  if(action === 'setOfficePassword'){
    const id = p_(e,'id', tokenOffice).trim();
    if(!canAdminOffice_(prop, token, id)) return json_({ error:'forbidden' });
    const pw  = p_(e,'password','');
    const apw = p_(e,'adminPassword','');
    if(!pw && !apw) return json_({ error:'bad_request' });
    const offs = getOffices_();
    if(!offs[id]) return json_({ error:'not_found' });
    if(pw)  offs[id].password = pw;
    if(apw) offs[id].adminPassword = apw;
    setOffices_(offs);
    return json_({ ok:true });
  }

  /* ===== お知らせAPI ===== */
  if(action === 'getNotices'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    // スーパー管理者が別拠点を指定した場合、権限チェック
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      }
    }
    const NOTICES_KEY = noticesKeyForOffice_(office);
    const cKey = KEY_PREFIX + 'notices:' + office;
    const noCache = p_(e,'nocache','') === '1';

    const isAdmin = roleIsOfficeAdmin_(prop, token);
    const cacheKey = cKey + (isAdmin ? ':admin' : ':user');

    const hit = noCache ? null : cache.get(cacheKey);
    if(hit){ try{ return json_(JSON.parse(hit)); }catch(_){ /* fallthrough */ } }

    const stored = prop.getProperty(NOTICES_KEY);
    const normalized = normalizeNoticesArray_(stored || []);
    const notices = isAdmin ? normalized : normalized.filter(n => n && coerceNoticeVisibleFlag_(n.visible != null ? n.visible : (n.display != null ? n.display : true)));

    const outObj = { updated: now_(), notices };
    if(!noCache) cache.put(cacheKey, JSON.stringify(outObj), CACHE_TTL_SEC);
    return json_(outObj);
  }

  if(action === 'setNotices'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    // スーパー管理者が別拠点を指定した場合、権限チェック
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden', debug:'cannot_admin_office='+requestedOffice });
      }
    }
    const role = getRoleByToken_(prop, token);
    if(!roleIsOfficeAdmin_(prop, token)) return json_({ error:'forbidden', debug:'role='+role });

    const NOTICES_KEY = noticesKeyForOffice_(office);
    const noticesParam = p_(e,'notices','[]');
    let parsedNotices;
    try{ parsedNotices = JSON.parse(noticesParam); }
    catch(err){ return json_({ error:'bad_json', debug:String(err), param:noticesParam }); }

    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      const normalized = normalizeNoticesArray_(parsedNotices);

      prop.setProperty(NOTICES_KEY, JSON.stringify(normalized));
      const out = JSON.stringify({ updated: now_(), notices: normalized });
      cache.put(KEY_PREFIX+'notices:'+office, out, CACHE_TTL_SEC);
      return json_({ ok:true, notices: normalized });
    } catch(err){
      return json_({ error:'save_failed', debug:String(err) });
    } finally{
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  /* ===== ツールAPI ===== */
  if(action === 'getTools'){
    const requestedOffice = p_(e,'office','');
    let office = tokenOffice;
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      }
    }
    const TOOLS_KEY = toolsKeyForOffice_(office);
    const noCache = p_(e,'nocache','') === '1';
    const isAdmin = roleIsOfficeAdmin_(prop, token);
    const cacheKey = KEY_PREFIX + 'tools:' + office + (isAdmin ? ':admin' : ':user');

    if(!noCache){
      const hit = cache.get(cacheKey);
      if(hit){
        try{ return json_(JSON.parse(hit)); }catch(_){ /* fallthrough */ }
      }
    }

    let stored;
    try{ stored = JSON.parse(prop.getProperty(TOOLS_KEY) || '[]'); }
    catch(_){ stored = []; }

    const normalized = normalizeToolsArray_(stored || []);
    const tools = isAdmin ? normalized.list : filterVisibleTools_(normalized.list);
    const outObj = { updated: now_(), tools, warnings: normalized.warnings };
    if(!noCache){ cache.put(cacheKey, JSON.stringify(outObj), CACHE_TTL_SEC); }
    return json_(outObj);
  }

  if(action === 'setTools'){
    const requestedOffice = p_(e,'office','');
    let office = tokenOffice;
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      }else{
        return json_({ error:'forbidden', debug:'cannot_admin_office='+requestedOffice });
      }
    }
    const role = getRoleByToken_(prop, token);
    if(!roleIsOfficeAdmin_(prop, token)) return json_({ error:'forbidden', debug:'role='+role });

    const TOOLS_KEY = toolsKeyForOffice_(office);
    const toolsParam = p_(e,'tools','[]');
    let parsedTools;
    try{ parsedTools = JSON.parse(toolsParam); }
    catch(err){ return json_({ error:'bad_json', debug:String(err), param:toolsParam }); }

    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      const normalized = normalizeToolsArray_(parsedTools);
      prop.setProperty(TOOLS_KEY, JSON.stringify(normalized.list));
      const outObj = { updated: now_(), tools: normalized.list, warnings: normalized.warnings };
      cache.put(KEY_PREFIX+'tools:'+office, JSON.stringify(outObj), CACHE_TTL_SEC);
      cache.put(KEY_PREFIX+'tools:'+office+':admin', JSON.stringify(outObj), CACHE_TTL_SEC);
      return json_(Object.assign({ ok:true }, outObj));
    }catch(err){
      return json_({ error:'save_failed', debug:String(err) });
    }finally{
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  /* ===== イベント日付カラーAPI ===== */
  if(action === 'getEventColorMap'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden' });
      }
    }

    const COLORS_KEY = eventColorsKeyForOffice_(office);
    const noCache = p_(e,'nocache','') === '1';
    const cacheKey = KEY_PREFIX + 'eventcolors:' + office;
    if(!noCache){
      const hit = cache.get(cacheKey);
      if(hit){
        try{ return json_(JSON.parse(hit)); }catch(_){ /* fallthrough */ }
      }
    }

    let outObj = { colors:{}, updated:0 };
    try{
      const stored = prop.getProperty(COLORS_KEY);
      if(stored){
        const parsed = JSON.parse(stored);
        outObj = normalizeEventColorMap_(parsed);
      }
    }catch(_){
      outObj = { colors:{}, updated:0 };
    }

    const out = JSON.stringify(outObj);
    if(!noCache) cache.put(cacheKey, out, CACHE_TTL_SEC);
    return json_(outObj);
  }

  if(action === 'setEventColorMap'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden' });
      }
    }
    if(!roleIsOfficeAdmin_(prop, token)) return json_({ error:'forbidden' });

    let incoming;
    try{ incoming = JSON.parse(p_(e,'data','{}')) || {}; }
    catch(_){ return json_({ error:'bad_json' }); }

    const normalized = normalizeEventColorMap_(incoming);
    const payload = { colors: normalized.colors, updated: now_() };
    const COLORS_KEY = eventColorsKeyForOffice_(office);

    prop.setProperty(COLORS_KEY, JSON.stringify(payload));
    cache.put(KEY_PREFIX+'eventcolors:'+office, JSON.stringify(payload), CACHE_TTL_SEC);
    return json_({ ok:true, colors: payload.colors, updated: payload.updated });
  }

  /* ===== 長期休暇API ===== */
  if(action === 'getVacation'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    // スーパー管理者が別拠点を指定した場合、権限チェック
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      }
    }
    const VACATIONS_KEY = vacationsKeyForOffice_(office);
    const stored = prop.getProperty(VACATIONS_KEY);
    let vacations = [];
    if(stored){
      try{
        const parsed = JSON.parse(stored);
        const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.vacations) ? parsed.vacations : []);
        vacations = raw.map(v => normalizeVacationItem_(v, office)).filter(v => v);
      }catch(_){
        vacations = [];
      }
    }
    vacations = vacations.map((v, idx)=>{
      const orderVal = Number(v.order || 0);
      return { ...v, order: orderVal > 0 ? orderVal : (idx + 1) };
    }).sort((a,b)=>{
      const ao = Number(a.order || 0);
      const bo = Number(b.order || 0);
      if(ao !== bo) return ao - bo;
      return (Number(a.updated||0)) - (Number(b.updated||0));
    });
    return json_({ vacations, updated: now_() });
  }

  if(action === 'setVacation'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    // スーパー管理者が別拠点を指定した場合、権限チェック
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden' });
      }
    }
    if(!roleIsOfficeAdmin_(prop, token)) return json_({ error:'forbidden' });

    const VACATIONS_KEY = vacationsKeyForOffice_(office);
    const dataParam = p_(e,'data','{}');
    let payload;
    try{
      payload = JSON.parse(dataParam);
    }catch(err){
      return json_({ error:'bad_json', debug:String(err) });
    }

    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      // 既存の休暇リストを取得
      const stored = prop.getProperty(VACATIONS_KEY);
      let vacations = [];
      if(stored){
        try{
          const parsed = JSON.parse(stored);
          const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.vacations) ? parsed.vacations : []);
          vacations = raw.map(v => normalizeVacationItem_(v, office)).filter(v => v);
        }catch(_){
          vacations = [];
        }
      }

      // 新規追加または更新
      const id = payload.id || Utilities.getUuid().replace(/-/g,'');
      const title = String(payload.title || '').substring(0, 200);
      const startDate = String(payload.start || '');
      const endDate = String(payload.end || '');
      const noticeId = String(payload.noticeId || payload.noticeKey || '').substring(0, 200);
      const noticeTitle = String(payload.noticeTitle || '').substring(0, 200);
      const note = String(payload.note || noticeTitle || '').substring(0, 2000);
      const membersBits = String(payload.membersBits || '');
      const visible = coerceVacationVisibleFlag_(payload.visible);
      const isVacation = coerceVacationTypeFlag_(payload.isVacation);
      const color = String(payload.color || payload.eventColor || 'amber').trim() || 'amber';
      const orderRaw = Number(payload.order || payload.sortOrder || 0);
      const hasOrder = Number.isFinite(orderRaw) && orderRaw > 0;
      const base = { id, office, title, startDate, endDate, note, noticeId, noticeTitle, membersBits, visible, isVacation, color, updated: now_() };
      if(hasOrder){ base.order = orderRaw; }
      const newItem = normalizeVacationItem_(base, office);

      // IDが存在する場合は更新、なければ追加
      const existingIndex = vacations.findIndex(v => v.id === id);
      if(existingIndex >= 0){
        vacations[existingIndex] = newItem;
      }else{
        vacations.push(newItem);
      }

      vacations = vacations.map((v, idx)=>{
        const orderVal = Number(v.order || 0);
        return { ...v, order: orderVal > 0 ? orderVal : (idx + 1) };
      }).sort((a,b)=>{
        const ao = Number(a.order || 0);
        const bo = Number(b.order || 0);
        if(ao !== bo) return ao - bo;
        return (Number(a.updated||0)) - (Number(b.updated||0));
      }).map((v, idx)=> normalizeVacationItem_({ ...v, order: Number(v.order||0) || (idx+1) }, office));
      const savedItem = vacations.find(v => v.id === id) || newItem;

      // 保存
      prop.setProperty(VACATIONS_KEY, JSON.stringify(vacations));
      return json_({ ok:true, id, vacation: savedItem, vacations });
    }catch(err){
      return json_({ error:'save_failed', debug:String(err) });
    }finally{
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  if(action === 'setVacationBits'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden' });
      }
    }

    const dataParam = p_(e,'data','{}');
    let payload;
    try{
      payload = JSON.parse(dataParam);
    }catch(err){
      return json_({ error:'bad_json', debug:String(err) });
    }

    const id = String(payload.id || payload.vacationId || '').trim();
    if(!id) return json_({ error:'bad_request' });

    const VACATIONS_KEY = vacationsKeyForOffice_(office);
    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      const stored = prop.getProperty(VACATIONS_KEY);
      let vacations = [];
      if(stored){
        try{
          const parsed = JSON.parse(stored);
          const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.vacations) ? parsed.vacations : []);
          vacations = raw.map(v => normalizeVacationItem_(v, office)).filter(v => v);
        }catch(_){
          vacations = [];
        }
      }

      const idx = vacations.findIndex(v => String(v.id || '') === id);
      if(idx < 0){
        return json_({ error:'not_found' });
      }

      const membersBits = String(payload.membersBits || payload.bits || '').trim();
      const updatedItem = normalizeVacationItem_({ ...vacations[idx], membersBits, updated: now_() }, office);
      vacations[idx] = updatedItem;

      prop.setProperty(VACATIONS_KEY, JSON.stringify(vacations));
      return json_({ ok:true, id, vacation: updatedItem, updated: updatedItem.updated, vacations });
    }catch(err){
      return json_({ error:'save_failed', debug:String(err) });
    }finally{
      try{ lock.releaseLock(); }catch(_){ }
    }
  }

  if(action === 'deleteVacation'){
    const requestedOffice = p_(e,'office', '');
    let office = tokenOffice;
    // スーパー管理者が別拠点を指定した場合、権限チェック
    if(requestedOffice && requestedOffice !== tokenOffice){
      if(canAdminOffice_(prop, token, requestedOffice)){
        office = requestedOffice;
      } else {
        return json_({ error:'forbidden' });
      }
    }
    if(!roleIsOfficeAdmin_(prop, token)) return json_({ error:'forbidden' });

    const id = p_(e,'id','').trim();
    if(!id) return json_({ error:'bad_request' });

    const VACATIONS_KEY = vacationsKeyForOffice_(office);
    const lock = LockService.getScriptLock(); lock.waitLock(2000);
    try{
      const stored = prop.getProperty(VACATIONS_KEY);
      let vacations = [];
      if(stored){
        try{
          const parsed = JSON.parse(stored);
          const raw = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.vacations) ? parsed.vacations : []);
          vacations = raw.map(v => normalizeVacationItem_(v, office)).filter(v => v);
        }catch(_){
          vacations = [];
        }
      }

      // IDが一致するものを削除
      vacations = vacations.filter(v => v.id !== id);

      // 保存
      prop.setProperty(VACATIONS_KEY, JSON.stringify(vacations));
      return json_({ ok:true });
    }catch(err){
      return json_({ error:'delete_failed', debug:String(err) });
    }finally{
      try{ lock.releaseLock(); }catch(_){}
    }
  }

  return json_({ error:'unknown_action' });
}

function doGet(e){
  const action = p_(e,'action','');
  if(action === 'watchConfig'){
    const token = p_(e,'token','');
    const since = Number(p_(e,'since','0'));
    const prop = PropertiesService.getScriptProperties();
    if(!checkToken_(prop, token)) return ContentService.createTextOutput('unauthorized');
    const office = getOfficeByToken_(prop, token);
    const cache = CacheService.getScriptCache();
    const key = KEY_PREFIX + 'cfgpush:' + office;
    let ts = Number(cache.get(key) || 0);
    const limit = now_() + 25000;
    while(ts <= since && now_() < limit){
      Utilities.sleep(1000);
      ts = Number(cache.get(key) || 0);
    }
    const CONFIG_KEY = configKeyForOffice_(office);
    let cfg;
    try{ cfg = JSON.parse(prop.getProperty(CONFIG_KEY) || '') || defaultConfig_(); }
    catch(_){ cfg = defaultConfig_(); }
    const parsed = normalizeConfig_(cfg);
    const out = `id: ${ts}\ndata: ${JSON.stringify(parsed)}\n\n`;
    return ContentService.createTextOutput(out).setMimeType('text/event-stream');
  }
  return ContentService.createTextOutput('unsupported');

}








