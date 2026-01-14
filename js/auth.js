/* 認証UI + 管理UI + マニュアルUI */
function logoutButtonsCleanup(){
  closeMenu(); showAdminModal(false); showManualModal(false); showEventModal(false); showToolsModal(false);
  board.style.display='none'; board.replaceChildren(); menuList.replaceChildren();
  try{ if(typeof stopToolsPolling==='function'){ stopToolsPolling(); } }catch{}
  // イベントバナーは削除されたため、この行はコメントアウト
  // try{ if(typeof updateEventBanner==='function'){ updateEventBanner(null); } }catch{}
  if(typeof renderVacationRadioMessage==='function'){ renderVacationRadioMessage('読み込み待ち'); }
  if(typeof updateEventDetail==='function'){ updateEventDetail(null); }
  window.scrollTo(0,0);
}
async function logout(){
  try{
    if(tokenRenewTimer){ clearTimeout(tokenRenewTimer); tokenRenewTimer=null; }
    if(configWatchTimer){ clearInterval(configWatchTimer); configWatchTimer=null; }
    if(remotePullTimer){ clearInterval(remotePullTimer); remotePullTimer=null; }
    if(eventSyncTimer){ clearInterval(eventSyncTimer); eventSyncTimer=null; }
    if(typeof clearPendingRows==='function'){ clearPendingRows(); }
    if(ro){ try{ ro.disconnect(); }catch{} }
    stopNoticesPolling();
  }catch{}
  logoutButtonsCleanup();
  SESSION_TOKEN=""; sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_ROLE_KEY);
  sessionStorage.removeItem(SESSION_OFFICE_KEY); sessionStorage.removeItem(SESSION_OFFICE_NAME_KEY);
  CURRENT_OFFICE_NAME=""; CURRENT_OFFICE_ID=""; CURRENT_ROLE="user";
    adminSelectedOfficeId='';
  if(adminOfficeSel){ adminOfficeSel.textContent=''; adminOfficeSel.disabled=false; }
  if(adminOfficeRow){ adminOfficeRow.style.display='none'; }
  // お知らせエリアを非表示にする
  const noticesArea = document.getElementById('noticesArea');
  if(noticesArea) noticesArea.style.display='none';
  titleBtn.textContent='在席確認表';
  ensureAuthUI();
  try{ await refreshPublicOfficeSelect(); }
  catch{ ensureAuthUIPublicError(); }
  finally{ loginEl.style.display='flex'; }
}
function ensureAuthUI(){
  const loggedIn = !!SESSION_TOKEN;
  const showAdmin = loggedIn && isOfficeAdmin();
  noticesBtn.style.display = 'none'; // デフォルトは非表示、お知らせがある場合にnotices.jsで表示
  adminBtn.style.display   = showAdmin ? 'inline-block' : 'none';
  logoutBtn.style.display  = loggedIn ? 'inline-block' : 'none';
  toolsBtn.style.display   = loggedIn ? 'inline-block' : 'none';
  manualBtn.style.display  = loggedIn ? 'inline-block' : 'none';
  eventBtn.style.display = 'none';
  updateEventButtonVisibility();
  nameFilter.style.display = loggedIn ? 'inline-block' : 'none';
  statusFilter.style.display = loggedIn ? 'inline-block' : 'none';
}
function showAdminModal(yes){ adminModal.classList.toggle('show', !!yes); }
function showToolsModal(yes){ toolsModal.classList.toggle('show', !!yes); }
function showEventModal(yes){
  const shouldShow=!!yes;
  eventModal.classList.toggle('show', shouldShow);
  if(shouldShow){
    eventModal.removeAttribute('aria-hidden');
    eventModal.style.removeProperty('display');
    eventModal.style.removeProperty('visibility');
  }else{
    eventModal.setAttribute('aria-hidden','true');
    eventModal.classList.remove('print-mode');
    eventModal.style.display='none';
    eventModal.style.visibility='hidden';
  }
}
async function applyRoleToAdminPanel(){
  if(!(adminOfficeRow&&adminOfficeSel)) return;
  if(CURRENT_ROLE!=='superAdmin'){
    adminOfficeRow.style.display='none';
    adminOfficeSel.disabled=false;
    adminOfficeSel.textContent='';
    adminSelectedOfficeId='';
    return;
  }

  adminOfficeRow.style.display='';
  adminOfficeSel.disabled=true;
  adminOfficeSel.textContent='';
  const loadingOpt=document.createElement('option');
  loadingOpt.value=''; loadingOpt.disabled=true; loadingOpt.selected=true; loadingOpt.textContent='読込中…';
  adminOfficeSel.appendChild(loadingOpt);

  let offices=[];
  try{
    const res=await apiPost({ action:'listOffices', token:SESSION_TOKEN });
    if(res && res.ok!==false && Array.isArray(res.offices)){
      offices=res.offices;
    }else{
      throw new Error(res&&res.error?String(res.error):'unexpected_response');
    }
  }catch(err){
    console.error('listOffices failed',err);
    adminOfficeSel.textContent='';
    const opt=document.createElement('option');
    opt.value=''; opt.disabled=true; opt.selected=true; opt.textContent='取得に失敗しました';
    adminOfficeSel.appendChild(opt);
    adminSelectedOfficeId='';
    adminOfficeSel.disabled=false;
    toast('拠点一覧の取得に失敗しました',false);
    return;
  }

  adminOfficeSel.textContent='';
  const seen=new Set();
  let desiredId=adminSelectedOfficeId||CURRENT_OFFICE_ID||'';
  let hasDesired=false;

  offices.forEach(o=>{
    if(!o) return;
    const id=String(o.id||'').trim();
    if(!id||seen.has(id)) return;
    seen.add(id);
    const opt=document.createElement('option');
    opt.value=id;
    opt.textContent=stripCtl(o.name==null?id:String(o.name))||id;
    adminOfficeSel.appendChild(opt);
    if(id===desiredId) hasDesired=true;
  });

  if(adminOfficeSel.options.length===0){
    const opt=document.createElement('option');
    opt.value=''; opt.disabled=true; opt.selected=true; opt.textContent='拠点がありません';
    adminOfficeSel.appendChild(opt);
    adminSelectedOfficeId='';
    adminOfficeSel.disabled=false;
    return;
  }

  if(!hasDesired){
    if(CURRENT_OFFICE_ID && seen.has(CURRENT_OFFICE_ID)) desiredId=CURRENT_OFFICE_ID;
    else desiredId=adminOfficeSel.options[0].value||'';
  }

  if(desiredId){ adminOfficeSel.value=desiredId; }
  if(adminOfficeSel.selectedIndex<0){ adminOfficeSel.selectedIndex=0; desiredId=adminOfficeSel.value||''; }
  adminSelectedOfficeId=desiredId||'';
  adminOfficeSel.disabled=false;
}
function showManualModal(yes){ manualModal.classList.toggle('show', !!yes); }
function applyRoleToManual(){
  const isAdmin = isOfficeAdmin();
  // 管理者タブボタンの表示/非表示
  const adminTabBtn = document.querySelector('.manual-tab-btn[data-tab="admin"]');
  if(adminTabBtn){
    adminTabBtn.style.display = isAdmin ? 'inline-block' : 'none';
  }
  // デフォルトタブの設定（管理者なら管理者タブ、それ以外はユーザータブ）
  const userTabBtn = document.querySelector('.manual-tab-btn[data-tab="user"]');
  if(isAdmin && adminTabBtn){
    // 管理者の場合は管理者タブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    adminTabBtn.classList.add('active');
    manualAdmin.classList.add('active');
  } else {
    // 一般ユーザーの場合はユーザータブを表示
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    if(userTabBtn) userTabBtn.classList.add('active');
    manualUser.classList.add('active');
  }
}

/* 管理/マニュアルUIイベント */
adminBtn.addEventListener('click', async ()=>{
  applyRoleToAdminPanel();
  showAdminModal(true);
  if(typeof loadAdminMembers==='function'){ try{ await loadAdminMembers(); }catch{} }
});
adminClose.addEventListener('click', ()=> showAdminModal(false));
logoutBtn.addEventListener('click', logout);

eventBtn.addEventListener('click', async ()=>{
  const targetOfficeId=(vacationOfficeSelect?.value)||adminSelectedOfficeId||CURRENT_OFFICE_ID||'';
  const list=await loadEvents(targetOfficeId, true, { visibleOnly:true, onSelect: handleEventSelection });
  if(!Array.isArray(list) || list.length===0){ toast('表示対象なし'); return; }
  const ctrl=getEventGanttController();
  if(ctrl?.setSaveMode){
    ctrl.setSaveMode('event-auto');
  }
  showEventModal(true);
});
eventClose.addEventListener('click', ()=> showEventModal(false));

manualBtn.addEventListener('click', ()=>{ applyRoleToManual(); showManualModal(true); });
manualClose.addEventListener('click', ()=> showManualModal(false));
toolsBtn.addEventListener('click', ()=> showToolsModal(true));
toolsModalClose.addEventListener('click', ()=> showToolsModal(false));
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape'){
    showAdminModal(false);
    showManualModal(false);
    showToolsModal(false);
    showEventModal(false);
    closeMenu();
  }
});

function setupModalOverlayClose(modalEl, closeFn){
  if(!modalEl) return;
  modalEl.addEventListener('click', (e)=>{
    if(e.target===modalEl){ closeFn(); }
  });
}

setupModalOverlayClose(adminModal, ()=> showAdminModal(false));
setupModalOverlayClose(manualModal, ()=> showManualModal(false));
setupModalOverlayClose(toolsModal, ()=> showToolsModal(false));
setupModalOverlayClose(eventModal, ()=> showEventModal(false));

/* マニュアルタブ切り替え */
document.querySelectorAll('.manual-tab-btn').forEach(btn => {
  btn.addEventListener('click', ()=>{
    const targetTab = btn.dataset.tab;
    // すべてのタブボタンとコンテンツのactiveクラスを削除
    document.querySelectorAll('.manual-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.manual-tab-content').forEach(c => c.classList.remove('active'));
    // クリックされたタブボタンとそのコンテンツにactiveクラスを追加
    btn.classList.add('active');
    if(targetTab === 'user'){
      document.getElementById('manualUser').classList.add('active');
    } else if(targetTab === 'admin'){
      document.getElementById('manualAdmin').classList.add('active');
    }
  });
});
