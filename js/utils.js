/* ユーティリティ */
function toast(msg,ok=true){
  if(!toastEl) return;
  if(toastEl._toastTimer){ clearTimeout(toastEl._toastTimer); }
  toastEl.textContent='';
  const panel=document.createElement('div');
  panel.className='toast-panel';
  panel.textContent=msg;
  toastEl.appendChild(panel);
  toastEl.classList.remove('toast--error','toast--success');
  toastEl.classList.add(ok?'toast--success':'toast--error','show');
  toastEl._toastTimer=setTimeout(()=>{
    toastEl.classList.remove('show');
  }, 2400);
}
function diagAdd(line){
  diag.classList.add('show');
  const div=document.createElement('div');
  div.textContent=line;
  diag.appendChild(div);
}
function stripCtl(s){ return (s==null?'':String(s)).replace(/[\u0000-\u001F\u007F]/g,''); }
function sanitizeText(s){
  s = stripCtl(s);

  return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const ID_RE=/^[0-9A-Za-z_-]+$/;

function el(tag,attrs={},children=[]){ const e=document.createElement(tag); for(const [k,v] of Object.entries(attrs||{})){ if(v==null) continue; if(k==='class') e.className=v; else if(k==='text') e.textContent=String(v); else e.setAttribute(k,String(v)); } (children||[]).forEach(c=>e.appendChild(typeof c==='string'?document.createTextNode(c):c)); return e; }
function qsEncode(obj){ const p=new URLSearchParams(); Object.entries(obj||{}).forEach(([k,v])=>{ if(v==null) return; p.append(k,String(v)); }); return p.toString(); }
async function apiPost(params,timeout=20000){ const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),timeout); try{ const res=await fetch(REMOTE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:qsEncode(params),signal:controller.signal,credentials:'omit',cache:'no-store'}); const ct=(res.headers.get('content-type')||'').toLowerCase(); if(!ct.includes('application/json')) return {ok:false,error:'invalid_content_type'}; return await res.json(); }catch(err){ console.error(err); return {ok:false,error:err}; } finally{ clearTimeout(t); }}
/* セッションメタ(F5耐性) */
function saveSessionMeta(){ try{ sessionStorage.setItem(SESSION_ROLE_KEY,CURRENT_ROLE||'user'); sessionStorage.setItem(SESSION_OFFICE_KEY,CURRENT_OFFICE_ID||''); sessionStorage.setItem(SESSION_OFFICE_NAME_KEY,CURRENT_OFFICE_NAME||''); }catch{} }
function loadSessionMeta(){ try{ CURRENT_ROLE=sessionStorage.getItem(SESSION_ROLE_KEY)||'user'; CURRENT_OFFICE_ID=sessionStorage.getItem(SESSION_OFFICE_KEY)||''; CURRENT_OFFICE_NAME=sessionStorage.getItem(SESSION_OFFICE_NAME_KEY)||''; }catch{} }
