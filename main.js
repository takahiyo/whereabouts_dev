/* 起動 */
document.addEventListener('DOMContentLoaded', async ()=>{
  await refreshPublicOfficeSelect();

  document.getElementById('btnLogin').addEventListener('click', async ()=>{
    const pw=pwInput.value, office=officeSel.value;
    if(!office){ loginMsg.textContent="拠点を選択してください"; return; }
    if(!pw||!pw.trim()){ loginMsg.textContent="パスワードを入力してください"; return; }
    loginMsg.textContent="認証中…";

    const res=await apiPost({ action:'login', office, password: pw });
    if(res===null){ loginMsg.textContent="通信エラー"; return; }
    if(res?.error==='unauthorized'){ loginMsg.textContent="拠点またはパスワードが違います"; return; }
    if(res?.ok===false){ loginMsg.textContent="通信エラー"; return; }
    if(!res?.token){ loginMsg.textContent="サーバ応答が不正です"; return; }
    await afterLogin(res);
  });

  async function afterLogin(res){
    SESSION_TOKEN=res.token; sessionStorage.setItem(SESSION_KEY,SESSION_TOKEN);
    CURRENT_OFFICE_NAME=res.officeName||""; CURRENT_OFFICE_ID=res.office||"";
    adminSelectedOfficeId='';
    CURRENT_ROLE = res.role || res.userRole || (res.isAdmin===true?'officeAdmin':'user');
    saveSessionMeta(); titleBtn.textContent=(CURRENT_OFFICE_NAME?`${CURRENT_OFFICE_NAME}　在席確認表`:'在席確認表');
    loginEl.style.display='none'; loginMsg.textContent=""; ensureAuthUI(); applyRoleToManual();
    let eventP=loadEvents(CURRENT_OFFICE_ID, false);

    // 役割確定（renewで上書き）
    try{
      const me=await apiPost({ action:'renew', token:SESSION_TOKEN });
      if(me&&me.ok){
        const prevOfficeId=CURRENT_OFFICE_ID;
        const nextOfficeId=me.office||prevOfficeId;
        CURRENT_ROLE=me.role||CURRENT_ROLE; CURRENT_OFFICE_ID=nextOfficeId; CURRENT_OFFICE_NAME=me.officeName||CURRENT_OFFICE_NAME;
        if(nextOfficeId!==prevOfficeId){ adminSelectedOfficeId=''; }
        saveSessionMeta(); ensureAuthUI(); applyRoleToManual();
        if(nextOfficeId!==prevOfficeId){
          eventP=loadEvents(nextOfficeId, false);
          if(typeof fetchTools === 'function'){
            fetchTools(nextOfficeId).catch(()=>{});
          }
          if(typeof startToolsPolling === 'function'){
            startToolsPolling(nextOfficeId);
          }
        }
      }
    }catch{}

    const cfgP=(async()=>{
      const cfg=await apiPost({ action:'getConfig', token:SESSION_TOKEN, nocache:'1' });
      if(cfg?.error==='unauthorized'){
        await logout();
        return;
      }
      if(cfg&&!cfg.error){ GROUPS=normalizeConfigClient(cfg); CONFIG_UPDATED=(typeof cfg.updated==='number')?cfg.updated:0; setupMenus(cfg.menus||null); }
      else { setupMenus(null); }
    })();
    const dataP=fastFetchDataOnce().then(async data=>{
      if(data?.error==='unauthorized'){
        await logout();
        return null;
      }
      return data;
    }).catch(()=>null);

    await cfgP;
    if(!SESSION_TOKEN) return;
    render(); loadLocal();
    if(!SESSION_TOKEN) return;
    const data=await dataP; if(!SESSION_TOKEN) return; if(data&&data.data) applyState(data.data);
    if(!SESSION_TOKEN) return;

    scheduleRenew(Number(res.exp)||TOKEN_DEFAULT_TTL);
    if(!SESSION_TOKEN) return;
    startRemoteSync(true); startConfigWatch(); startNoticesPolling(); startEventSync(true);
    if(typeof fetchTools === 'function'){
      fetchTools(CURRENT_OFFICE_ID).catch(()=>{});
    }
    if(typeof startToolsPolling === 'function'){
      startToolsPolling(CURRENT_OFFICE_ID);
    }
    await eventP;
    
    // 保存されているイベントを自動適用
    if(typeof autoApplySavedEvent === 'function'){
      await autoApplySavedEvent();
    }
  }

  // 既存セッション
  const existing=sessionStorage.getItem(SESSION_KEY);
  if(existing){
    SESSION_TOKEN=existing; loginEl.style.display='none';
    loadSessionMeta(); adminSelectedOfficeId=''; titleBtn.textContent=(CURRENT_OFFICE_NAME?`${CURRENT_OFFICE_NAME}　在席確認表`:'在席確認表');
    ensureAuthUI(); applyRoleToManual();
    const eventP=loadEvents(CURRENT_OFFICE_ID, false);
    (async()=>{
      const cfg=await apiPost({ action:'getConfig', token:SESSION_TOKEN, nocache:'1' });
      if(cfg?.error==='unauthorized'){
        await logout();
        return;
      }
      if(cfg&&!cfg.error){ GROUPS=normalizeConfigClient(cfg); CONFIG_UPDATED=(typeof cfg.updated==='number')?cfg.updated:0; setupMenus(cfg.menus||null); render(); }
      if(!SESSION_TOKEN) return;
      const d=await fastFetchDataOnce();
      if(d?.error==='unauthorized'){
        await logout();
        return;
      }
      if(d&&d.data) applyState(d.data);
      if(!SESSION_TOKEN) return;
      startRemoteSync(true); startConfigWatch(); startNoticesPolling(); startEventSync(true);
      if(typeof fetchTools === 'function'){
        fetchTools(CURRENT_OFFICE_ID).catch(()=>{});
      }
      if(typeof startToolsPolling === 'function'){
        startToolsPolling(CURRENT_OFFICE_ID);
      }
      await eventP;
      
      // 保存されているイベントを自動適用
      if(typeof autoApplySavedEvent === 'function'){
        await autoApplySavedEvent();
      }
    })();
  }else{
    loginEl.style.display='flex';
  }
});

/* お知らせボタンのイベントハンドラ */
if(noticesBtn){
  noticesBtn.addEventListener('click', ()=>{
    const noticesArea = document.getElementById('noticesArea');
    if(!noticesArea) return;

    toggleNoticesArea();

    // 少し遅延させて、DOM更新後にページトップにスクロール
    setTimeout(()=>{
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  });
}
