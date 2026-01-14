/* ツールモーダル＋ポーリング */
let CURRENT_TOOLS = [];
let CURRENT_TOOLS_WARNINGS = [];
let toolsPollTimer = null;
let toolsPollOfficeId = '';
const TOOLS_POLL_INTERVAL = 60 * 1000;

function coerceToolArray(raw){
  if(raw == null) return [];
  if(Array.isArray(raw)) return raw;
  if(typeof raw === 'string'){
    const trimmed = raw.trim();
    if(!trimmed) return [];
    if(trimmed[0] === '[' || trimmed[0] === '{'){
      try{ return coerceToolArray(JSON.parse(trimmed)); }catch(_){ /* fallthrough */ }
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

function coerceToolVisibleFlag(raw){
  if (raw === true || raw == null) return true;
  if (raw === false) return false;
  const s = String(raw).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'hide');
}

function ensureUniqueToolId(ctx, preferred){
  let base=(preferred==null?'':String(preferred)).trim();
  if(!base){ base = `tool_${ctx.seq}`; ctx.seq+=1; }
  let id=base; let i=1;
  while(ctx.seen.has(id)){
    id = `${base}_${i}`; i+=1;
  }
  ctx.seen.add(id);
  return id;
}

function normalizeToolItem(raw, ctx, parentId){
  if(raw == null) return null;
  if(typeof raw === 'string'){
    const text = raw.trim();
    if(!text) return null;
    const id = ensureUniqueToolId(ctx, `tool_${ctx.seq}`);
    return { id, title: text, url:'', note:'', visible:true, display:true, parentId: parentId||'', children: [] };
  }
  if(typeof raw !== 'object') return null;

  const idRaw = raw.id ?? raw.toolId ?? raw.key;
  const id = ensureUniqueToolId(ctx, idRaw);
  const titleSrc = raw.title ?? raw.name ?? raw.label ?? '';
  const urlSrc = raw.url ?? raw.link ?? '';
  const noteSrc = raw.note ?? raw.memo ?? raw.remark ?? '';
  const visible = coerceToolVisibleFlag(raw.visible ?? raw.display ?? raw.show ?? true);
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
  const childrenRaw = coerceToolArray(raw.children ?? raw.items ?? []);
  childrenRaw.forEach(child => {
    const c = normalizeToolItem(child, ctx, id);
    if(c){ ctx.nodes.push(c); }
  });
  return node;
}

function normalizeToolsWithMeta(raw){
  const arr = coerceToolArray(raw);
  const ctx = { seq:0, seen:new Set(), nodes:[], warnings:[] };
  arr.forEach(item=>{
    const n=normalizeToolItem(item, ctx, '');
    if(n){ ctx.nodes.push(n); }
  });

  const filtered = ctx.nodes.filter(n=> n && (n.title || n.url || n.note));
  const map=new Map();
  filtered.forEach(n=>{ n.children=[]; map.set(n.id, n); });

  filtered.forEach(n=>{
    let pid = n.parentId || '';
    if(pid && (!map.has(pid) || pid===n.id)){
      if(pid===n.id){ ctx.warnings.push(`ツール ${n.id} が自身を親にしていたためルートに移動しました`); }
      if(!map.has(pid)){ ctx.warnings.push(`ツール ${n.id} の親 ${pid} が存在しないためルートに移動しました`); }
      pid='';
    }
    n.parentId = pid;
  });

  filtered.forEach(n=>{
    const visited=new Set();
    let pid=n.parentId;
    while(pid){
      if(visited.has(pid)){
        ctx.warnings.push(`ツール ${n.id} の親子関係に循環が見つかったためルートに移動しました`);
        n.parentId='';
        break;
      }
      visited.add(pid);
      const p=map.get(pid);
      if(!p){ n.parentId=''; break; }
      pid=p.parentId;
    }
  });

  filtered.forEach(n=>{
    if(n.parentId && map.has(n.parentId)){
      map.get(n.parentId).children.push(n);
    }
  });

  const roots = filtered.filter(n=> !n.parentId);
  let count=0;
  function prune(list){
    const out=[];
    list.forEach(item=>{
      if(count>=300){ return; }
      count+=1;
      if(item.children?.length){ item.children = prune(item.children); }
      out.push(item);
    });
    return out;
  }
  const pruned = prune(roots);
  if(count < filtered.length){
    ctx.warnings.push('ツールが上限を超えたため一部を省略しました');
  }

  return { list: pruned, warnings: ctx.warnings, flat: filtered };
}

function normalizeTools(raw){
  return normalizeToolsWithMeta(raw).list;
}

function filterVisibleTools(list){
  if(!Array.isArray(list)) return [];
  return list
    .map(item=>{
      if(!item) return null;
      const visible = coerceToolVisibleFlag(item.visible ?? item.display ?? item.show ?? true);
      if(!visible) return null;
      const copy={ ...item };
      copy.children = filterVisibleTools(item.children || []);
      return copy;
    })
    .filter(Boolean);
}

function linkifyToolText(text){
  if(!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  return text.replace(urlRegex, url=> `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
}

function renderToolItems(list, container, depth){
  const visibleTools = filterVisibleTools(list);
  if(visibleTools.length === 0){
    return;
  }
  visibleTools.forEach(tool=>{
    const item=document.createElement('div');
    item.className='tools-item';
    if(depth>0){ item.style.paddingLeft = `${depth*12}px`; }

    const titleRow=document.createElement('div');
    titleRow.className='tools-item-title';
    const hasUrl=!!tool.url;
    const titleEl=document.createElement(hasUrl?'a':'span');
    titleEl.textContent=tool.title || (hasUrl ? tool.url : 'ツール');
    if(hasUrl){
      titleEl.href=tool.url;
      titleEl.target='_blank';
      titleEl.rel='noopener noreferrer';
    }
    titleRow.appendChild(titleEl);
    item.appendChild(titleRow);

    const noteRow=document.createElement('div');
    noteRow.className='tools-item-note';
    noteRow.innerHTML=linkifyToolText(tool.note || '備考：記載なし');
    item.appendChild(noteRow);

    container.appendChild(item);

    if(tool.children && tool.children.length){
      renderToolItems(tool.children, container, depth+1);
    }
  });
}

function renderToolsList(list){
  if(!toolsList) return;
  toolsList.textContent='';
  const normalizedMeta = normalizeToolsWithMeta(list);
  const visibleTools = filterVisibleTools(normalizedMeta.list);
  if(visibleTools.length === 0){
    const empty=document.createElement('div');
    empty.className='tools-empty';
    empty.textContent='ツール情報がまだありません。後で再読み込みしてください。';
    toolsList.appendChild(empty);
    return;
  }
  renderToolItems(visibleTools, toolsList, 0);
}

function applyToolsData(raw, warnings){
  const meta = normalizeToolsWithMeta(raw);
  if(Array.isArray(warnings)){
    meta.warnings = Array.from(new Set([...(meta.warnings||[]), ...warnings]));
  }
  CURRENT_TOOLS = meta.list;
  CURRENT_TOOLS_WARNINGS = meta.warnings || [];
  renderToolsList(CURRENT_TOOLS);
  if(CURRENT_TOOLS_WARNINGS.length && typeof isOfficeAdmin === 'function' && isOfficeAdmin()){
    toast('ツールデータに整合性の警告があります。管理タブを確認してください');
  }
}

async function fetchTools(officeId){
  if(!SESSION_TOKEN){ return { list:[], warnings:[] }; }
  try{
    const params={ action:'getTools', token:SESSION_TOKEN, nocache:'1' };
    const targetOffice=officeId || CURRENT_OFFICE_ID || '';
    if(targetOffice) params.office=targetOffice;
    const res=await apiPost(params);
    if(res && res.tools){
      const meta=normalizeToolsWithMeta(res.tools);
      if(Array.isArray(res.warnings)){
        meta.warnings = Array.from(new Set([...(meta.warnings||[]), ...res.warnings.map(String)]));
      }
      applyToolsData(meta.list, meta.warnings);
      return meta;
    }
    if(res && res.error==='unauthorized'){
      toast('セッションの有効期限が切れました。再度ログインしてください', false);
      await logout();
      return { list:[], warnings:[] };
    }
    if(res && res.error){
      console.error('fetchTools error:', res.error, res.debug||'');
    }
  }catch(err){
    console.error('ツール取得エラー:', err);
  }
  return { list:[], warnings:[] };
}

async function saveTools(tools, officeId){
  if(!SESSION_TOKEN){ return false; }
  try{
    const payload=normalizeTools(tools);
    const params={ action:'setTools', token:SESSION_TOKEN, tools:JSON.stringify(payload) };
    const targetOffice=officeId || CURRENT_OFFICE_ID || '';
    if(targetOffice) params.office=targetOffice;
    const res=await apiPost(params);
    if(res && res.ok){
      const nextTools=Object.prototype.hasOwnProperty.call(res,'tools') ? normalizeTools(res.tools) : payload;
      applyToolsData(nextTools, res.warnings);
      return true;
    }
    if(res && res.error==='forbidden'){
      toast('ツールの編集権限がありません');
      return false;
    }
    if(res && res.error==='unauthorized'){
      toast('セッションの有効期限が切れました。再度ログインしてください', false);
      await logout();
      return false;
    }
    if(res && res.error){
      const debugInfo=res.debug?` (${res.debug})`:'';
      toast('エラー: ' + res.error + debugInfo);
      console.error('setTools error details:', res);
      return false;
    }
    console.error('Unexpected setTools response:', res);
    toast('ツールの保存に失敗しました（不明なレスポンス）');
  }catch(err){
    console.error('ツール保存エラー:', err);
    toast('通信エラーが発生しました: ' + err.message);
  }
  return false;
}

function startToolsPolling(officeId){
  if(toolsPollTimer){ clearInterval(toolsPollTimer); toolsPollTimer=null; }
  if(!SESSION_TOKEN) return;
  toolsPollOfficeId = officeId || CURRENT_OFFICE_ID || '';
  toolsPollTimer = setInterval(()=>{
    fetchTools(toolsPollOfficeId).catch(()=>{});
  }, TOOLS_POLL_INTERVAL);
}

function stopToolsPolling(){
  if(toolsPollTimer){ clearInterval(toolsPollTimer); toolsPollTimer=null; }
}

window.applyToolsData = applyToolsData;
window.renderToolsList = renderToolsList;
window.fetchTools = fetchTools;
window.saveTools = saveTools;
window.normalizeTools = normalizeTools;
window.normalizeToolsWithMeta = normalizeToolsWithMeta;
window.coerceToolVisibleFlag = coerceToolVisibleFlag;
window.startToolsPolling = startToolsPolling;
window.stopToolsPolling = stopToolsPolling;
