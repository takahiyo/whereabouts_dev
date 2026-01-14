function buildStatusFilterOptions(){
  statusFilter.replaceChildren();
  const optAll = document.createElement('option'); optAll.value=''; optAll.textContent='（全てのステータス）';
  statusFilter.appendChild(optAll);
  (MENUS?.statuses||[]).forEach(s=>{
    const o=document.createElement('option');
    o.value=String(s.value); o.textContent=String(s.value);
    statusFilter.appendChild(o);
  });
}
function applyFilters(){
  const q=(nameFilter.value||'').trim().toLowerCase();
  const st=statusFilter.value||'';
  board.querySelectorAll('section.panel').forEach(sec=>{
    let anyRow=false;
    sec.querySelectorAll('tbody tr').forEach(tr=>{
      const nameCell=tr.querySelector('td.name');
      const nameText=(nameCell?.textContent||'').toLowerCase();
      const rowSt = tr.querySelector('select[name="status"]')?.value || '';
      const showByName = !q || nameText.includes(q);
      const showByStatus = !st || rowSt === st;
      const show = showByName && showByStatus;
      tr.style.display = show ? '' : 'none';
      if(show) anyRow=true;
    });
    // F6相当：該当行が無いパネルは隠す
    sec.style.display = anyRow ? '' : 'none';
  });
}
nameFilter.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);

function updateStatusFilterCounts(){
  // 現在の人数（全件）を集計
  const totalRows = board.querySelectorAll('tbody tr').length;
  const counts = new Map();
  STATUSES.forEach(s=>counts.set(s.value,0));
  board.querySelectorAll('tbody tr').forEach(tr=>{
    const st = tr.dataset.status || tr.querySelector('select[name="status"]')?.value || "";
    if(!counts.has(st)) counts.set(st,0);
    counts.set(st, counts.get(st)+1);
  });
  const cur = statusFilter.value;
  statusFilter.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = `全て（${totalRows}）`;
  statusFilter.appendChild(optAll);
  STATUSES.forEach(s=>{
    const o=document.createElement('option');
    o.value=s.value; o.textContent=`${s.value}（${counts.get(s.value)||0}）`;
    statusFilter.appendChild(o);
  });
  statusFilter.value = (cur==='' || STATUSES.some(x=>x.value===cur)) ? cur : '';
}
