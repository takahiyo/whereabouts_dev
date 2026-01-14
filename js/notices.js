/* お知らせ機能 */

let CURRENT_NOTICES = [];
window.CURRENT_NOTICES = CURRENT_NOTICES; // グローバルに公開してadmin.jsから参照可能にする
const MAX_NOTICE_ITEMS = 100;
const NOTICE_COLLAPSE_STORAGE_KEY = 'noticeAreaCollapsed';
let noticeCollapsePreference = loadNoticeCollapsePreference();

// URLを自動リンク化する関数
function linkifyText(text) {
  if (!text) return '';
  
  // URL正規表現（http, https, ftp対応）
  const urlRegex = /(https?:\/\/[^\s]+|ftps?:\/\/[^\s]+)/gi;
  
  return text.replace(urlRegex, (url) => {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  });
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function coerceNoticeDisplayFlag(raw) {
  if (raw === false) return false;
  if (raw === true || raw == null) return true;
  const s = String(raw).toLowerCase();
  return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
}

function coerceNoticeVisibleFlag(raw) {
  return coerceNoticeDisplayFlag(raw);
}

function normalizeNoticeKey(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
window.normalizeNoticeKey = normalizeNoticeKey;

function coerceNoticeArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed[0] === '[' || trimmed[0] === '{') {
      try {
        return coerceNoticeArray(JSON.parse(trimmed));
      } catch (_) {
        // treat as plain text fallback
      }
    }
    return [trimmed];
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.list)) return raw.list;
    if (Array.isArray(raw.items)) return raw.items;
    return Object.keys(raw)
      .sort()
      .map((key) => raw[key])
      .filter((value) => value != null);
  }
  return [];
}

function normalizeNoticeEntries(raw) {
  const arr = coerceNoticeArray(raw);
  const normalized = arr
    .map((item, idx) => {
      if (item == null) return null;
      if (typeof item === 'string') {
        const text = item.trim();
        if (!text) return null;
        const id = `notice_str_${idx}`;
        return { id, title: text.slice(0, 200), content: '', display: true, visible: true };
      }
      if (Array.isArray(item)) {
        const titleRaw = item[0] == null ? '' : String(item[0]);
        const contentRaw = item[1] == null ? '' : String(item[1]);
        const title = titleRaw.slice(0, 200);
        const content = contentRaw.slice(0, 2000);
        if (!title.trim() && !content.trim()) return null;
        const id = `notice_arr_${idx}`;
        return { id, title, content, display: true, visible: true };
      }
      if (typeof item === 'object') {
        const titleSource =
          item.title ?? item.subject ?? item.headline ?? '';
        const contentSource =
          item.content ?? item.body ?? item.text ?? item.description ?? '';
        const titleStr = titleSource == null ? '' : String(titleSource);
        const contentStr = contentSource == null ? '' : String(contentSource);
        const title = titleStr.slice(0, 200);
        const content = contentStr.slice(0, 2000);
        const visible = coerceNoticeVisibleFlag(
          item.visible ?? item.display ?? item.show ?? true
        );
        if (!title.trim() && !content.trim()) return null;
        const id = item.id ?? item.noticeId ?? item.uid ?? `notice_obj_${idx}`;
        return { id, title, content, display: visible, visible };
      }
      return null;
    })
    .filter(Boolean);
  if (normalized.length > MAX_NOTICE_ITEMS) {
    return normalized.slice(0, MAX_NOTICE_ITEMS);
  }
  return normalized;
}

function applyNotices(raw) {
  const normalized = normalizeNoticeEntries(raw);
  CURRENT_NOTICES = normalized;
  window.CURRENT_NOTICES = normalized; // グローバルに公開してadmin.jsから参照可能にする
  // 現在の開閉状態をリロード
  noticeCollapsePreference = loadNoticeCollapsePreference();
  renderNotices(normalized);
}

// お知らせを描画
function renderNotices(notices) {
  const noticesArea = document.getElementById('noticesArea');
  const noticesList = document.getElementById('noticesList');
  const noticesSummary = document.getElementById('noticesSummary');
  const noticesBtn = document.getElementById('noticesBtn');
  
  if (!noticesArea || !noticesList) return;

  const normalizedList = Array.isArray(notices)
    ? notices
    : normalizeNoticeEntries(notices);
  const list = normalizedList
    .map((n) => {
      if (!n || typeof n !== 'object') return null;
      const visible = coerceNoticeVisibleFlag(
        n.visible ?? n.display ?? n.show ?? true
      );
      if (!n.visible && n.display == null) {
        // 正規化されていない古いデータも合わせて扱う
        return { ...n, visible, display: visible };
      }
      return visible ? n : null;
    })
    .filter(Boolean);

  if (!list || list.length === 0) {
    noticesList.innerHTML = '';
    noticesArea.style.display = 'none';
    if (noticesBtn) noticesBtn.style.display = 'none';
    window.CURRENT_NOTICES = []; // グローバルにも空配列を反映
    return;
  }

  noticesList.innerHTML = '';

  list.forEach((notice) => {
    const title = notice && notice.title != null ? String(notice.title) : '';
    const content = notice && notice.content != null ? String(notice.content) : '';
    const hasContent = content.trim().length > 0;
    const noticeId = notice?.id ?? notice?.noticeId ?? notice?.uid ?? '';
    const noticeKey = notice?.noticeKey ?? notice?.key ?? normalizeNoticeKey(title);

    const item = document.createElement('div');
    if (hasContent) {
      item.className = 'notice-item';
      item.innerHTML = `
        <div class="notice-header">
          <span class="notice-toggle">➤</span>
          <span class="notice-title">${escapeHtml(title)}</span>
        </div>
        <div class="notice-content">${linkifyText(content)}</div>
      `;
      item.querySelector('.notice-header').addEventListener('click', () => {
        item.classList.toggle('expanded');
      });
    } else {
      item.className = 'notice-item title-only';
      item.innerHTML = `
        <div class="notice-header">
          <span class="notice-title">${escapeHtml(title)}</span>
        </div>
      `;
    }
    if (noticeId) item.dataset.noticeId = String(noticeId);
    if (noticeKey) item.dataset.noticeKey = normalizeNoticeKey(noticeKey);
    noticesList.appendChild(item);
  });

  // サマリー更新
  if (noticesSummary) {
    const firstTitle = list[0] && list[0].title ? String(list[0].title) : '';
    const remaining = list.length - 1;
    if (remaining > 0) {
      noticesSummary.textContent = `${escapeHtml(firstTitle)} (他${remaining}件)`;
    } else {
      noticesSummary.textContent = escapeHtml(firstTitle);
    }
  }

  noticesArea.style.display = 'block';
  if (noticesBtn) noticesBtn.style.display = 'inline-block';

  applyNoticeCollapsedState(noticesArea);
  
  // お知らせヘッダーをクリックで開閉できるようにする
  const noticesHeader = noticesArea.querySelector('.notices-header');
  if(noticesHeader){
    // 既存のリスナーを削除するため、一度クローンして置き換え
    const newHeader = noticesHeader.cloneNode(true);
    noticesHeader.parentNode.replaceChild(newHeader, noticesHeader);
    
    newHeader.addEventListener('click', ()=>{
      toggleNoticesArea();
    });
  }
}

// お知らせエリアの開閉トグル
function toggleNoticesArea() {
  const noticesArea = document.getElementById('noticesArea');
  if (!noticesArea) return;

  const isCollapsed = noticesArea.classList.toggle('collapsed');
  saveNoticeCollapsePreference(isCollapsed);
}

// お知らせを取得
async function fetchNotices(requestedOfficeId) {
  if (!SESSION_TOKEN) {
    console.log('fetchNotices: SESSION_TOKEN is not set');
    return;
  }

  try {
    const targetOfficeId = requestedOfficeId || CURRENT_OFFICE_ID || '';
    const params = {
      action: 'getNotices',
      token: SESSION_TOKEN,
      nocache: '1'
    };
    if (targetOfficeId) {
      params.office = targetOfficeId;
    }

    console.log('fetchNotices params:', params);
    const res = await apiPost(params);
    console.log('fetchNotices response:', res);
    
    if (res && Object.prototype.hasOwnProperty.call(res, 'notices')) {
      console.log('Applying notices:', res.notices);
      applyNotices(res.notices);
    } else if (res && res.error) {
      if (res.error === 'unauthorized') {
        toast('セッションの有効期限が切れました。再度ログインしてください', false);
        await logout();
        stopNoticesPolling();
      } else {
        console.error('fetchNotices error:', res.error, res.debug || '');
      }
    } else {
      console.warn('fetchNotices: Unexpected response format', res);
    }
  } catch (e) {
    console.error('お知らせ取得エラー:', e);
  }
}

// お知らせを保存（管理者のみ）
async function saveNotices(notices, office) {
  if (!SESSION_TOKEN) {
    console.error('saveNotices: SESSION_TOKEN is not set');
    return false;
  }
  
  console.log('saveNotices called with:', {notices, office, SESSION_TOKEN: SESSION_TOKEN ? 'set' : 'not set'});
  
  try {
    const payload = normalizeNoticeEntries(notices);
    console.log('saveNotices: normalized payload:', payload);
    
    const params = {
      action: 'setNotices',
      token: SESSION_TOKEN,
      notices: JSON.stringify(payload)
    };
    
    const targetOffice = office || CURRENT_OFFICE_ID || '';
    if (targetOffice) {
      params.office = targetOffice;
    }
    
    console.log('saveNotices: sending params:', {action: params.action, office: targetOffice, noticesLength: payload.length});
    
    const res = await apiPost(params);
    
    console.log('setNotices response:', res);
    
    if (res && res.ok) {
      const nextNotices = Object.prototype.hasOwnProperty.call(res, 'notices')
        ? res.notices
        : payload;
      applyNotices(nextNotices || []);
      return true;
    }

    if (res && res.error === 'forbidden') {
      toast('お知らせの編集権限がありません');
      return false;
    }

    if (res && res.error === 'unauthorized') {
      toast('セッションの有効期限が切れました。再度ログインしてください', false);
      await logout();
      return false;
    }

    if (res && res.error) {
      const debugInfo = res.debug ? ` (${res.debug})` : '';
      toast('エラー: ' + res.error + debugInfo);
      console.error('setNotices error details:', res);
      return false;
    }
    
    // レスポンスが不明な場合
    console.error('Unexpected setNotices response:', res);
    toast('お知らせの保存に失敗しました（不明なレスポンス）');
    return false;
  } catch (e) {
    console.error('お知らせ保存エラー:', e);
    toast('通信エラーが発生しました: ' + e.message);
  }
  
  return false;
}

// お知らせの自動更新（ポーリング）
let noticesPollingTimer = null;

function startNoticesPolling() {
  if (noticesPollingTimer) return;
  
  // 初回取得
  fetchNotices();
  
  // 30秒ごとに更新
  noticesPollingTimer = setInterval(() => {
    if (SESSION_TOKEN) {
      fetchNotices();
    } else {
      stopNoticesPolling();
    }
  }, 30000);
}

function stopNoticesPolling() {
  if (noticesPollingTimer) {
    clearInterval(noticesPollingTimer);
    noticesPollingTimer = null;
  }
}

function loadNoticeCollapsePreference() {
  try {
    const officeKey = `${NOTICE_COLLAPSE_STORAGE_KEY}_${CURRENT_OFFICE_ID || 'default'}`;
    const raw = localStorage.getItem(officeKey);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch (e) {
    console.warn('Failed to read notice collapse preference', e);
  }
  return false;
}

function saveNoticeCollapsePreference(collapsed) {
  noticeCollapsePreference = collapsed === true;
  try {
    const officeKey = `${NOTICE_COLLAPSE_STORAGE_KEY}_${CURRENT_OFFICE_ID || 'default'}`;
    localStorage.setItem(officeKey, noticeCollapsePreference ? 'true' : 'false');
    console.log('Notice collapse state saved:', officeKey, noticeCollapsePreference);
  } catch (e) {
    console.warn('Failed to save notice collapse preference', e);
  }
}

function applyNoticeCollapsedState(noticesArea) {
  if (!noticesArea) return;
  if (noticeCollapsePreference) {
    noticesArea.classList.add('collapsed');
  } else {
    noticesArea.classList.remove('collapsed');
  }
}
