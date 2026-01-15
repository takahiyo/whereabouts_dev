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

// ハイブリッド同期用の状態管理
let useSdkMode = false;         // 現在SDKモードで動いているか
let unsubscribeSnapshot = null; // Firestoreのリスナー解除用関数
let fallbackTimer = null;       // フォールバック（Plan B切替）判定タイマー

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
      { value: "帰宅", class: "st-home" },
      { value: "休み", class: "st-off", clearOnSet: true }
    ],
    noteOptions: ["直出", "直帰", "直出・直帰"],
    businessHours: DEFAULT_BUSINESS_HOURS.slice()
  };
}

function normalizeBusinessHours(arr) {
  if (Array.isArray(arr)) {
    if (arr.length === 0) {
      return [];
    }
    return arr.map(v => String(v ?? ""));
  }
  return DEFAULT_BUSINESS_HOURS.slice();
}

function buildWorkHourOptions(hours) {
  const list = Array.isArray(hours) ? hours : [];
  const frag = document.createDocumentFragment();

  if (!list.length) {
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
function setupMenus(m) {
  const base = defaultMenus();
  MENUS = (m && typeof m === 'object') ? Object.assign({}, base, m) : base;
  // --- compatibility: accept legacy keys for business-hours ---
  if (!Array.isArray(MENUS.businessHours)) {
    const legacy1 = Array.isArray(MENUS.workHourOptions) ? MENUS.workHourOptions : null;
    const legacy2 = Array.isArray(MENUS.workHoursOptions) ? MENUS.workHoursOptions : null;
    MENUS.businessHours = legacy1 || legacy2 || MENUS.businessHours;
  }

  if (!Array.isArray(MENUS.statuses)) MENUS.statuses = base.statuses;
  if (!Array.isArray(MENUS.noteOptions)) MENUS.noteOptions = base.noteOptions;
  MENUS.businessHours = normalizeBusinessHours(MENUS.businessHours);
  const sts = Array.isArray(MENUS.statuses) ? MENUS.statuses : base.statuses;

  STATUSES = sts.map(s => ({ value: String(s.value) }));
  requiresTimeSet = new Set(sts.filter(s => s.requireTime).map(s => String(s.value)));
  clearOnSet = new Set(sts.filter(s => s.clearOnSet).map(s => String(s.value)));
  statusClassMap = new Map(sts.map(s => [String(s.value), String(s.class || "")]));

  // 備考候補 datalist（先頭は空白のラベル付き）
  let dl = document.getElementById('noteOptions');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'noteOptions'; document.body.appendChild(dl); }
  dl.replaceChildren();
  const optBlank = document.createElement('option'); optBlank.value = ""; optBlank.label = "（空白）"; optBlank.textContent = "（空白）"; dl.appendChild(optBlank);
  (MENUS.noteOptions || []).forEach(t => { const opt = document.createElement('option'); opt.value = String(t); dl.appendChild(opt); });

  let workDl = document.getElementById('workHourOptions');
  if (!workDl) { workDl = document.createElement('datalist'); workDl.id = 'workHourOptions'; document.body.appendChild(workDl); }
  workDl.replaceChildren();
  workDl.appendChild(buildWorkHourOptions(MENUS.businessHours));

  buildStatusFilterOptions();
}
function isNotePresetValue(val) {
  const v = (val == null ? "" : String(val)).trim();
  if (v === "") return true;
  const set = new Set((MENUS?.noteOptions || []).map(x => String(x)));
  return set.has(v);
}
function fallbackGroupTitle(g, idx) {
  const t = (g && g.title != null) ? String(g.title).trim() : "";
  return t || `グループ${idx + 1}`;
}
function getRosterOrdering() {
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
function normalizeConfigClient(cfg) {
  const groups = (cfg && Array.isArray(cfg.groups)) ? cfg.groups : [];
  return groups.map(g => {
    const members = Array.isArray(g.members) ? g.members : [];
    return {
      title: g.title || "",
      members: members.map(m => ({
        id: String(m.id ?? "").trim(),
        name: String(m.name ?? ""),
        ext: String(m.ext ?? ""),
        mobile: String(m.mobile ?? ""),
        email: String(m.email ?? ""),
        workHours: m.workHours == null ? '' : String(m.workHours)
      })).filter(m => m.id || m.name)
    };
  });
}

// Plan B: Workers経由のポーリング（フォールバック用）
async function startLegacyPolling(immediate) {
  console.log("Fallback to Workers Polling (Plan B)");
  useSdkMode = false;
  
  if (remotePullTimer) { clearInterval(remotePullTimer); remotePullTimer = null; }
  
  const pollAction = async () => {
    const r = await apiPost({ action: 'get', token: SESSION_TOKEN });
    if (r?.error === 'unauthorized') {
      if (remotePullTimer) { clearInterval(remotePullTimer); remotePullTimer = null; }
      await logout();
      return;
    }
    if (r && r.data) applyState(r.data);
  };

  if (immediate) {
    pollAction().catch(() => {});
  }
  remotePullTimer = setInterval(pollAction, REMOTE_POLL_MS);
}

// データ同期開始（Graceful Degradation: Plan A -> Plan B）
function startRemoteSync(immediate) {
  // 既存のタイマー/リスナーをクリア
  if (remotePullTimer) { clearInterval(remotePullTimer); remotePullTimer = null; }
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }

  // ログイン済みチェック（CURRENT_OFFICE_IDが必要）
  if (typeof CURRENT_OFFICE_ID === 'undefined' || !CURRENT_OFFICE_ID) {
    console.error("Office ID not found. Cannot start sync.");
    return;
  }

  // SDKが利用できない、または初期化失敗時は即Plan Bへ
  if (typeof firebase === 'undefined' || !firebase.apps.length) {
    startLegacyPolling(immediate);
    return;
  }

  console.log("Attempting Plan A: Firebase SDK connection...");

  // タイムアウト設定: 5秒以内にSDKでデータが取れなければPlan Bへ移行
  fallbackTimer = setTimeout(() => {
    if (!useSdkMode) {
      console.warn("Plan A timeout (5s). Switching to Plan B.");
      startLegacyPolling(immediate);
    }
  }, 5000);

  // 匿名認証してFirestoreに接続
  firebase.auth().signInAnonymously().then(() => {
    const db = firebase.firestore();
    const docRef = db.collection('offices').doc(CURRENT_OFFICE_ID).collection('members');

    unsubscribeSnapshot = docRef.onSnapshot((snapshot) => {
      // 成功: Plan Bへのフォールバックタイマーを解除
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      
      if (!useSdkMode) {
        console.log("Plan A Connected: Using Firebase SDK Realtime Listener");
        useSdkMode = true;
      }

      const changes = {};
      snapshot.docChanges().forEach((change) => {
        // Firestoreのデータをアプリ形式に変換
        changes[change.doc.id] = change.doc.data();
      });

      // 変更があった場合のみ適用
      if (Object.keys(changes).length > 0) {
        applyState(changes);
      }
    }, (error) => {
      console.error("Plan A Error (SDK):", error);
      // 権限エラーやネットワークエラー時はPlan Bへ
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      if (!useSdkMode) {
        startLegacyPolling(immediate);
      }
    });
  }).catch((e) => {
    console.error("Auth/Init Error:", e);
    startLegacyPolling(immediate);
  });
}

async function fetchConfigOnce() {
  const cfg = await apiPost({ action: 'getConfig', token: SESSION_TOKEN, nocache: '1' });
  if (cfg?.error === 'unauthorized') {
    await logout();
    return;
  }
  if (cfg && !cfg.error) {
    const updated = (typeof cfg.updated === 'number') ? cfg.updated : 0;
    const groups = cfg.groups || cfg.config?.groups || [];
    const menus = cfg.menus || cfg.config?.menus || null;
    const shouldUpdate = (updated && updated !== CONFIG_UPDATED) || (!updated && CONFIG_UPDATED === 0);
    if (shouldUpdate) {
      GROUPS = normalizeConfigClient({ groups });
      CONFIG_UPDATED = updated || Date.now();
      setupMenus(menus);
      render();
    }
  }
}

function startConfigWatch(immediate = true) {
  if (configWatchTimer) { clearInterval(configWatchTimer); configWatchTimer = null; }

  // 引数がtrueなら即座に実行
  if (immediate) {
    fetchConfigOnce().catch(console.error);
  }

  configWatchTimer = setInterval(fetchConfigOnce, CONFIG_POLL_MS);
}
function scheduleRenew(ttlMs) {
  if (tokenRenewTimer) { clearTimeout(tokenRenewTimer); tokenRenewTimer = null; }
  const delay = Math.max(10_000, Number(ttlMs || TOKEN_DEFAULT_TTL) - 60_000);
  tokenRenewTimer = setTimeout(async () => {
    tokenRenewTimer = null;
    const me = await apiPost({ action: 'renew', token: SESSION_TOKEN });
    if (!me || me.error === 'unauthorized') {
      await logout();
      return;
    }

    if (!me.ok) {
      toast('ログイン状態を再確認してください', false);
      await logout();
      return;
    }

    if (me.ok) {
      const prevRole = CURRENT_ROLE;
      CURRENT_ROLE = me.role || CURRENT_ROLE;
      saveSessionMeta();
      if (CURRENT_ROLE !== prevRole) {
        ensureAuthUI();
        applyRoleToManual();
      }
      scheduleRenew(Number(me.exp) || TOKEN_DEFAULT_TTL);
    }
  }, delay);
}

/* 送信（CAS: baseRev 同梱） */
async function pushRowDelta(key) {
  const tr = document.getElementById(`row-${key}`);
  try {
    if (!tr) return;
    const st = getRowState(key);
    st.workHours = st.workHours == null ? '' : String(st.workHours);
    const baseRev = {}; baseRev[key] = Number(tr.dataset.rev || 0);
    const payload = { updated: Date.now(), data: { [key]: st } };
    
    // 書き込みは整合性のため、常にWorkers経由（apiPost）で行う
    const r = await apiPost({ action: 'set', token: SESSION_TOKEN, data: JSON.stringify(payload), baseRev: JSON.stringify(baseRev) });

    if (!r) { toast('通信エラー', false); return; }

    if (r.error === 'conflict') {
      // サーバ側の値で上書き
      const c = (r.conflicts && r.conflicts.find(x => x.id === key)) || null;
      if (c && c.server) {
        applyState({ [key]: c.server });
        toast('他端末と競合しました（サーバ値で更新）', false);
      } else {
        // 競合配列が無い場合でも rev マップがあれば反映
        const rev = Number((r.rev && r.rev[key]) || 0);
        const ts = Number((r.serverUpdated && r.serverUpdated[key]) || 0);
        if (rev) { tr.dataset.rev = String(rev); tr.dataset.serverUpdated = String(ts || 0); }
        saveLocal();
      }
      return;
    }

    if (!r.error) {
      const rev = Number((r.rev && r.rev[key]) || 0);
      const ts = Number((r.serverUpdated && r.serverUpdated[key]) || 0);
      if (rev) { tr.dataset.rev = String(rev); tr.dataset.serverUpdated = String(ts || 0); }
      saveLocal();
      return;
    }

    toast('保存に失敗しました', false);
  } finally {
    PENDING_ROWS.delete(key);
    if (tr) {
      tr.querySelectorAll('input[name="note"],input[name="workHours"],select[name="status"],select[name="time"]').forEach(inp => {
        if (inp && inp.dataset) delete inp.dataset.editing;
      });
    }
  }

}
