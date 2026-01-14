/* 認証UI（公開オフィス一覧） */
function setSelectMessage(sel,msg){
  sel.textContent='';
  const opt=document.createElement('option');
  opt.value=''; opt.disabled=true; opt.selected=true; opt.textContent=msg;
  sel.appendChild(opt);
}
function ensureAuthUIPublicError(){ setSelectMessage(officeSel,'取得できませんでした。再読込してください'); }
function normalizeOfficeEntry(out,id,name){
  const officeId=String(id||'').trim();
  if(!ID_RE.test(officeId)) return;
  if(out.some(o=>o.id===officeId)) return;
  const officeName=stripCtl(name==null?'':String(name));
  out.push({ id:officeId, name:officeName||officeId });
}
function configuredOfficesFallback(){
  const result=[];
  const sources=[];
  if(typeof PUBLIC_OFFICE_FALLBACKS!=='undefined') sources.push(PUBLIC_OFFICE_FALLBACKS);
  if(typeof STATIC_OFFICES!=='undefined') sources.push(STATIC_OFFICES);
  if(typeof PUBLIC_OFFICES!=='undefined') sources.push(PUBLIC_OFFICES);
  sources.forEach(src=>{
    if(!src) return;
    if(Array.isArray(src)){
      src.forEach(entry=>{
        if(!entry) return;
        if(Array.isArray(entry)){
          normalizeOfficeEntry(result,entry[0],entry[1]);
        }else if(typeof entry==='object'){
          normalizeOfficeEntry(result,entry.id,entry.name);
        }
      });
    }else if(typeof src==='object'){
      Object.entries(src).forEach(([key,val])=>{
        if(val&&typeof val==='object') normalizeOfficeEntry(result,key,val.name);
      });
    }
  });
  return result;
}
async function refreshPublicOfficeSelect(selectedId){
  setSelectMessage(officeSel,'読込中…');
  const loginBtn=document.getElementById('btnLogin');
  officeSel.disabled=false;
  if(pwInput) pwInput.disabled=false;
  if(loginBtn) loginBtn.disabled=false;
  if(loginMsg) loginMsg.textContent='';
  let offices=[];
  let apiFailed=false;
  try{
    const res=await apiPost({ action:'publicListOffices' });
    if(res&&Array.isArray(res.offices)){
      res.offices.forEach(o=>normalizeOfficeEntry(offices,o&&o.id,o&&o.name));
    }
  }catch(err){
    console.error('publicListOffices failed',err);
    apiFailed=true;
  }
  if(offices.length===0){
    offices=configuredOfficesFallback();
  }
  if(offices.length===0){
    officeSel.textContent='';
    setSelectMessage(officeSel, apiFailed ? '取得できませんでした。再読込してください' : '拠点が設定されていません');
    officeSel.disabled=true;
    if(pwInput){ pwInput.value=''; pwInput.disabled=true; }
    if(loginBtn) loginBtn.disabled=true;
    if(loginMsg){
      loginMsg.textContent=apiFailed
        ? '拠点一覧の取得に失敗しました。管理者にお問い合わせください。'
        : '公開拠点がまだ設定されていません。管理者にお問い合わせください。';
    }
    return;
  }
  officeSel.textContent='';
  let found=false;
  offices.forEach(o=>{
    const opt=document.createElement('option');
    opt.value=o.id;
    opt.textContent=o.name;
    officeSel.appendChild(opt);
    if(selectedId && o.id===selectedId) found=true;
  });
  if(officeSel.options.length===0){ ensureAuthUIPublicError(); return; }
  if(selectedId && found) officeSel.value=selectedId; else officeSel.selectedIndex=0;
}
