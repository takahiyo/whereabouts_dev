/* 認証UI + 管理UI + マニュアルUI - Hybrid Auth Version */

function logoutButtonsCleanup() {
  closeMenu(); showAdminModal(false); showManualModal(false); showEventModal(false); showToolsModal(false);
  board.style.display = 'none'; board.replaceChildren(); menuList.replaceChildren();
  try { if (typeof stopToolsPolling === 'function') { stopToolsPolling(); } } catch { }
  if (typeof renderVacationRadioMessage === 'function') { renderVacationRadioMessage('読み込み待ち'); }
  if (typeof updateEventDetail === 'function') { updateEventDetail(null); }
  window.scrollTo(0, 0);
}

async function checkLogin() {
  return new Promise((resolve) => {
    if (typeof firebase === 'undefined') {
      console.error("Firebase SDK not loaded");
      resolve(false);
      return;
    }

    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        // Firebaseログイン済みならセッション有効とみなす
        const storedOffice = localStorage.getItem('presence_office');
        const storedRole = localStorage.getItem('presence_role');

        if (storedOffice && storedRole) {
          SESSION_TOKEN = 'firebase_session'; // ダミーでもOK
          CURRENT_OFFICE_ID = storedOffice;
          CURRENT_ROLE = storedRole;
          updateAuthUI();
          if (typeof startRemoteSync === 'function') startRemoteSync(true);
          if (typeof startConfigWatch === 'function') startConfigWatch();
          if (typeof startNoticesPolling === 'function') startNoticesPolling();
          if (typeof startEventSync === 'function') startEventSync(true);
          if (typeof loadEvents === 'function') loadEvents(CURRENT_OFFICE_ID);
          resolve(true);
        } else {
          // 情報が欠落している場合は再ログインさせる
          logout();
          resolve(false);
        }
      } else {
        // 未ログイン
        SESSION_TOKEN = '';
        CURRENT_OFFICE_ID = '';
        CURRENT_ROLE = '';
        updateAuthUI();
        resolve(false);
      }
    });
  });
}

async function login(officeInput, passwordInput) {
  try {
    // 1. Workerへパスワード確認リクエスト
    const formData = new URLSearchParams();
    formData.append('action', 'login');
    formData.append('office', officeInput);
    formData.append('password', passwordInput);

    // REMOTE_ENDPOINT は js/config.js で定義されている
    const endpoint = (typeof REMOTE_ENDPOINT !== 'undefined') ? REMOTE_ENDPOINT : "https://presence-proxy-prod.taka-hiyo.workers.dev";

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });

    const result = await resp.json();

    if (!result.ok) {
      throw new Error("認証に失敗しました。オフィスIDまたはパスワードを確認してください。");
    }

    // ★重要：Firebaseにログインする「前」に、拠点情報を保存する
    // これにより、ログイン直後に走る監視役が正しく情報を読み取れます
    localStorage.setItem('presence_office', result.office);
    localStorage.setItem('presence_role', result.role);
    localStorage.setItem('presence_office_name', result.officeName || result.office);

    // 2. Firebaseに匿名ログイン
    await firebase.auth().signInAnonymously();

    // 3. グローバル変数を更新
    SESSION_TOKEN = 'firebase_session';
    CURRENT_OFFICE_ID = result.office;
    CURRENT_OFFICE_NAME = result.officeName || result.office;
    CURRENT_ROLE = result.role;

    toast(`ログインしました: ${result.officeName}`);

    // UIを即座に表示状態に切り替える
    updateAuthUI();

    return true;

  } catch (error) {
    console.error("Login error:", error);
    toast(error.message, false);
    return false;
  }
}

async function logout() {
  try {
    if (typeof firebase !== 'undefined') {
      await firebase.auth().signOut();
    }
    localStorage.removeItem('presence_office');
    localStorage.removeItem('presence_role');
    toast("ログオフしました");
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    console.error(e);
  }
}

function updateAuthUI() {
  if (SESSION_TOKEN) {
    if (loginEl) loginEl.style.display = 'none';
    if (board) board.style.display = 'block';
    ensureAuthUI();
  } else {
    if (loginEl) loginEl.style.display = 'flex';
    if (board) board.style.display = 'none';
    ensureAuthUI();
  }
}

function ensureAuthUI() {
  const loggedIn = !!SESSION_TOKEN;
  const showAdmin = loggedIn && isOfficeAdmin();
  noticesBtn.style.display = 'none'; // デフォルトは非表示、お知らせがある場合にnotices.jsで表示
  adminBtn.style.display = showAdmin ? 'inline-block' : 'none';
  logoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
  toolsBtn.style.display = loggedIn ? 'inline-block' : 'none';
  manualBtn.style.display = loggedIn ? 'inline-block' : 'none';
  eventBtn.style.display = 'none';
  updateEventButtonVisibility();
  nameFilter.style.display = loggedIn ? 'inline-block' : 'none';
  statusFilter.style.display = loggedIn ? 'inline-block' : 'none';
}
function showAdminModal(yes) { adminModal.classList.toggle('show', !!yes); }
function showToolsModal(yes) { toolsModal.classList.toggle('show', !!yes); }
function showEventModal(yes) {
  const shouldShow = !!yes;
  eventModal.classList.toggle('show', shouldShow);
  if (shouldShow) {
    eventModal.removeAttribute('aria-hidden');
    eventModal.style.removeProperty('display');
    eventModal.style.removeProperty('visibility');
  } else {
    eventModal.setAttribute('aria-hidden', 'true');
    eventModal.classList.remove('print-mode');
    eventModal.style.display = 'none';
    eventModal.style.visibility = 'hidden';
  }
}
async function applyRoleToAdminPanel() {
  if (!(adminOfficeRow && adminOfficeSel)) return;
  if (CURRENT_ROLE !== 'superAdmin') {
    adminOfficeRow.style.display = 'none';
    adminOfficeSel.disabled = false;
    adminOfficeSel.textContent = '';
    adminSelectedOfficeId = '';
    return;
  }

  adminOfficeRow.style.display = '';
  adminOfficeSel.disabled = true;
  adminOfficeSel.textContent = '';
  const loadingOpt = document.createElement('option');
  loadingOpt.value = ''; loadingOpt.disabled = true; loadingOpt.selected = true; loadingOpt.textContent = '読込中…';
  adminOfficeSel.appendChild(loadingOpt);

  let offices = [];
  try {
    const res = await apiPost({ action: 'listOffices', token: SESSION_TOKEN });
    if (res && res.ok !== false && Array.isArray(res.offices)) {
      offices = res.offices;
    } else {
      throw new Error(res && res.error ? String(res.error) : 'unexpected_response');
    }
  } catch (err) {
    console.error('listOffices failed', err);
    adminOfficeSel.textContent = '';
    const opt = document.createElement('option');
    opt.value = ''; opt.disabled = true; opt.selected = true; opt.textContent = '取得に失敗しました';
    adminOfficeSel.appendChild(opt);
    adminSelectedOfficeId = '';
    adminOfficeSel.disabled = false;
    toast('拠点一覧の取得に失敗しました', false);
    return;
  }

  adminOfficeSel.textContent = '';
  const seen = new Set();
  let desiredId = adminSelectedOfficeId || CURRENT_OFFICE_ID || '';
  let hasDesired = false;

  offices.forEach(o => {
    if (!o) return;
    const id = String(o.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = stripCtl(o.name == null ? id : String(o.name)) || id;
    adminOfficeSel.appendChild(opt);
    if (id === desiredId) hasDesired = true;
  });

  if (adminOfficeSel.options.length === 0) {
    const opt = document.createElement('option');
    opt.value = ''; opt.disabled = true; opt.selected = true; opt.textContent = '拠点がありません';
    adminOfficeSel.appendChild(opt);
    adminSelectedOfficeId = '';
    adminOfficeSel.disabled = false;
    return;
  }

  if (!hasDesired) {
    if (CURRENT_OFFICE_ID && seen.has(CURRENT_OFFICE_ID)) desiredId = CURRENT_OFFICE_ID;
    else desiredId = adminOfficeSel.options[0].value || '';
  }

  if (desiredId) { adminOfficeSel.value = desiredId; }
  if (adminOfficeSel.selectedIndex < 0) { adminOfficeSel.selectedIndex = 0; desiredId = adminOfficeSel.value || ''; }
  adminSelectedOfficeId = desiredId || '';
  adminOfficeSel.disabled = false;
}
function showManualModal(yes) { manualModal.classList.toggle('show', !!yes); }
function applyRoleToManual() {
  const isAdmin = isOfficeAdmin();
  // 管理者タブボタンの表示/非表示
  const adminTabBtn = document.querySelector('.manual-tab-btn[data-tab="admin"]');
  if (adminTabBtn) {
    adminTabBtn.style.display = isAdmin ? 'inline-block' : 'none';
  }
  // デフォルトタブの設定（管理者なら管理者タブ、それ以外はユーザータブ）
  const userTabBtn = document.querySelector('.manual-tab-btn[data-tab="user"]');
  if (isAdmin && adminTabBtn) {
    // 管理者の場合は管理者タブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    adminTabBtn.classList.add('active');
    manualAdmin.classList.add('active');
  } else {
    // 一般ユーザーの場合はユーザータブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    if (userTabBtn) userTabBtn.classList.add('active');
    manualUser.classList.add('active');
  }
}

/* 管理/マニュアルUIイベント */
adminBtn.addEventListener('click', async () => {
  applyRoleToAdminPanel();
  showAdminModal(true);
  if (typeof loadAdminMembers === 'function') { try { await loadAdminMembers(); } catch { } }
});
adminClose.addEventListener('click', () => showAdminModal(false));
logoutBtn.addEventListener('click', logout);

eventBtn.addEventListener('click', async () => {
  const targetOfficeId = (vacationOfficeSelect?.value) || adminSelectedOfficeId || CURRENT_OFFICE_ID || '';
  const list = await loadEvents(targetOfficeId, true, { visibleOnly: true, onSelect: handleEventSelection });
  if (!Array.isArray(list) || list.length === 0) { toast('表示対象なし'); return; }
  const ctrl = getEventGanttController();
  if (ctrl?.setSaveMode) {
    ctrl.setSaveMode('event-auto');
  }
  showEventModal(true);
});
eventClose.addEventListener('click', () => showEventModal(false));

manualBtn.addEventListener('click', () => { applyRoleToManual(); showManualModal(true); });
manualClose.addEventListener('click', () => showManualModal(false));
toolsBtn.addEventListener('click', () => showToolsModal(true));
toolsModalClose.addEventListener('click', () => showToolsModal(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    showAdminModal(false);
    showManualModal(false);
    showToolsModal(false);
    showEventModal(false);
    closeMenu();
  }
});

function setupModalOverlayClose(modalEl, closeFn) {
  if (!modalEl) return;
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) { closeFn(); }
  });
}

setupModalOverlayClose(adminModal, () => showAdminModal(false));
setupModalOverlayClose(manualModal, () => showManualModal(false));
setupModalOverlayClose(toolsModal, () => showToolsModal(false));
setupModalOverlayClose(eventModal, () => showEventModal(false));

/* マニュアルタブ切り替え */
document.querySelectorAll('.manual-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;
    // すべてのタブボタンとコンテンツのactiveクラスを削除
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    // クリックされたタブボタンとそのコンテンツにactiveクラスを追加
    btn.classList.add('active');
    if (targetTab === 'user') {
      document.getElementById('manualUser').classList.add('active');
    } else if (targetTab === 'admin') {
      document.getElementById('manualAdmin').classList.add('active');
    }
  });
});

/* ログインボタン（Firebase Auth） */
if (btnLogin) {
  btnLogin.addEventListener('click', async () => {
    const pw = pwInput.value;
    const office = officeSel.value;
    // officeはFirebase Authの入力としては使わないが、拠点選択として必須ならチェック
    if (!office) { if (loginMsg) loginMsg.textContent = "拠点を選択してください"; return; }
    if (!pw) { if (loginMsg) loginMsg.textContent = "パスワードを入力してください"; return; }

    if (loginMsg) loginMsg.textContent = "認証中…";
    const success = await login(office, pw);
    if (loginMsg) {
      if (success) loginMsg.textContent = "";
      else loginMsg.textContent = "認証に失敗しました";
    }
  });
}
