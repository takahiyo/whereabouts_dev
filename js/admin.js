/* 管理UIイベント */
if(adminOfficeSel){
  adminOfficeSel.addEventListener('change', ()=>{
    adminSelectedOfficeId=adminOfficeSel.value||'';
    adminMembersLoaded=false; adminMemberList=[]; setMemberTableMessage('読み込み待ち');
    adminToolsLoaded=false; adminToolsOfficeId='';
    refreshVacationOfficeOptions();
    if(document.getElementById('tabMembers')?.classList.contains('active')){
      loadAdminMembers(true);
    }
    if(document.getElementById('tabEvents')?.classList.contains('active')){
      loadVacationsList();
    }
    if(document.getElementById('tabTools')?.classList.contains('active')){
      loadAdminTools(true);
    }
  });
}
if(vacationOfficeSelect){
  vacationOfficeSelect.addEventListener('change', async ()=>{
    const officeId=vacationOfficeSelect.value||adminSelectedOfficeId||CURRENT_OFFICE_ID||'';
    if(typeof fetchNotices==='function'){
      await fetchNotices(officeId);
    }
    refreshVacationNoticeOptions();
  });
}
btnExport.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  const cfg=await adminGetConfigFor(office);
  const dat=await adminGetFor(office);
  if(!(cfg&&cfg.groups) || !(dat&&typeof dat.data==='object')){ toast('エクスポート失敗',false); return; }
  const csv=makeNormalizedCSV(cfg,dat.data);
  const BOM=new Uint8Array([0xEF,0xBB,0xBF]);
  const bytes=new TextEncoder().encode(csv);
  const blob=new Blob([BOM,bytes],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`presence_${office}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
});
btnImport.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  const file=csvFile.files&&csvFile.files[0];
  if(!file){ toast('CSVを選択してください',false); return; }

  const text=await file.text();
  const rows=parseCSV(text);
  if(!rows.length){ toast('CSVが空です',false); return; }
  const titleMarkers=['在席管理CSV','whereabouts presence csv'];
  const titleRowDetected = (rows[0]||[]).length===1 && titleMarkers.some(t=>{
    const cell=(rows[0][0]||'').trim().toLowerCase();
    return cell && (cell===t.toLowerCase() || cell.startsWith(t.toLowerCase()));
  });
  const headerRowIndex = titleRowDetected ? 1 : 0;
  if(rows.length<=headerRowIndex){ toast('CSVヘッダが不正です',false); return; }
  const hdr=rows[headerRowIndex].map(s=>s.trim());
  const modernEn=['group_index','group_title','member_order','id','name','ext','mobile','email','workHours','status','time','note'];
  const modernJa=['グループ番号','グループ名','表示順','id','氏名','内線','携帯番号','Email','業務時間','ステータス','戻り時間','備考'];
  const mustEn=['group_index','group_title','member_order','id','name','ext','workHours','status','time','note'];
  const mustJa=['グループ番号','グループ名','表示順','id','氏名','内線','業務時間','ステータス','戻り時間','備考'];
  const legacyEn=['group_index','group_title','member_order','id','name','ext','status','time','note'];
  const legacyJa=['グループ番号','グループ名','表示順','id','氏名','内線','ステータス','戻り時間','備考'];
  const okModernEn = modernEn.every((h,i)=>hdr[i]===h);
  const okModernJa = modernJa.every((h,i)=>hdr[i]===h);
  const okEn = mustEn.every((h,i)=>hdr[i]===h);
  const okJa = mustJa.every((h,i)=>hdr[i]===h);
  const okLegacyEn = legacyEn.every((h,i)=>hdr[i]===h);
  const okLegacyJa = legacyJa.every((h,i)=>hdr[i]===h);
  if(!(okModernEn || okModernJa || okEn || okJa || okLegacyEn || okLegacyJa)){ toast('CSVヘッダが不正です',false); return; }
  const hasWorkHoursColumn = okModernEn || okModernJa || okEn || okJa;
  const hasContactColumn = okModernEn || okModernJa;
  const keyOf=(gi,gt,mi,name,ext)=>[String(gi),String(gt||''),String(mi),String(name||''),String(ext||'')].join('|');

  const fallbackById=new Map();
  const fallbackByKey=new Map();
  if(!hasWorkHoursColumn){
    try{
      const currentCfg=await adminGetConfigFor(office);
      if(currentCfg && currentCfg.groups){
        (currentCfg.groups||[]).forEach((g,gi0)=>{
          (g.members||[]).forEach((m,mi0)=>{
            const val = m.workHours == null ? '' : String(m.workHours);
            if(!val) return;
            if(m.id) fallbackById.set(String(m.id), val);
            fallbackByKey.set(keyOf(gi0+1,g.title||'',mi0+1,m.name||'',m.ext||''), val);
          });
        });
      }
    }catch{}
  }

  const recs=rows.slice(headerRowIndex+1).filter(r=>r.some(x=>(x||'').trim()!=='')).map(r=>{
    if(hasContactColumn){
      const [gi,gt,mi,id,name,ext,mobile,email,workHours,status,time,note]=r;
      const workHoursValue = workHours == null ? '' : String(workHours);
      return {
        gi:Number(gi)||0,
        gt:(gt||''),
        mi:Number(mi)||0,
        id:(id||''),
        name:(name||''),
        ext:(ext||''),
        mobile:(mobile||''),
        email:(email||''),
        workHours:workHoursValue,
        status:(status||(STATUSES[0]?.value||'在席')),
        time:(time||''),
        note:(note||'')
      };
    } else if(hasWorkHoursColumn){
      const [gi,gt,mi,id,name,ext,workHours,status,time,note]=r;
      const workHoursValue = workHours == null ? '' : String(workHours);
      return {
        gi:Number(gi)||0,
        gt:(gt||''),
        mi:Number(mi)||0,
        id:(id||''),
        name:(name||''),
        ext:(ext||''),
        mobile:'',
        email:'',
        workHours:workHoursValue,
        status:(status||(STATUSES[0]?.value||'在席')),
        time:(time||''),
        note:(note||'')
      };
    } else {
      const [gi,gt,mi,id,name,ext,status,time,note]=r;
      const key=keyOf(gi,gt,mi,name,ext||'');
      const fallback=(id&&fallbackById.get(id))||fallbackByKey.get(key)||'';
      const workHoursValue = fallback == null ? '' : String(fallback);
      return {
        gi:Number(gi)||0,
        gt:(gt||''),
        mi:Number(mi)||0,
        id:(id||''),
        name:(name||''),
        ext:(ext||''),
        mobile:'',
        email:'',
        workHours:workHoursValue,
        status:(status||(STATUSES[0]?.value||'在席')),
        time:(time||''),
        note:(note||'')
      };
    }
  });

  const groupsMap=new Map();
  for(const r of recs){
    if(!r.gi||!r.mi||!r.name) continue;
    if(!groupsMap.has(r.gi)) groupsMap.set(r.gi,{title:r.gt||'',members:[]});
    const g=groupsMap.get(r.gi);
    g.title=r.gt||'';
    g.members.push({_mi:r.mi,name:r.name,ext:r.ext||'',mobile:r.mobile||'',email:r.email||'',workHours:r.workHours||'',id:r.id||undefined});
  }
  const groups=Array.from(groupsMap.entries()).sort((a,b)=>a[0]-b[0]).map(([gi,g])=>{ g.members.sort((a,b)=>(a._mi||0)-(b._mi||0)); g.members.forEach(m=>delete m._mi); return g; });
  const cfgToSet={version:2,updated:Date.now(),groups,menus:MENUS||undefined};
  const r1=await adminSetConfigFor(office,cfgToSet);
  if(!r1 || r1.error){ toast('名簿の設定に失敗',false); return; }

  const newCfg=await adminGetConfigFor(office);
  if(!(newCfg&&newCfg.groups)){ toast('名簿再取得に失敗',false); return; }

  const idIndex=new Map();
  (newCfg.groups||[]).forEach((g,gi0)=>{ (g.members||[]).forEach((m,mi0)=>{ idIndex.set(keyOf(gi0+1,g.title||'',mi0+1,m.name||'',m.ext||''),m.id); }); });

  const dataObj={};
  for(const r of recs){
    const id=r.id || idIndex.get(keyOf(r.gi,r.gt,r.mi,r.name,r.ext||'')) || null;
    if(!id) continue;
    const workHours=r.workHours||'';
    dataObj[id]={ ext:r.ext||'', mobile:r.mobile||'', email:r.email||'', workHours, status: STATUSES.some(s=>s.value===r.status)? r.status : (STATUSES[0]?.value||'在席'), time:r.time||'', note:r.note||'' };
  }
  const r2=await adminSetForChunked(office,dataObj);
  if(!(r2&&r2.ok)){ toast('在席データ更新に失敗',false); return; }
  toast('インポート完了',true);
});
btnRenameOffice.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  const name=(renameOfficeName.value||'').trim();
  if(!name){ toast('新しい拠点名を入力',false); return; }
  const r=await adminRenameOffice(office,name);
  if(r&&r.ok){ toast('拠点名を変更しました'); }
  else toast('変更に失敗',false);
});

btnSetPw.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  const pw=(setPw.value||'').trim();
  const apw=(setAdminPw.value||'').trim();
  if(!pw&&!apw){ toast('更新する項目を入力',false); return; }
  const r=await adminSetOfficePassword(office,pw,apw);
  if(r&&r.ok){ toast('パスワードを更新しました'); setPw.value=''; setAdminPw.value=''; }
  else toast('更新に失敗',false);
});

/* 管理モーダルのタブ切り替え */
if(adminModal){
  const adminTabButtons = adminModal.querySelectorAll('.admin-tabs .tab-btn');
  const adminTabPanels = adminModal.querySelectorAll('.tab-panel');

  adminTabButtons.forEach(btn => {
    btn.addEventListener('click', async ()=> {
      const targetTab = btn.dataset.tab;

      adminTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      adminTabPanels.forEach(panel => panel.classList.remove('active'));
      const panelMap={
        basic: adminModal.querySelector('#tabBasic'),
        members: adminModal.querySelector('#tabMembers'),
        notices: adminModal.querySelector('#tabNotices'),
        events: adminModal.querySelector('#tabEvents'),
        tools: adminModal.querySelector('#tabTools')
      };
      const panel=panelMap[targetTab];
      if(panel) panel.classList.add('active');

      if(targetTab === 'notices'){
        if(typeof autoLoadNoticesOnAdminOpen === 'function'){
          await autoLoadNoticesOnAdminOpen();
        }
      } else if(targetTab === 'basic'){
        // no-op for now
      } else if(targetTab === 'members'){
        if(!adminMembersLoaded){ await loadAdminMembers(); }
      } else if(targetTab === 'events'){
        refreshVacationOfficeOptions();
        const officeId=(vacationOfficeSelect?.value)||adminSelectedOfficeId||CURRENT_OFFICE_ID||'';
        if(typeof fetchNotices === 'function'){
          await fetchNotices(officeId);
        }
        refreshVacationNoticeOptions();
        await loadVacationsList();
      } else if(targetTab === 'tools'){
        await loadAdminTools();
      }
    });
  });
}

/* メンバー管理 */
let adminMemberList=[], adminMemberData={}, adminGroupOrder=[], adminMembersLoaded=false;
let adminToolsLoaded=false, adminToolsOfficeId='';

if(btnMemberReload){ btnMemberReload.addEventListener('click', ()=> loadAdminMembers(true)); }
if(btnMemberSave){ btnMemberSave.addEventListener('click', ()=> handleMemberSave()); }
if(memberEditForm){
  memberEditForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    submitMemberEdit();
  });
}
if(memberEditReset){ memberEditReset.addEventListener('click', ()=> openMemberEditor(null)); }
if(memberFilterInput){ memberFilterInput.addEventListener('input', renderMemberTable); }
if(btnMemberFilterClear){
  btnMemberFilterClear.addEventListener('click', ()=>{
    memberFilterInput.value='';
    renderMemberTable();
  });
}

function setMemberTableMessage(msg){
  if(!memberTableBody) return;
  memberTableBody.textContent='';
  const tr=document.createElement('tr');
  const td=document.createElement('td');
  td.colSpan=7; td.style.textAlign='center'; td.style.color='#6b7280';
  td.textContent=msg;
  tr.appendChild(td);
  memberTableBody.appendChild(tr);
}

async function loadAdminMembers(force){
  const office=selectedOfficeId(); if(!office) return;
  if(force!==true && adminMembersLoaded && adminMemberList.length){ return; }
  try{
    setMemberTableMessage('読み込み中...');
    const [cfg,dataRes]=await Promise.all([
      adminGetConfigFor(office),
      adminGetFor(office)
    ]);
    if(!(cfg&&Array.isArray(cfg.groups))){ setMemberTableMessage('設定の取得に失敗しました'); return; }
    adminMemberData=(dataRes&&dataRes.data&&typeof dataRes.data==='object')?dataRes.data:{};
    adminGroupOrder=(cfg.groups||[]).map(g=>String(g.title||''));
    adminMemberList=[];
    const seenIds=new Set();
    cfg.groups.forEach((g)=>{
      (g.members||[]).forEach((m,mi)=>{
        const idRaw=String(m.id||'').trim();
        const id=idRaw||generateMemberId();
        if(seenIds.has(id)){ return; }
        seenIds.add(id);
        adminMemberList.push({
          id,
          name:String(m.name||''),
          ext:String(m.ext||''),
          mobile:String(m.mobile||''),
          email:String(m.email||''),
          workHours:(m.workHours==null?'':String(m.workHours)),
          group:String(g.title||''),
          order:mi
        });
      });
    });
    normalizeMemberOrdering();
    renderMemberTable();
    openMemberEditor(null);
    adminMembersLoaded=true;
  }catch(err){
    console.error('loadAdminMembers error',err);
    setMemberTableMessage('メンバーの取得に失敗しました');
  }
}

function normalizeMemberOrdering(){
  const orderBase=[...adminGroupOrder];
  adminMemberList.forEach(m=>{ if(m.group && !orderBase.includes(m.group)){ orderBase.push(m.group); } });
  adminGroupOrder=orderBase;
  adminMemberList.sort((a,b)=>{
    const ga=orderBase.indexOf(a.group); const gb=orderBase.indexOf(b.group);
    if(ga!==gb) return ga-gb;
    return (a.order||0)-(b.order||0);
  });
  const counters=new Map();
  adminMemberList.forEach(m=>{
    const cur=counters.get(m.group)||0;
    m.order=cur;
    counters.set(m.group,cur+1);
  });
}

function filteredMemberList(){
  const term=(memberFilterInput?.value||'').trim().toLowerCase();
  if(!term){ return [...adminMemberList]; }
  const words=term.split(/\s+/).filter(Boolean);
  return adminMemberList.filter(m=>{
    const name=(m.name||'').toLowerCase();
    return words.every(w=> name.includes(w));
  });
}

function renderMemberTable(){
  if(!memberTableBody){ return; }
  memberTableBody.textContent='';
  if(!adminMemberList.length){
    setMemberTableMessage('メンバーが登録されていません');
    return;
  }
  const rows=filteredMemberList();
  if(!rows.length){
    setMemberTableMessage('条件に一致するメンバーが見つかりません');
    return;
  }
  rows.forEach((m,idx)=>{
    const tr=document.createElement('tr');
    tr.dataset.memberId=m.id;
    const orderTd=document.createElement('td');
    orderTd.innerHTML=`<div class="member-row-actions"><span class="member-drag-handle" draggable="true" title="ドラッグで並び替え">⇅</span><span>#${idx+1}</span></div>`;
    const groupTd=document.createElement('td'); groupTd.textContent=m.group||'';
    const nameTd=document.createElement('td'); nameTd.textContent=m.name||'';
    const extTd=document.createElement('td'); extTd.className='numeric-cell'; extTd.textContent=m.ext||'';
    const mobileTd=document.createElement('td'); mobileTd.className='numeric-cell'; mobileTd.textContent=m.mobile||'';
    const emailTd=document.createElement('td');
    if(m.email){
      const [localPart, domainPart] = m.email.split('@');
      const emailWrap=document.createElement('div'); emailWrap.className='member-email';
      const localSpan=document.createElement('span'); localSpan.textContent=localPart || m.email; emailWrap.appendChild(localSpan);
      if(domainPart!==undefined){
        const domainSpan=document.createElement('span'); domainSpan.className='email-domain'; domainSpan.textContent='@'+domainPart; emailWrap.appendChild(domainSpan);
      }
      emailTd.appendChild(emailWrap);
    }
    const actionTd=document.createElement('td'); actionTd.className='member-row-actions';
    const editBtn=document.createElement('button'); editBtn.textContent='編集'; editBtn.className='btn-secondary';
    editBtn.addEventListener('click', ()=> openMemberEditor(m));
    const delBtn=document.createElement('button'); delBtn.textContent='削除'; delBtn.className='btn-danger';
    delBtn.addEventListener('click', ()=> deleteMember(m.id));
    const upBtn=document.createElement('button'); upBtn.textContent='▲'; upBtn.title='上に移動';
    upBtn.addEventListener('click', ()=> moveMember(m.id,-1));
    const downBtn=document.createElement('button'); downBtn.textContent='▼'; downBtn.title='下に移動';
    downBtn.addEventListener('click', ()=> moveMember(m.id,1));
    actionTd.append(editBtn, delBtn, upBtn, downBtn);
    tr.append(orderTd, groupTd, nameTd, extTd, mobileTd, emailTd, actionTd);
    memberTableBody.appendChild(tr);
  });
  enableMemberDrag();
}

function enableMemberDrag(){
  if(!memberTableBody) return;
  let draggingId='';
  memberTableBody.querySelectorAll('.member-drag-handle').forEach(handle=>{
    handle.addEventListener('dragstart', (e)=>{
      const row=e.target.closest('tr');
      draggingId=row?.dataset.memberId||'';
      handle.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
    });
    handle.addEventListener('dragend', ()=>{
      draggingId=''; handle.classList.remove('dragging');
      memberTableBody.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over'));
    });
  });
  memberTableBody.querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('dragover', (e)=>{
      if(!draggingId) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
      const targetId=tr.dataset.memberId||'';
      if(!targetId || targetId===draggingId) return;
      const draggingIdx=adminMemberList.findIndex(x=>x.id===draggingId);
      const targetIdx=adminMemberList.findIndex(x=>x.id===targetId);
      if(draggingIdx<0||targetIdx<0) return;
      const dragging=adminMemberList[draggingIdx];
      const target=adminMemberList[targetIdx];
      if(dragging.group!==target.group) return;
      const rect=tr.getBoundingClientRect();
      const before=e.clientY < rect.top + rect.height/2;
      adminMemberList.splice(draggingIdx,1);
      const insertIdx = before ? targetIdx : targetIdx+1;
      adminMemberList.splice(insertIdx>draggingIdx?insertIdx-1:insertIdx,0,dragging);
      normalizeMemberOrdering();
      renderMemberTable();
    });
  });
}

function openMemberEditor(member){
  if(memberEditId) memberEditId.value=member?.id||'';
  if(memberEditName) memberEditName.value=member?.name||'';
  if(memberEditExt) memberEditExt.value=member?.ext||'';
  if(memberEditMobile) memberEditMobile.value=member?.mobile||'';
  if(memberEditEmail) memberEditEmail.value=member?.email||'';
  if(memberEditGroup) memberEditGroup.value=member?.group||'';
  if(memberEditModeLabel){
    memberEditModeLabel.textContent = member ? `編集中：${member.name||''}` : '新規追加／編集フォーム';
  }
  refreshMemberGroupOptions();
  if(memberEditName){
    memberEditName.focus({ preventScroll:true });
  }
}

function refreshMemberGroupOptions(){
  if(!memberGroupOptions) return;
  const groups=[...new Set(adminGroupOrder.filter(Boolean))];
  memberGroupOptions.textContent='';
  groups.forEach(g=>{
    const opt=document.createElement('option'); opt.value=g; memberGroupOptions.appendChild(opt);
  });
}

function submitMemberEdit(){
  const name=(memberEditName?.value||'').trim();
  const ext=(memberEditExt?.value||'').trim();
  const mobile=(memberEditMobile?.value||'').trim();
  const email=(memberEditEmail?.value||'').trim();
  const group=(memberEditGroup?.value||'').trim();
  const idRaw=(memberEditId?.value||'').trim();
  if(!name){ toast('氏名は必須です',false); return; }
  if(!group){ toast('所属グループを入力してください',false); return; }
  if(ext && !/^\d{1,6}$/.test(ext.replace(/[^0-9]/g,''))){ toast('内線は数字のみで入力してください（最大6桁）',false); return; }
  const mobileDigits=mobile.replace(/[^0-9]/g,'');
  if(mobile && (mobileDigits.length<10 || mobileDigits.length>11)){ toast('携帯番号は10〜11桁の数字で入力してください（ハイフン可）',false); return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast('Emailの形式が不正です',false); return; }
  const id=idRaw||generateUniqueMemberId();
  const existingIdx=adminMemberList.findIndex(m=>m.id===id);
  if(existingIdx>=0){
    adminMemberList[existingIdx]={ ...adminMemberList[existingIdx], id, name, ext, mobile, email, group };
  }else{
    const order=adminMemberList.filter(m=>m.group===group).length;
    adminMemberList.push({ id, name, ext, mobile, email, group, order, workHours:'' });
  }
  normalizeMemberOrdering();
  renderMemberTable();
  openMemberEditor(null);
}

function generateMemberId(){ return `member_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }
function generateUniqueMemberId(){ let id=''; do{ id=generateMemberId(); }while(adminMemberList.some(m=>m.id===id)); return id; }

function deleteMember(id){
  if(!id) return; if(!confirm('このメンバーを削除しますか？')) return;
  adminMemberList=adminMemberList.filter(m=>m.id!==id);
  normalizeMemberOrdering();
  renderMemberTable();
}

function moveMember(id,dir){
  const idx=adminMemberList.findIndex(m=>m.id===id); if(idx<0) return;
  const group=adminMemberList[idx].group;
  let targetIdx=idx+dir;
  while(targetIdx>=0 && targetIdx<adminMemberList.length && adminMemberList[targetIdx].group!==group){
    targetIdx+=dir;
  }
  if(targetIdx<0||targetIdx>=adminMemberList.length) return;
  const tmp=adminMemberList[targetIdx];
  adminMemberList[targetIdx]=adminMemberList[idx];
  adminMemberList[idx]=tmp;
  normalizeMemberOrdering();
  renderMemberTable();
}

function buildMemberSavePayload(){
  const errors=[]; const idSet=new Set();
  const defaultStatus = STATUSES[0]?.value || '在席';
  const cleaned=adminMemberList.map(m=>({
    ...m,
    name:(m.name||'').trim(),
    group:(m.group||'').trim(),
    ext:(m.ext||'').trim(),
    mobile:(m.mobile||'').trim(),
    email:(m.email||'').trim()
  }));
  for(const m of cleaned){
    if(!m.name){ errors.push('missing_name'); break; }
    if(!m.group){ errors.push('missing_group'); break; }
    if(m.ext && !/^\d{1,6}$/.test(m.ext.replace(/[^0-9]/g,''))){ errors.push('invalid_ext'); break; }
    const mobileDigits=m.mobile.replace(/[^0-9]/g,'');
    if(m.mobile && (mobileDigits.length<10 || mobileDigits.length>11)){ errors.push('invalid_mobile'); break; }
    if(m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)){ errors.push('invalid_email'); break; }
    if(idSet.has(m.id)){ errors.push('duplicate_id'); break; }
    idSet.add(m.id);
  }
  if(errors.length){ return { errors }; }

  const groupOrder=[...adminGroupOrder];
  cleaned.forEach(m=>{ if(m.group && !groupOrder.includes(m.group)) groupOrder.push(m.group); });
  const grouped=new Map();
  cleaned.forEach(m=>{
    const list=grouped.get(m.group)||[]; list.push(m); grouped.set(m.group,list);
  });
  const groups=[];
  groupOrder.forEach(gName=>{
    const mems=grouped.get(gName)||[];
    if(!mems.length) return;
    mems.sort((a,b)=> (a.order||0)-(b.order||0));
    groups.push({
      title:gName,
      members:mems.map((m,idx)=>({ id:m.id, name:m.name, ext:m.ext, mobile:m.mobile, email:m.email, workHours:m.workHours||'', _order:idx }))
    });
  });

  const dataObj={};
  groups.forEach(g=>{
    g.members.forEach(m=>{
      const existing=adminMemberData[m.id]||{};
      dataObj[m.id]={
        ext:m.ext||'',
        mobile:m.mobile||'',
        email:m.email||'',
        workHours: existing.workHours==null?'':String(existing.workHours||m.workHours||''),
        status: STATUSES.some(s=>s.value===existing.status)? existing.status : defaultStatus,
        time: existing.time||'',
        note: existing.note||''
      };
    });
  });

  groups.forEach(g=> g.members.forEach(m=> delete m._order));
  return { groups, dataObj };
}

async function handleMemberSave(){
  const office=selectedOfficeId(); if(!office) return;
  const { groups, dataObj, errors } = buildMemberSavePayload();
  if(errors){
    if(errors.includes('missing_name')){ toast('氏名は必須です',false); return; }
    if(errors.includes('missing_group')){ toast('所属グループを入力してください',false); return; }
    if(errors.includes('invalid_ext')){ toast('内線は数字のみで最大6桁です',false); return; }
    if(errors.includes('invalid_mobile')){ toast('携帯番号は10〜11桁の数字で入力してください',false); return; }
    if(errors.includes('invalid_email')){ toast('Emailの形式が不正です',false); return; }
    if(errors.includes('duplicate_id')){ toast('IDが重複しています。編集画面で修正してください',false); return; }
    toast('入力内容を確認してください',false); return;
  }
  try{
    const cfgToSet={ version:2, updated:Date.now(), groups, menus:MENUS||undefined };
    const r1=await adminSetConfigFor(office,cfgToSet);
    if(!(r1&&r1.ok!==false)){ toast('名簿の保存に失敗しました',false); return; }
    const r2=await adminSetForChunked(office,dataObj);
    if(!(r2&&r2.ok!==false)) toast('在席データの保存に失敗しました',false);
    else toast('保存しました');
  }catch(err){
    console.error('handleMemberSave error',err);
    toast('保存に失敗しました',false);
  }
}

/* お知らせ管理UI */
btnAddNotice.addEventListener('click', ()=> addNoticeEditorItem());
btnLoadNotices.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  try{
    const params = { action:'getNotices', token:SESSION_TOKEN, nocache:'1', office };
    const res=await apiPost(params);
    console.log('getNotices response:', res);
    if(res && res.notices){
      noticesEditor.innerHTML='';
      if(res.notices.length === 0){
        addNoticeEditorItem();
      } else {
        res.notices.forEach((n, idx)=> {
          const visible = (n && n.visible !== false) ? true : (n && n.display !== false);
          const id = n && (n.id != null ? n.id : (n.noticeId != null ? n.noticeId : idx));
          addNoticeEditorItem(n.title, n.content, visible !== false, id);
        });
      }
      toast('お知らせを読み込みました');
    } else if(res && res.error){
      toast('エラー: ' + res.error, false);
    }
  }catch(e){
    console.error('Load notices error:', e);
    toast('お知らせの読み込みに失敗',false);
  }
});
btnSaveNotices.addEventListener('click', async ()=>{
  const office=selectedOfficeId(); if(!office) return;
  const items=noticesEditor.querySelectorAll('.notice-edit-item');
  const notices=[];
  items.forEach((item, idx)=>{
    const title=(item.querySelector('.notice-edit-title').value||'').trim();
    const content=(item.querySelector('.notice-edit-content').value||'').trim();
    const displayToggle = item.querySelector('.notice-display-toggle');
    const visible = displayToggle ? displayToggle.checked : true;
    if(title || content){
      const id = item.dataset.noticeId || `notice_${Date.now()}_${idx}`;
      notices.push({ id, title, content, visible, display: visible });
    }
  });
  
  console.log('Saving notices:', notices, 'for office:', office);
  const success=await saveNotices(notices, office);
  if(success) toast('お知らせを保存しました');
  else toast('お知らせの保存に失敗',false);
});

function addNoticeEditorItem(title='', content='', visible=true, id=null){
  const item=document.createElement('div');
  item.className='notice-edit-item' + (visible ? '' : ' hidden-notice');
  item.draggable=true;
  if(id != null) item.dataset.noticeId = String(id);
  item.innerHTML=`
    <span class="notice-edit-handle">⋮⋮</span>
    <div class="notice-edit-row">
      <input type="text" class="notice-edit-title" placeholder="タイトル" value="${escapeHtml(title)}">
      <div class="notice-edit-controls">
        <label class="notice-visibility-toggle"><input type="checkbox" class="notice-display-toggle" ${visible ? 'checked' : ''}> 表示する</label>
        <button class="btn-move-up" title="上に移動">▲</button>
        <button class="btn-move-down" title="下に移動">▼</button>
        <button class="btn-remove-notice">削除</button>
      </div>
    </div>
    <textarea class="notice-edit-content" placeholder="内容（省略可）&#10;URLを記載すると自動的にリンクになります">${escapeHtml(content)}</textarea>
  `;
  
  // 削除ボタン
  item.querySelector('.btn-remove-notice').addEventListener('click', ()=> {
    if(confirm('このお知らせを削除しますか？')){
      item.remove();
      updateMoveButtons();
    }
  });

  const displayToggle = item.querySelector('.notice-display-toggle');
  if(displayToggle){
    displayToggle.addEventListener('change', ()=>{
      if(displayToggle.checked){
        item.classList.remove('hidden-notice');
      }else{
        item.classList.add('hidden-notice');
      }
    });
  }
  
  // 上に移動ボタン
  item.querySelector('.btn-move-up').addEventListener('click', ()=> {
    const prev = item.previousElementSibling;
    if(prev){
      noticesEditor.insertBefore(item, prev);
      updateMoveButtons();
    }
  });
  
  // 下に移動ボタン
  item.querySelector('.btn-move-down').addEventListener('click', ()=> {
    const next = item.nextElementSibling;
    if(next){
      noticesEditor.insertBefore(next, item);
      updateMoveButtons();
    }
  });
  
  // ドラッグ&ドロップイベント
  item.addEventListener('dragstart', (e)=> {
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  
  item.addEventListener('dragend', ()=> {
    item.classList.remove('dragging');
    document.querySelectorAll('.notice-edit-item').forEach(i=> i.classList.remove('drag-over'));
  });
  
  item.addEventListener('dragover', (e)=> {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = noticesEditor.querySelector('.dragging');
    if(dragging && dragging !== item){
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if(e.clientY < midpoint){
        noticesEditor.insertBefore(dragging, item);
      } else {
        noticesEditor.insertBefore(dragging, item.nextSibling);
      }
    }
  });
  
  noticesEditor.appendChild(item);
  updateMoveButtons();
}

// 上下移動ボタンの有効/無効を更新
function updateMoveButtons(){
  const items = noticesEditor.querySelectorAll('.notice-edit-item');
  items.forEach((item, index)=> {
    const upBtn = item.querySelector('.btn-move-up');
    const downBtn = item.querySelector('.btn-move-down');
    if(upBtn) upBtn.disabled = (index === 0);
    if(downBtn) downBtn.disabled = (index === items.length - 1);
  });
}

/* ツール管理UI */
if(btnAddTool){ btnAddTool.addEventListener('click', ()=> addToolEditorItem()); }
if(btnLoadTools){ btnLoadTools.addEventListener('click', ()=> loadAdminTools(true)); }
if(btnSaveTools){
  btnSaveTools.addEventListener('click', async ()=>{
    const office=selectedOfficeId(); if(!office) return;
    const items=toolsEditor.querySelectorAll('.tool-edit-item');
    const tools=[];
    items.forEach((item, idx)=>{
      const title=(item.querySelector('.tool-edit-title').value||'').trim();
      const url=(item.querySelector('.tool-edit-url').value||'').trim();
      const note=(item.querySelector('.tool-edit-note').value||'').trim();
      const toggle=item.querySelector('.tool-display-toggle');
      const visible=toggle?toggle.checked:true;
      if(!title && !url && !note) return;
      let childrenRaw=[];
      try{
        const stored=item.dataset.children||'[]';
        childrenRaw=JSON.parse(stored);
      }catch{}
      const normalizedChildren=Array.isArray(childrenRaw)?normalizeTools(childrenRaw):[];
      const id=item.dataset.toolId || `tool_${Date.now()}_${idx}`;
      tools.push({ id, title, url, note, visible, display: visible, children: normalizedChildren });
    });

    const success=await saveTools(tools, office);
    if(success){
      adminToolsLoaded=true; adminToolsOfficeId=office;
      toast('ツールを保存しました');
    }else{
      toast('ツールの保存に失敗',false);
    }
  });
}

async function loadAdminTools(force=false){
  const office=selectedOfficeId(); if(!office) return;
  if(!force && adminToolsLoaded && adminToolsOfficeId===office) return;
  try{
    const result=await fetchTools(office);
    const normalized=Array.isArray(result?.list)?result.list:(Array.isArray(result)?result:[]);
    buildToolsEditor(normalized);
    if(!normalized.length){
      addToolEditorItem();
    }
    adminToolsLoaded=true; adminToolsOfficeId=office;
    if(force){ toast('ツールを読み込みました'); }
  }catch(err){
    console.error('loadAdminTools error', err);
    toast('ツールの読み込みに失敗',false);
  }
}

function buildToolsEditor(list){
  if(!toolsEditor) return;
  toolsEditor.innerHTML='';
  const normalized = normalizeTools(list||[]);
  if(!normalized.length){
    addToolEditorItem();
    return;
  }
  normalized.forEach((tool, idx)=>{
    const visible=coerceToolVisibleFlag(tool?.visible ?? tool?.display ?? true);
    addToolEditorItem(tool?.title||'', tool?.url||'', tool?.note||'', visible, tool?.children||[], tool?.id ?? idx);
  });
}

function addToolEditorItem(title='', url='', note='', visible=true, children=null, id=null){
  const item=document.createElement('div');
  item.className='tool-edit-item' + (visible ? '' : ' hidden-tool');
  item.draggable=true;
  if(id!=null) item.dataset.toolId=String(id);
  if(children!=null){
    try{ item.dataset.children=JSON.stringify(children); }catch{}
  }
  item.innerHTML=`
    <span class="tool-edit-handle">⋮⋮</span>
    <div class="tool-edit-row">
      <input type="text" class="tool-edit-title" placeholder="タイトル" value="${escapeHtml(title)}">
      <input type="url" class="tool-edit-url" placeholder="URL" value="${escapeHtml(url)}">
      <div class="tool-edit-controls">
        <label class="tool-visibility-toggle"><input type="checkbox" class="tool-display-toggle" ${visible ? 'checked' : ''}> 表示する</label>
        <button class="btn-move-up" title="上に移動">▲</button>
        <button class="btn-move-down" title="下に移動">▼</button>
        <button class="btn-remove-tool">削除</button>
      </div>
    </div>
    <textarea class="tool-edit-note" placeholder="備考（省略可）">${escapeHtml(note)}</textarea>
  `;

  item.querySelector('.btn-remove-tool').addEventListener('click', ()=>{
    if(confirm('このツールを削除しますか？')){
      item.remove();
      updateToolMoveButtons();
    }
  });

  const displayToggle=item.querySelector('.tool-display-toggle');
  if(displayToggle){
    displayToggle.addEventListener('change', ()=>{
      if(displayToggle.checked){
        item.classList.remove('hidden-tool');
      }else{
        item.classList.add('hidden-tool');
      }
    });
  }

  item.querySelector('.btn-move-up').addEventListener('click', ()=>{
    const prev=item.previousElementSibling;
    if(prev){
      toolsEditor.insertBefore(item, prev);
      updateToolMoveButtons();
    }
  });

  item.querySelector('.btn-move-down').addEventListener('click', ()=>{
    const next=item.nextElementSibling;
    if(next){
      toolsEditor.insertBefore(next, item);
      updateToolMoveButtons();
    }
  });

  item.addEventListener('dragstart', (e)=>{
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });

  item.addEventListener('dragend', ()=>{
    item.classList.remove('dragging');
    document.querySelectorAll('.tool-edit-item').forEach(i=> i.classList.remove('drag-over'));
  });

  item.addEventListener('dragover', (e)=>{
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    const dragging=toolsEditor.querySelector('.dragging');
    if(dragging && dragging!==item){
      const rect=item.getBoundingClientRect();
      const midpoint=rect.top + rect.height/2;
      if(e.clientY < midpoint){
        toolsEditor.insertBefore(dragging, item);
      }else{
        toolsEditor.insertBefore(dragging, item.nextSibling);
      }
    }
  });

  toolsEditor.appendChild(item);
  updateToolMoveButtons();
}

function updateToolMoveButtons(){
  const items=toolsEditor.querySelectorAll('.tool-edit-item');
  items.forEach((item, index)=>{
    const upBtn=item.querySelector('.btn-move-up');
    const downBtn=item.querySelector('.btn-move-down');
    if(upBtn) upBtn.disabled=(index===0);
    if(downBtn) downBtn.disabled=(index===items.length-1);
  });
}

/* イベント管理UI */
if(btnVacationSave){ btnVacationSave.addEventListener('click', handleVacationSave); }
if(btnVacationDelete){ btnVacationDelete.addEventListener('click', handleVacationDelete); }
if(btnVacationReload){ btnVacationReload.addEventListener('click', ()=> loadVacationsList(true)); }
if(btnVacationClear){ btnVacationClear.addEventListener('click', resetVacationForm); }
if(btnCreateNoticeFromEvent){ btnCreateNoticeFromEvent.addEventListener('click', handleCreateNoticeFromEvent); }

function refreshVacationOfficeOptions(){
  if(!vacationOfficeSelect) return;
  const prev=vacationOfficeSelect.value||'';
  vacationOfficeSelect.textContent='';

  const adminOptions=(adminOfficeSel&&adminOfficeSel.options&&adminOfficeSel.options.length)?Array.from(adminOfficeSel.options):[];
  const usableOptions=adminOptions.filter(o=>o.value);
  if(usableOptions.length){
    usableOptions.forEach(opt=>{
      const o=document.createElement('option');
      o.value=opt.value; o.textContent=opt.textContent||opt.value;
      vacationOfficeSelect.appendChild(o);
    });
  }else if(CURRENT_OFFICE_ID){
    const o=document.createElement('option');
    o.value=CURRENT_OFFICE_ID; o.textContent=CURRENT_OFFICE_NAME||CURRENT_OFFICE_ID;
    vacationOfficeSelect.appendChild(o);
  }else{
    const o=document.createElement('option');
    o.value=''; o.textContent='対象拠点を選択してください'; o.disabled=true; o.selected=true;
    vacationOfficeSelect.appendChild(o);
  }

  if(prev && vacationOfficeSelect.querySelector(`option[value="${prev}"]`)){
    vacationOfficeSelect.value=prev;
  }else if(vacationOfficeSelect.options.length){
    vacationOfficeSelect.selectedIndex=0;
  }
}

function getVacationTargetOffice(){
  const office=(vacationOfficeSelect&&vacationOfficeSelect.value)||selectedOfficeId();
  if(!office){ toast('対象拠点を選択してください',false); }
  return office;
}

function getNoticesForLookup(){
  return Array.isArray(window.CURRENT_NOTICES)?window.CURRENT_NOTICES:[];
}

function getNoticesForSelection(){
  return getNoticesForLookup().filter(n=> n && n.visible !== false && n.display !== false);
}

function refreshVacationNoticeOptions(selectedId){
  if(!vacationNoticeSelect) return;
  const notices=getNoticesForSelection();
  const prev=selectedId!==undefined?String(selectedId||''):(vacationNoticeSelect.value||'');
  vacationNoticeSelect.textContent='';
  const placeholder=document.createElement('option');
  placeholder.value='';
  placeholder.textContent='お知らせを選択';
  vacationNoticeSelect.appendChild(placeholder);

  notices.forEach((notice, idx)=>{
    const id=String(notice.id || notice.noticeId || notice.title || idx);
    const title=(notice.title||'(無題)').trim();
    const opt=document.createElement('option');
    opt.value=id;
    opt.textContent=title;
    opt.dataset.title=title;
    vacationNoticeSelect.appendChild(opt);
  });

  const match=Array.from(vacationNoticeSelect.options||[]).find(o=>o.value===prev);
  vacationNoticeSelect.value=match?prev:'';
}

function findNoticeSelectionForItem(item){
  if(!item) return null;
  const notices=getNoticesForLookup();
  const desiredId=item.noticeId || item.noticeKey || '';
  const desiredTitle=item.noticeTitle || '';
  const legacyNote=item.note || item.memo || '';
  const candidates=[
    notices.find(n=> String(n?.id||n?.noticeId||'')===String(desiredId)),
    notices.find(n=> (n?.title||'') === desiredTitle),
    notices.find(n=> (n?.title||'') === legacyNote)
  ].filter(Boolean);
  const picked=candidates[0];
  if(picked){
    return { id:String(picked.id||picked.noticeId||picked.title||notices.indexOf(picked)), title:picked.title||desiredTitle||legacyNote||'' };
  }
  if(desiredId || desiredTitle){
    return { id:String(desiredId||desiredTitle), title:desiredTitle||legacyNote||'' };
  }
  return null;
}

function getSelectedNoticeInfo(){
  if(!vacationNoticeSelect) return null;
  const val=vacationNoticeSelect.value||'';
  if(!val) return null;
  const notices=getNoticesForLookup();
  const found=notices.find(n=> String(n?.id||n?.noticeId||n?.title||'')===val);
  const title=(found?.title || vacationNoticeSelect.selectedOptions?.[0]?.textContent || '').trim();
  return { id:val, title };
}

function resetVacationForm(){
  if(vacationTitleInput) vacationTitleInput.value='';
  if(vacationStartInput) vacationStartInput.value='';
  if(vacationEndInput) vacationEndInput.value='';
  if(vacationNoticeSelect){ vacationNoticeSelect.value=''; refreshVacationNoticeOptions(); }
  cachedVacationLegacyNote='';
  if(vacationMembersBitsInput) vacationMembersBitsInput.value='';
  if(vacationIdInput) vacationIdInput.value='';
  if(vacationTypeText) vacationTypeText.value='休暇固定（一覧で切替）';
  if(vacationColorSelect) vacationColorSelect.value = 'amber';
  if(window.VacationGantt){
    window.VacationGantt.reset();
  }
}

function fillVacationForm(item){
  if(!item) return;
  if(vacationTitleInput) vacationTitleInput.value=item.title||'';
  if(vacationStartInput) vacationStartInput.value=item.startDate||item.start||item.from||'';
  if(vacationEndInput) vacationEndInput.value=item.endDate||item.end||item.to||'';
  cachedVacationLegacyNote=item.note||item.memo||'';
  const noticeSel=findNoticeSelectionForItem(item);
  refreshVacationNoticeOptions(noticeSel?.id);
  if(vacationNoticeSelect){
    vacationNoticeSelect.value=noticeSel?.id||'';
  }
  if(vacationMembersBitsInput) vacationMembersBitsInput.value=item.membersBits||item.bits||'';
  if(vacationIdInput) vacationIdInput.value=item.id||item.vacationId||'';
  if(vacationTypeText) vacationTypeText.value = getVacationTypeLabel(item.isVacation !== false);
  if(vacationColorSelect) vacationColorSelect.value = item.color || 'amber';
  if(vacationOfficeSelect && item.office){
    refreshVacationOfficeOptions();
    if(vacationOfficeSelect.querySelector(`option[value="${item.office}"]`)){
      vacationOfficeSelect.value=item.office;
    }
  }
  if(window.VacationGantt){
    window.VacationGantt.loadFromString(item.membersBits||item.bits||'');
  }
}

function getVacationTypeLabel(isVacation){ return (isVacation === false)?'予定のみ':'休暇固定'; }

let cachedVacationList=[];
let cachedVacationLegacyNote='';

function normalizeVacationList(list, officeId){
  if(!Array.isArray(list)) return [];
  const prevList=Array.isArray(cachedVacationList)?cachedVacationList:[];
  const targetOffice=officeId==null?'':String(officeId);
  const normalized=list.map((item, idx)=>{
    const idStr=String(item?.id||item?.vacationId||'');
    const itemOffice=String(item?.office||targetOffice||'');
    const prev=prevList.find(v=> String(v?.id||v?.vacationId||'') === idStr && String(v?.office||targetOffice||'') === itemOffice);
    const hasIsVacation=item && Object.prototype.hasOwnProperty.call(item,'isVacation');
    const fallbackHasFlag=prev && Object.prototype.hasOwnProperty.call(prev,'isVacation');
    const isVacation=hasIsVacation ? item.isVacation : (fallbackHasFlag ? prev.isVacation : false);
    const orderVal=Number(item?.order ?? item?.sortOrder ?? prev?.order ?? (idx+1));
    return { ...item, office:itemOffice || (item?.office||''), isVacation, order: Number.isFinite(orderVal)&&orderVal>0?orderVal:(idx+1), _originalIndex: idx };
  });
  normalized.sort((a,b)=>{
    const ao=Number(a.order||0);
    const bo=Number(b.order||0);
    if(ao!==bo) return ao-bo;
    return (a._originalIndex||0)-(b._originalIndex||0);
  });
  normalized.forEach((item, idx)=>{ if(!item.order) item.order=idx+1; delete item._originalIndex; });
  return normalized;
}

function renderVacationRows(list, officeId){
  if(!vacationListBody) return;
  const normalizedList=normalizeVacationList(list, officeId);
  cachedVacationList=normalizedList;
  vacationListBody.textContent='';
  if(!Array.isArray(normalizedList) || normalizedList.length===0){
    const tr=document.createElement('tr');
    const td=document.createElement('td');
    td.colSpan=9; td.style.textAlign='center'; td.textContent='イベントはありません';
    tr.appendChild(td); vacationListBody.appendChild(tr); return;
  }

  normalizedList.forEach((item, idx)=>{
    const tr=document.createElement('tr');
    const idStr=String(item.id||item.vacationId||'');
    tr.dataset.vacationId=idStr;
    tr.dataset.order=String(item.order||idx+1);
    const dragTd=document.createElement('td');
    dragTd.className='vacation-drag-cell';
    const dragBtn=document.createElement('button');
    dragBtn.type='button';
    dragBtn.className='vacation-drag-handle';
    dragBtn.draggable=true;
    dragBtn.title='ドラッグして並び替え';
    dragBtn.innerHTML='<span aria-hidden="true">☰</span>';
    dragTd.appendChild(dragBtn);
    const titleTd=document.createElement('td'); titleTd.textContent=item.title||'';
    const start=item.startDate||item.start||item.from||'';
    const end=item.endDate||item.end||item.to||'';
    const periodTd=document.createElement('td'); periodTd.textContent=start||end?`${start||''}〜${end||''}`:'-';
    const officeTd=document.createElement('td'); officeTd.textContent=item.office||'';
    const typeTd=document.createElement('td');
    const typeToggle=document.createElement('input');
    typeToggle.type='checkbox';
    typeToggle.checked=item.isVacation === true;
    const typeLabel=document.createElement('span');
    typeLabel.className='vacation-type-label';
    typeLabel.textContent=getVacationTypeLabel(typeToggle.checked);
    typeToggle.addEventListener('change', async ()=>{
      typeToggle.disabled=true;
      const success=await updateVacationFlags(item,{ isVacation:typeToggle.checked });
      if(!success){
        typeToggle.checked=!typeToggle.checked;
      }else{
        typeLabel.textContent=getVacationTypeLabel(typeToggle.checked);
      }
      typeToggle.disabled=false;
    });
    typeTd.append(typeToggle, typeLabel);
    const colorTd=document.createElement('td');
    const colorBadge=document.createElement('span');
    colorBadge.className=`event-color-dot ${getEventColorClass(item.color)}`.trim();
    colorBadge.title=EVENT_COLOR_LABELS[item.color]||'';
    colorTd.appendChild(colorBadge);
    const noteTd=document.createElement('td');
    const noticeSel=findNoticeSelectionForItem(item);
    if(noticeSel && noticeSel.title){
      const link=document.createElement('a');
      link.href='#noticesArea';
      link.textContent=noticeSel.title;
      link.addEventListener('click',(e)=>{
        e.preventDefault();
        if(typeof toggleNoticesArea==='function'){ toggleNoticesArea(); }
        const noticesArea=document.getElementById('noticesArea');
        if(noticesArea){
          noticesArea.style.display='block';
          noticesArea.classList.remove('collapsed');
          noticesArea.scrollIntoView({ behavior:'smooth', block:'start' });
        }
      });
      noteTd.appendChild(link);
    }else if(item.note||item.memo){
      noteTd.textContent=item.note||item.memo||'';
    }else{
      noteTd.textContent='-';
    }
    const visibleTd=document.createElement('td');
    const visibleToggle=document.createElement('input');
    visibleToggle.type='checkbox';
    visibleToggle.checked=item.visible === true;
    visibleToggle.addEventListener('change', async ()=>{
      visibleToggle.disabled=true;
      const success=await updateVacationFlags(item,{ visible: visibleToggle.checked });
      if(!success){
        visibleToggle.checked=!visibleToggle.checked;
      }
      visibleToggle.disabled=false;
    });
    visibleTd.appendChild(visibleToggle);
    const actionTd=document.createElement('td');
    const editBtn=document.createElement('button'); editBtn.textContent='編集'; editBtn.className='btn-secondary';
    editBtn.addEventListener('click', ()=> fillVacationForm(item));
    actionTd.appendChild(editBtn);
    tr.append(dragTd, titleTd, periodTd, officeTd, typeTd, colorTd, noteTd, visibleTd, actionTd);
    vacationListBody.appendChild(tr);
  });
  initVacationSort();
}

function getVacationOrderMapFromDom(){
  const map=new Map();
  if(!vacationListBody) return map;
  let idx=1;
  vacationListBody.querySelectorAll('tr[data-vacation-id]').forEach(tr=>{
    const idStr=tr.dataset.vacationId||'';
    if(!idStr) return;
    map.set(idStr, idx++);
  });
  return map;
}

function hasVacationOrderChanged(orderMap){
  if(!orderMap || orderMap.size===0) return false;
  const list=Array.isArray(cachedVacationList)?cachedVacationList:[];
  return list.some((item, idx)=>{
    const idStr=String(item.id||item.vacationId||'');
    if(!idStr) return false;
    const current=orderMap.get(idStr);
    const fallbackOrder=Number(item.order||0) || (idx+1);
    return current != null && current !== fallbackOrder;
  });
}

function composeVacationPayloadFromItem(item, overrides={}){
  const office=item.office||getVacationTargetOffice();
  if(!office) return null;
  const orderMap=getVacationOrderMapFromDom();
  const idStr=String(item.id||item.vacationId||'');
  const payload={
    office,
    title:item.title||'',
    start:item.startDate||item.start||item.from||'',
    end:item.endDate||item.end||item.to||'',
    note:item.note||item.memo||item.noticeTitle||'',
    noticeId:item.noticeId||item.noticeKey||'',
    noticeTitle:item.noticeTitle||'',
    membersBits:item.membersBits||item.bits||'',
    visible: overrides.visible!==undefined ? overrides.visible : (item.visible === true),
    isVacation: overrides.isVacation!==undefined ? overrides.isVacation : (item.isVacation !== false),
    color: overrides.color || item.color || 'amber'
  };
  if(idStr) payload.id=idStr;
  const newOrder=(overrides.order!==undefined)?overrides.order:orderMap.get(idStr);
  if(newOrder!=null){
    payload.order=newOrder;
  }else{
    const maxOrder=Math.max(0,...Array.from(orderMap.values()));
    payload.order=maxOrder+1;
  }
  return payload;
}

async function persistVacationOrders(orderMap){
  const office=getVacationTargetOffice();
  if(!office || !orderMap || orderMap.size===0) return;
  if(!hasVacationOrderChanged(orderMap)) return;
  const list=Array.isArray(cachedVacationList)?cachedVacationList:[];
  const payloads=list.map(item=>{
    const idStr=String(item.id||item.vacationId||'');
    if(!idStr) return null;
    const orderVal=orderMap.get(idStr);
    if(orderVal==null) return null;
    return composeVacationPayloadFromItem(item,{ order: orderVal });
  }).filter(Boolean);
  if(!payloads.length) return;
  try{
    await Promise.all(payloads.map(p=>adminSetVacation(office,p)));
    toast('並び順を保存しました');
    await loadVacationsList(false, office);
    await loadEvents(office, false);
  }catch(err){
    console.error('persistVacationOrders error',err);
    toast('並び順の保存に失敗しました',false);
  }
}

let vacationSortInitialized=false;
let vacationDragRow=null;
function initVacationSort(){
  if(!vacationListBody) return;
  if(vacationSortInitialized) return;
  vacationSortInitialized=true;
  vacationListBody.addEventListener('dragstart', e=>{
    const handle=e.target.closest('.vacation-drag-handle');
    if(!handle){ e.preventDefault(); return; }
    const row=handle.closest('tr');
    if(!row) return;
    vacationDragRow=row;
    row.classList.add('vacation-dragging');
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain', row.dataset.vacationId||'');
  });
  vacationListBody.addEventListener('dragover', e=>{
    if(!vacationDragRow) return;
    e.preventDefault();
    const targetRow=e.target.closest('tr[data-vacation-id]');
    if(!targetRow || targetRow===vacationDragRow) return;
    const rect=targetRow.getBoundingClientRect();
    const offset=e.clientY - rect.top;
    const shouldInsertBefore=offset < rect.height / 2;
    vacationListBody.insertBefore(vacationDragRow, shouldInsertBefore ? targetRow : targetRow.nextSibling);
  });
  vacationListBody.addEventListener('dragend', ()=>{
    if(!vacationDragRow) return;
    vacationDragRow.classList.remove('vacation-dragging');
    vacationDragRow=null;
    const orderMap=getVacationOrderMapFromDom();
    persistVacationOrders(orderMap);
  });
}

async function updateVacationFlags(item, overrides={}){
  const office=item.office||getVacationTargetOffice(); if(!office) return false;
  const visible=(overrides.visible!==undefined)?overrides.visible:(item.visible === true);
  const isVacation=(overrides.isVacation!==undefined)?overrides.isVacation:(item.isVacation === true);
  const payload=composeVacationPayloadFromItem(item,{ visible, isVacation });
  if(!payload) return false;
  try{
    const res=await adminSetVacation(office,payload);
    if(res && res.ok!==false){
      if(res.vacation){
        item.visible = res.vacation.visible === true;
        item.isVacation = res.vacation.isVacation === true;
        item.color = res.vacation.color || item.color;
      }else{
        item.visible = visible;
        item.isVacation = isVacation;
      }
      toast('イベント設定を更新しました');
      if(Array.isArray(res.vacations)){
        renderVacationRows(res.vacations, office);
      }else{
        await loadVacationsList(false, office);
      }
      if(office){ await loadEvents(office, false); }
      return true;
    }
    throw new Error(res&&res.error?String(res.error):'update_failed');
  }catch(err){
    console.error('updateVacationFlags error',err);
    toast('イベント設定の更新に失敗しました',false);
    return false;
  }
}

async function loadVacationsList(showToastOnSuccess=false, officeOverride){
  const office=officeOverride||getVacationTargetOffice(); if(!office) return;
  if(vacationListBody){
    vacationListBody.textContent='';
    const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=9; td.style.textAlign='center'; td.textContent='読み込み中...'; tr.appendChild(td); vacationListBody.appendChild(tr);
  }
  try{
    const res=await adminGetVacation(office);
    const list=Array.isArray(res?.vacations)?res.vacations:(Array.isArray(res?.items)?res.items:[]);
    renderVacationRows(list, office);
    if(showToastOnSuccess) toast('イベントを読み込みました');
  }catch(err){
    console.error('loadVacationsList error',err);
    if(vacationListBody){
      vacationListBody.textContent='';
      const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=9; td.style.textAlign='center'; td.textContent='読み込みに失敗しました'; tr.appendChild(td); vacationListBody.appendChild(tr);
    }
    toast('イベントの取得に失敗しました',false);
  }finally{
    resetVacationForm();
  }
}

function buildVacationPayload(){
  const office=getVacationTargetOffice(); if(!office) return { error:'office_missing' };
  const title=(vacationTitleInput?.value||'').trim();
  const start=(vacationStartInput?.value||'').trim();
  const end=(vacationEndInput?.value||'').trim();
  if(window.VacationGantt){
    window.VacationGantt.syncInput();
  }
  const membersBits=(vacationMembersBitsInput?.value||'').trim();
  const id=(vacationIdInput?.value||'').trim();
  const color=(vacationColorSelect?.value||'amber');

  const payload={ office, title, start, end, membersBits, color };

  const orderMap=getVacationOrderMapFromDom();
  if(id && orderMap.has(id)){
    payload.order=orderMap.get(id);
  }else if(orderMap.size>0){
    const maxOrder=Math.max(0,...Array.from(orderMap.values()));
    payload.order=maxOrder+1;
  }else{
    payload.order=1;
  }

  const noticeSel=getSelectedNoticeInfo();
  if(noticeSel){
    payload.noticeId=noticeSel.id;
    payload.noticeTitle=noticeSel.title;
    if(noticeSel.title) payload.note=noticeSel.title;
  }else if(cachedVacationLegacyNote){
    payload.note=cachedVacationLegacyNote;
  }
  if(id) payload.id=id;

  const errors=[];
  if(!title) errors.push('missing_title');
  if(start && end && start>end) errors.push('invalid_range');

  return { payload, errors };
}

async function persistVacationPayload(payload,{ resetFormOnSuccess=true, showToast=true }={}){
  if(!payload || !payload.office) return false;
  try{
    const res=await adminSetVacation(payload.office,payload);
    if(res && res.ok!==false){
      if(res.id && vacationIdInput){ vacationIdInput.value=res.id; }
      if(res.vacation){
        if(vacationTypeText) vacationTypeText.value = getVacationTypeLabel(res.vacation.isVacation !== false);
        if(vacationColorSelect && res.vacation.color){ vacationColorSelect.value = res.vacation.color; }
      }
      if(showToast) toast('イベントを保存しました');
      if(Array.isArray(res.vacations)){
        renderVacationRows(res.vacations, payload.office);
      }else{
        await loadVacationsList(false, payload.office);
      }
      await loadEvents(payload.office, false);
      if(resetFormOnSuccess){
        resetVacationForm();
      }
      return true;
    }
    throw new Error(res&&res.error?String(res.error):'save_failed');
  }catch(err){
    console.error('handleVacationSave error',err);
    if(showToast) toast('イベントの保存に失敗しました',false);
    return false;
  }
}

async function handleCreateNoticeFromEvent(){
  const office=getVacationTargetOffice(); if(!office) return;
  const titleInput=prompt('イベントと紐付けるお知らせのタイトルを入力してください（必須）','');
  if(titleInput===null) return;
  const title=(titleInput||'').trim();
  if(!title){ toast('タイトルを入力してください', false); return; }
  const contentInput=prompt('お知らせの本文（任意）','');
  const newNotice={
    id:`notice_${Date.now()}`,
    title,
    content:(contentInput||'').trim(),
    visible:true,
    display:true
  };
  const currentList=Array.isArray(window.CURRENT_NOTICES)? window.CURRENT_NOTICES.slice():[];
  const nextNotices=[newNotice, ...currentList];
  const success=await saveNotices(nextNotices, office);
  if(success){
    refreshVacationNoticeOptions(newNotice.id);
    if(vacationNoticeSelect){ vacationNoticeSelect.value=newNotice.id; }
    toast('お知らせを追加しました');
  }else{
    toast('お知らせの追加に失敗しました', false);
  }
}

async function handleVacationSave(){
  const { payload, errors } = buildVacationPayload();
  if(!payload || errors?.includes('missing_title')){ toast('タイトルを入力してください',false); return; }
  if(errors?.includes('invalid_range')){ toast('開始日と終了日の指定を確認してください',false); return; }
  await persistVacationPayload(payload,{ resetFormOnSuccess:true, showToast:true });
}

async function handleVacationAutoSave(){
  const { payload, errors } = buildVacationPayload();
  if(!payload || (errors && errors.length)){ return false; }
  return await persistVacationPayload(payload,{ resetFormOnSuccess:false, showToast:false });
}

async function handleVacationDelete(){
  const office=getVacationTargetOffice(); if(!office) return;
  const id=(vacationIdInput?.value||'').trim();
  if(!id){ toast('削除する項目のIDを選択してください',false); return; }
  if(!confirm('選択中のイベントを削除しますか？')) return;
  try{
    const res=await adminDeleteVacation(office,id);
    if(res && res.ok!==false){
      toast('削除しました');
      resetVacationForm();
      await loadVacationsList();
    }else{
      throw new Error(res&&res.error?String(res.error):'delete_failed');
    }
  }catch(err){
    console.error('handleVacationDelete error',err);
    toast('イベントの削除に失敗しました',false);
  }
}

/* Admin API */
function selectedOfficeId(){
  const office=adminSelectedOfficeId||CURRENT_OFFICE_ID||'';
  if(!office){ toast('操作対象拠点を選択してください',false); }
  return office;
}
async function adminGetFor(office){ return await apiPost({ action:'getFor', token:SESSION_TOKEN, office, nocache:'1' }); }
async function adminGetConfigFor(office){ return await apiPost({ action:'getConfigFor', token:SESSION_TOKEN, office, nocache:'1' }); }
async function adminSetConfigFor(office,cfgObj){ const q={ action:'setConfigFor', token:SESSION_TOKEN, office, data:JSON.stringify(cfgObj) }; return await apiPost(q); }
async function adminSetForChunked(office,dataObjFull){
  const entries=Object.entries(dataObjFull||{});
  if(entries.length===0){
    const base={ action:'setFor', office, token:SESSION_TOKEN, data:JSON.stringify({updated:Date.now(),data:{},full:true}) };
    return await apiPost(base);
  }
  const chunkSize=100; let first=true, ok=true;
  for(let i=0;i<entries.length;i+=chunkSize){
    const chunk=Object.fromEntries(entries.slice(i,i+chunkSize));
    const obj={updated:Date.now(),data:chunk,full:first};
    const q={ action:'setFor', office, token:SESSION_TOKEN, data:JSON.stringify(obj) };
    const r=await apiPost(q);
    if(!(r&&r.ok)) ok=false; first=false;
  }
  return ok?{ok:true}:{error:'chunk_failed'};
}
async function adminRenameOffice(office,name){ return await apiPost({ action:'renameOffice', office, name, token:SESSION_TOKEN }); }
async function adminSetOfficePassword(office,pw,apw){ const q={ action:'setOfficePassword', id:office, token:SESSION_TOKEN }; if(pw) q.password=pw; if(apw) q.adminPassword=apw; return await apiPost(q); }
async function adminGetVacation(office){ return await apiPost({ action:'getVacation', token:SESSION_TOKEN, office, nocache:'1' }); }
async function adminSetVacation(office,payload){ const q={ action:'setVacation', token:SESSION_TOKEN, office, data:JSON.stringify(payload) }; return await apiPost(q); }
async function saveVacationBits(office,payload){ const q={ action:'setVacationBits', token:SESSION_TOKEN, office, data:JSON.stringify(payload) }; return await apiPost(q); }
async function adminDeleteVacation(office,id){ return await apiPost({ action:'deleteVacation', token:SESSION_TOKEN, office, id }); }

/* CSVパーサ */
function parseCSV(text){
  const out=[]; let i=0,row=[],field='',inq=false;
  function pushField(){ row.push(field); field=''; }
  function pushRow(){ out.push(row); row=[]; }
  while(i<text.length){
    const c=text[i++];
    if(inq){
      if(c=='"'&&text[i]=='"'){ field+='"'; i++; }
      else if(c=='"'){ inq=false; }
      else field+=c;
    } else {
      if(c===','){ pushField(); }
      else if(c=='"'){ inq=true; }
      else if(c=='\n'){ pushField(); pushRow(); }
      else if(c=='\r'){ }
      else field+=c;
    }
  }
  if(field!=='') pushField();
  if(row.length) pushRow();
  return out;
}

/* CSV（共通） */
function csvProtectFormula(s){ if(s==null) return ''; const v=String(s); return (/^[=\+\-@\t]/.test(v))?"'"+v:v; }
function toCsvRow(arr){ return arr.map(v=>{ const s=csvProtectFormula(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(','); }
function makeNormalizedCSV(cfg,data){
  const rows=[];
  rows.push(toCsvRow(['在席管理CSV']));
  rows.push(toCsvRow(['グループ番号','グループ名','表示順','id','氏名','内線','携帯番号','Email','業務時間','ステータス','戻り時間','備考']));
  (cfg.groups||[]).forEach((g,gi)=>{
    (g.members||[]).forEach((m,mi)=>{
      const id=m.id||''; const rec=(data&&data[id])||{};
      const workHours = rec.workHours || m.workHours || '';
      rows.push(toCsvRow([gi+1,g.title||'',mi+1,id,m.name||'',m.ext||'',m.mobile||rec.mobile||'',m.email||rec.email||'',workHours,rec.status||(STATUSES[0]?.value||'在席'),rec.time||'',rec.note||'']));
    });
  });
  return rows.join('\n');
}

/* 管理モーダルを開いたときにお知らせを自動読み込み */
async function autoLoadNoticesOnAdminOpen(){
  const office = adminSelectedOfficeId || CURRENT_OFFICE_ID;
  if(!office) return;
  try{
    const params = { action:'getNotices', token:SESSION_TOKEN, nocache:'1', office };
    const res = await apiPost(params);
    if(res && res.notices){
      noticesEditor.innerHTML = '';
      if(res.notices.length === 0){
        addNoticeEditorItem();
      } else {
        res.notices.forEach((n, idx)=> {
          const visible = (n && n.visible !== false) ? true : (n && n.display !== false);
          const id = n && (n.id != null ? n.id : (n.noticeId != null ? n.noticeId : idx));
          addNoticeEditorItem(n.title, n.content, visible !== false, id);
        });
      }
    }
  }catch(e){
    console.error('Auto-load notices error:', e);
  }
}

/* イベントエクスポート機能 */
const btnExportEvent = document.getElementById('btnExportEvent');
if(btnExportEvent){
  btnExportEvent.addEventListener('click', async ()=>{
    const office = adminSelectedOfficeId || CURRENT_OFFICE_ID;
    if(!office){ toast('拠点が選択されていません', false); return; }
    
    try{
      // 設定とイベント一覧を取得
      const cfg = await adminGetConfigFor(office);
      const eventsRes = await apiPost({ action:'getVacation', token:SESSION_TOKEN, office, nocache:'1' });
      
      if(!cfg || !cfg.groups){ toast('設定の取得に失敗しました', false); return; }
      if(!eventsRes || !eventsRes.vacations){ toast('イベントの取得に失敗しました', false); return; }
      
      const events = eventsRes.vacations;
      if(!events.length){ toast('エクスポートするイベントがありません'); return; }
      
      // CSVヘッダー
      const rows = [];
      rows.push(toCsvRow(['イベントID', 'タイトル', '開始日', '終了日', 'グループ', '氏名', 'ビット状態']));
      
      // 各イベントについて処理
      events.forEach(event => {
        const eventId = event.id || event.vacationId || '';
        const title = event.title || '';
        const startDate = event.startDate || event.start || event.from || '';
        const endDate = event.endDate || event.end || event.to || '';
        const membersBits = event.membersBits || event.bits || '';
        
        // メンバーリストを構築
        const members = [];
        (cfg.groups || []).forEach(g => {
          (g.members || []).forEach(m => {
            members.push({ group: g.title || '', name: m.name || '' });
          });
        });
        
        // ビット文字列を解析
        const bitChars = membersBits.split('');
        members.forEach((member, idx) => {
          const bitValue = bitChars[idx] === '1' ? '○' : '';
          rows.push(toCsvRow([eventId, title, startDate, endDate, member.group, member.name, bitValue]));
        });
      });
      
      const csv = rows.join('\\n');
      const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
      const bytes = new TextEncoder().encode(csv);
      const blob = new Blob([BOM, bytes], { type:'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
      a.href = url;
      a.download = `events_${office}_${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
      toast('イベントをエクスポートしました');
    }catch(e){
      console.error('Event export error:', e);
      toast('エクスポートに失敗しました', false);
    }
  });
}
