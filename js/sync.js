/* ===== メニュー・正規化・通信・同期 ===== */
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

function defaultMenus(){
  return {
    timeStepMinutes: 30,
    statuses: [
      { value: "在席",         class: "st-here",    clearOnSet: true  },
      { value: "外出",         requireTime: true,   class: "st-out"   },
      { value: "会議",         requireTime: true,   class: "st-meeting" },
      { value: "テレワーク",   class: "st-remote",  clearOnSet: true  },
      { value: "休み",         class: "st-off",     clearOnSet: true  }
    ],
    noteOptions: ["直出","直帰","直出・直帰"],
    businessHours: DEFAULT_BUSINESS_HOURS.slice()
  };
}

function normalizeBusinessHours(arr){
  if(Array.isArray(arr)){
    if(arr.length === 0){
      return [];
    }
    return arr.map(v => String(v ?? ""));
  }
  return DEFAULT_BUSINESS_HOURS.slice();
}

function buildWorkHourOptions(hours){
  const list = Array.isArray(hours) ? hours : [];
  const frag = document.createDocumentFragment();

  if(!list.length){
    return frag;
  }

  const optBlank = document.createElement('option');
  optBlank.value = "";
  optBlank.label = "（空白）";
  optBlank.textContent = "（空白）";
  frag.appendChild(optBlank);

  list.forEach(value => {
    const s = String(value ?? "");
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    frag.appendChild(opt);
  });
  
  return frag;
}
function setupMenus(m){
  const base = defaultMenus();
  MENUS = (m && typeof m === 'object') ? Object.assign({}, base, m) : base;
  // --- compatibility: accept legacy keys for business-hours ---
  if(!Array.isArray(MENUS.businessHours)){
    const legacy1 = Array.isArray(MENUS.workHourOptions) ? MENUS.workHourOptions : null;
    const legacy2 = Array.isArray(MENUS.workHoursOptions) ? MENUS.workHoursOptions : null;
    MENUS.businessHours = legacy1 || legacy2 || MENUS.businessHours;
  }

  if(!Array.isArray(MENUS.statuses)) MENUS.statuses = base.statuses;
  if(!Array.isArray(MENUS.noteOptions)) MENUS.noteOptions = base.noteOptions;
  MENUS.businessHours = normalizeBusinessHours(MENUS.businessHours);
  const sts = Array.isArray(MENUS.statuses) ? MENUS.statuses : base.statuses;

  STATUSES = sts.map(s => ({ value: String(s.value) }));
  requiresTimeSet = new Set(sts.filter(s => s.requireTime).map(s => String(s.value)));
  clearOnSet       = new Set(sts.filter(s => s.clearOnSet).map(s => String(s.value)));
  statusClassMap   = new Map(sts.map(s => [String(s.value), String(s.class || "")]));

  // 備考候補 datalist（先頭は空白のラベル付き）
  let dl = document.getElementById('noteOptions');
  if(!dl){ dl = document.createElement('datalist'); dl.id = 'noteOptions'; document.body.appendChild(dl); }
  dl.replaceChildren();
  const optBlank = document.createElement('option'); optBlank.value = ""; optBlank.label = "（空白）"; optBlank.textContent = "（空白）"; dl.appendChild(optBlank);
  (MENUS.noteOptions || []).forEach(t => { const opt = document.createElement('option'); opt.value = String(t); dl.appendChild(opt); });

  let workDl = document.getElementById('workHourOptions');
  if(!workDl){ workDl = document.createElement('datalist'); workDl.id = 'workHourOptions'; document.body.appendChild(workDl); }
  workDl.replaceChildren();
  workDl.appendChild(buildWorkHourOptions(MENUS.businessHours));

  buildStatusFilterOptions();
}
function isNotePresetValue(val){
  const v=(val==null?"":String(val)).trim();
  if(v==="") return true;
  const set = new Set((MENUS?.noteOptions||[]).map(x=>String(x)));
  return set.has(v);
}
function fallbackGroupTitle(g, idx){
  const t = (g && g.title != null) ? String(g.title).trim() : "";
  return t || `グループ${idx + 1}`;
}
function getRosterOrdering(){
  return (GROUPS || []).map((g, gi) => ({
    title: fallbackGroupTitle(g, gi),
    members: (g.members || []).map((m, mi) => ({
      id: (m && m.id != null && String(m.id)) ? String(m.id) : `__auto_${gi}_${mi}`,
      name: String(m?.name || ""),
      ext: String(m?.ext || ""),
      mobile: String(m?.mobile || ""),
      email: String(m?.email || ""),
      order: mi
    }))
  }));
}
function normalizeConfigClient(cfg){
  const groups = (cfg && Array.isArray(cfg.groups)) ? cfg.groups : [];
  return groups.map(g => {
    const members = Array.isArray(g.members) ? g.members : [];
    return {
      title: g.title || "",
      members: members.map(m => ({
        id:    String(m.id ?? "").trim(),
        name:  String(m.name ?? ""),
        ext:   String(m.ext  ?? ""),
        mobile: String(m.mobile ?? ""),
        email: String(m.email ?? ""),
        workHours: m.workHours == null ? '' : String(m.workHours)
      })).filter(m => m.id || m.name)
    };
  });
}
async function fastFetchDataOnce(){
  return await apiPost({ action: 'get', token: SESSION_TOKEN, nocache: '1' });
}
function startRemoteSync(immediate){
  if(remotePullTimer){ clearInterval(remotePullTimer); remotePullTimer = null; }
  if(immediate){
    fastFetchDataOnce().then(async r => {
      if(r?.error==='unauthorized'){
        if(remotePullTimer){ clearInterval(remotePullTimer); remotePullTimer=null; }
        await logout();
        return;
      }
      if(r && r.data) applyState(r.data);
    }).catch(()=>{});
  }
  remotePullTimer = setInterval(async ()=>{
    const r = await apiPost({ action:'get', token: SESSION_TOKEN });
            if(r?.error==='unauthorized'){
      if(remotePullTimer){ clearInterval(remotePullTimer); remotePullTimer=null; }
      await logout();
      return;
    }
    if(r && r.data) applyState(r.data);
  }, REMOTE_POLL_MS);
}
function startConfigWatch(){
  if(configWatchTimer){ clearInterval(configWatchTimer); configWatchTimer = null; }
  configWatchTimer = setInterval(async ()=>{
    const cfg = await apiPost({ action:'getConfig', token: SESSION_TOKEN, nocache:'1' });
            if(cfg?.error==='unauthorized'){
      if(configWatchTimer){ clearInterval(configWatchTimer); configWatchTimer=null; }
      await logout();
      return;
    }
    if(cfg && !cfg.error){
      const updated = (typeof cfg.updated === 'number') ? cfg.updated : 0;
      if(updated && updated !== CONFIG_UPDATED){
        GROUPS = normalizeConfigClient(cfg);
        CONFIG_UPDATED = updated;
        setupMenus(cfg.menus || null);
        render();
      }
    }
  }, CONFIG_POLL_MS);
}
function scheduleRenew(ttlMs){
  if(tokenRenewTimer) { clearTimeout(tokenRenewTimer); tokenRenewTimer = null; }
  const delay = Math.max(10_000, Number(ttlMs||TOKEN_DEFAULT_TTL) - 60_000);
  tokenRenewTimer = setTimeout(async ()=>{
    tokenRenewTimer = null;
    const me = await apiPost({ action: 'renew', token: SESSION_TOKEN });
    if(!me || me.error === 'unauthorized'){
      await logout();
      return;
    }

    if(!me.ok){
      toast('ログイン状態を再確認してください', false);
      await logout();
      return;
    }

    if(me.ok){
                  const prevRole = CURRENT_ROLE;
      CURRENT_ROLE = me.role || CURRENT_ROLE;
      saveSessionMeta();
            if(CURRENT_ROLE !== prevRole){
        ensureAuthUI();
        applyRoleToManual();
      }
      scheduleRenew(Number(me.exp) || TOKEN_DEFAULT_TTL);
    }
  }, delay);
}

/* 送信（CAS: baseRev 同梱） */
async function pushRowDelta(key){
  const tr = document.getElementById(`row-${key}`);
  try{
    if(!tr) return;
    const st = getRowState(key);
    st.workHours = st.workHours == null ? '' : String(st.workHours);
    const baseRev = {}; baseRev[key] = Number(tr.dataset.rev || 0);
    const payload = { updated: Date.now(), data: { [key]: st } };
    const r = await apiPost({ action:'set', token: SESSION_TOKEN, data: JSON.stringify(payload), baseRev: JSON.stringify(baseRev) });

    if(!r){ toast('通信エラー', false); return; }

    if(r.error === 'conflict'){
      // サーバ側の値で上書き
      const c = (r.conflicts && r.conflicts.find(x=>x.id===key)) || null;
      if(c && c.server){
        applyState({ [key]: c.server });
        toast('他端末と競合しました（サーバ値で更新）', false);
      }else{
        // 競合配列が無い場合でも rev マップがあれば反映
        const rev = Number((r.rev && r.rev[key]) || 0);
        const ts  = Number((r.serverUpdated && r.serverUpdated[key]) || 0);
        if(rev){ tr.dataset.rev = String(rev); tr.dataset.serverUpdated = String(ts||0); }
        saveLocal();
      }
      return;
    }

    if(!r.error){
      const rev = Number((r.rev && r.rev[key]) || 0);
      const ts  = Number((r.serverUpdated && r.serverUpdated[key]) || 0);
      if(rev) { tr.dataset.rev = String(rev); tr.dataset.serverUpdated = String(ts||0); }
      saveLocal();
      return;
    }

    toast('保存に失敗しました', false);
  }finally{
    PENDING_ROWS.delete(key);
    if(tr){
      tr.querySelectorAll('input[name="note"],input[name="workHours"],select[name="status"],select[name="time"]').forEach(inp=>{
        if(inp && inp.dataset) delete inp.dataset.editing;
      });
    }
  }

}
