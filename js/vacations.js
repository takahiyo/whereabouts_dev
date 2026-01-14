(function(){
  const HOLIDAY_API_URL = window.HOLIDAY_API_URL || 'https://holidays-jp.github.io/api/v1/date.json';
  const MANUAL_HOLIDAYS = Array.isArray(window.MANUAL_HOLIDAYS) ? window.MANUAL_HOLIDAYS : [];
  const holidayCache = new Map(); // year -> Set<string>
  const COLOR_PALETTE = [
    { key: 'none', className: 'vac-color-none' },
    { key: 'saturday', className: 'vac-color-sat' },
    { key: 'sunday', className: 'vac-color-sun' },
    { key: 'holiday', className: 'vac-color-holiday' },
    { key: 'amber', className: 'vac-color-amber' },
    { key: 'mint', className: 'vac-color-mint' },
    { key: 'lavender', className: 'vac-color-lavender' },
    { key: 'slate', className: 'vac-color-slate' }
  ];
  const PALETTE_EVENT_COLOR_MAP = {
    none: '',
    saturday: 'blue',
    sunday: 'sunday',
    holiday: 'holiday',
    amber: 'amber',
    mint: 'green',
    lavender: 'purple',
    slate: 'slate'
  };
  const EVENT_COLOR_TO_PALETTE_MAP = {
    amber: 'amber',
    none: 'none',
    blue: 'saturday',
    green: 'mint',
    purple: 'lavender',
    sunday: 'sunday',
    saturday: 'saturday',
    holiday: 'holiday',
    teal: 'mint',
    pink: 'sunday',
    gray: 'slate',
    slate: 'slate'
  };

  const FALLBACK_DAYS = 7;

  function normalizeDateStr(str){
    if(!str) return '';
    const d = new Date(str);
    if(Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = `${d.getMonth()+1}`.padStart(2,'0');
    const day = `${d.getDate()}`.padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function createVacationGanttController(config){
    const opts = config || {};
    const startInput = opts.startInput || null;
    const endInput = opts.endInput || null;
    const bitsInput = opts.bitsInput || null;
    let ganttRoot = opts.rootEl || null;
    const jumpContainer = opts.groupJumpContainer || null;
    const groupJumpMode = opts.groupJumpMode || 'buttons';
    const scrollContainer = opts.scrollContainer || null;
    let tableEl = null;
    let orderedMembers = [];
    let dateSlots = [];
    let bitsByDate = new Map(); // date -> Array<boolean>
    let draggingState = null;
    let autoSaveTimer = null;
    let saveInFlight = false;
    let queuedSave = false;
    let latestRequestedState = null;
    let lastSavedState = null;
    const dateColorMap = new Map(); // date -> palette index
    let latestHolidaySet = new Set();
    const paletteClassNames = COLOR_PALETTE.map(c => c.className);
    const holidayPaletteIndex = COLOR_PALETTE.findIndex(c => c.key === 'holiday');

    function getDefaultColorIndex(date){
      const d = new Date(date);
      const dow = d.getDay();
      if(dow === 0){
        const sundayIdx = COLOR_PALETTE.findIndex(c => c.key === 'sunday');
        return sundayIdx >= 0 ? sundayIdx : 0;
      }
      if(dow === 6){
        const saturdayIdx = COLOR_PALETTE.findIndex(c => c.key === 'saturday');
        return saturdayIdx >= 0 ? saturdayIdx : 0;
      }
      return 0;
    }

    function ensureDateColor(date){
      const normalized = normalizeDateStr(date);
      if(!normalized) return 0;
      if(!dateColorMap.has(normalized)){
        dateColorMap.set(normalized, getDefaultColorIndex(normalized));
      }
      return dateColorMap.get(normalized) ?? 0;
    }

    function syncDateColorMapWithSlots(){
      const available = new Set(dateSlots);
      Array.from(dateColorMap.keys()).forEach(date => {
        if(!available.has(date)){
          dateColorMap.delete(date);
        }
      });
      dateSlots.forEach(date => ensureDateColor(date));
    }

    function applyColumnColor(date){
      if(!tableEl) return;
      const idx = ensureDateColor(date) % COLOR_PALETTE.length;
      const className = COLOR_PALETTE[idx]?.className || '';
      const shouldShowHoliday = latestHolidaySet.has(date) && idx === holidayPaletteIndex;
      tableEl.querySelectorAll(`[data-date="${date}"]`).forEach(el => {
        paletteClassNames.forEach(cls => el.classList.remove(cls));
        if(className){
          el.classList.add(className);
        }
        el.dataset.colorIndex = String(idx);
        el.classList.toggle('holiday', shouldShowHoliday);
      });
    }

    function applyAllColumnColors(){
      dateSlots.forEach(date => applyColumnColor(date));
    }

    let palettePopupEl = null;
    let paletteCurrentDate = '';
    let paletteCleanupFns = [];

    function closePalettePopup(){
      if(palettePopupEl && palettePopupEl.parentNode){
        palettePopupEl.parentNode.removeChild(palettePopupEl);
      }
      palettePopupEl = null;
      paletteCurrentDate = '';
      paletteCleanupFns.forEach(fn => {
        try{ fn(); }catch(err){ console.error(err); }
      });
      paletteCleanupFns = [];
    }

    function positionPalettePopup(anchorEl){
      if(!palettePopupEl || !anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const popupRect = palettePopupEl.getBoundingClientRect();
      const top = rect.bottom + window.scrollY + 6;
      let left = rect.left + window.scrollX + (rect.width / 2) - (popupRect.width / 2);
      const minLeft = 8;
      const maxLeft = Math.max(minLeft, window.scrollX + document.documentElement.clientWidth - popupRect.width - 8);
      left = Math.min(Math.max(left, minLeft), maxLeft);
      palettePopupEl.style.top = `${top}px`;
      palettePopupEl.style.left = `${left}px`;
    }

    function paletteKeyFromIndex(idx){
      const normalizedIdx = Math.max(0, idx % COLOR_PALETTE.length);
      return COLOR_PALETTE[normalizedIdx]?.key || '';
    }

    function paletteIndexFromKey(key){
      const normalized = (key || '').toString().trim().toLowerCase();
      return COLOR_PALETTE.findIndex(c => c.key === normalized);
    }

    function toEventColorKeyFromPalette(key){
      const normalized = (key || '').toString().trim().toLowerCase();
      return PALETTE_EVENT_COLOR_MAP[normalized] ?? '';
    }

    function paletteKeyFromEventColor(key){
      const normalized = (key || '').toString().trim().toLowerCase();
      if(EVENT_COLOR_TO_PALETTE_MAP[normalized]) return EVENT_COLOR_TO_PALETTE_MAP[normalized];
      const paletteIdx = paletteIndexFromKey(normalized);
      return paletteIdx >= 0 ? paletteKeyFromIndex(paletteIdx) : '';
    }

    function handlePaletteColorSelect(date, idx){
      if(!date) return null;
      const normalizedDate = normalizeDateStr(date) || date;
      const paletteKey = paletteKeyFromIndex(idx);
      const normalizedIdx = Math.max(0, idx % COLOR_PALETTE.length);
      dateColorMap.set(normalizedDate, normalizedIdx);
      applyColumnColor(normalizedDate);
      const result = {
        date: normalizedDate,
        paletteIndex: normalizedIdx,
        paletteKey,
        eventColor: toEventColorKeyFromPalette(paletteKey)
      };
      if(typeof opts.onDateColorSelect === 'function'){
        try{
          opts.onDateColorSelect({ ...result });
        }catch(err){
          console.error('onDateColorSelect error', err);
        }
      }
      closePalettePopup();
      return result;
    }

    function createPalettePopup(anchorEl, date){
      closePalettePopup();
      paletteCurrentDate = date;
      const popup = document.createElement('div');
      popup.className = 'vac-color-palette';

      const title = document.createElement('div');
      title.className = 'vac-color-palette__title';
      title.textContent = '列カラーを選択';
      popup.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'vac-color-palette__grid';
      COLOR_PALETTE.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `vac-color-option ${item.className}`;
        btn.dataset.colorKey = item.key;
        btn.setAttribute('aria-label', `${item.key} を選択`);
        const mark = document.createElement('span');
        mark.className = 'vac-color-option__dot';
        btn.appendChild(mark);
        const label = document.createElement('span');
        label.className = 'vac-color-option__label';
        label.textContent = item.key;
        btn.appendChild(label);
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          handlePaletteColorSelect(date, idx);
        });
        grid.appendChild(btn);
      });
      popup.appendChild(grid);

      document.body.appendChild(popup);
      palettePopupEl = popup;

      requestAnimationFrame(() => positionPalettePopup(anchorEl));

      const handleOutside = (ev) => {
        if(!palettePopupEl) return;
        const target = ev.target;
        if(palettePopupEl.contains(target) || anchorEl.contains(target)) return;
        closePalettePopup();
      };

      const closeOnScroll = () => closePalettePopup();

      ['mousedown','touchstart','pointerdown'].forEach(ev => {
        document.addEventListener(ev, handleOutside, true);
        paletteCleanupFns.push(() => document.removeEventListener(ev, handleOutside, true));
      });
      window.addEventListener('scroll', closeOnScroll, true);
      paletteCleanupFns.push(() => window.removeEventListener('scroll', closeOnScroll, true));
      window.addEventListener('resize', closeOnScroll, true);
      paletteCleanupFns.push(() => window.removeEventListener('resize', closeOnScroll, true));
    }

    function applyExternalDateColors(colorMap){
      if(!colorMap){
        syncDateColorMapWithSlots();
        applyAllColumnColors();
        return;
      }
      const entries = colorMap instanceof Map ? Array.from(colorMap.entries()) : Object.entries(colorMap);
      const previous = new Map(dateColorMap);
      dateColorMap.clear();
      syncDateColorMapWithSlots();
      let changed = true;
      entries.forEach(([rawDate, colorValue]) => {
        const date = normalizeDateStr(rawDate);
        if(!date) return;
        const paletteKey = paletteKeyFromEventColor(colorValue);
        if(!paletteKey){
          if(previous.has(date)){
            dateColorMap.set(date, previous.get(date));
            changed = true;
          }
          return;
        }
        const idx = paletteIndexFromKey(paletteKey);
        if(idx < 0){
          if(previous.has(date)){
            dateColorMap.set(date, previous.get(date));
            changed = true;
          }
          return;
        }
        dateColorMap.set(date, idx % COLOR_PALETTE.length);
        changed = true;
      });
      if(changed){
        applyAllColumnColors();
      }
    }

    function handleColorCycle(e){
      const isAdmin = typeof isOfficeAdmin === 'function' ? isOfficeAdmin() : false;
      if(!isAdmin) return;
      const target = e.target.closest('.vac-day-header');
      if(!target) return;
      const date = target.dataset.date;
      if(!date) return;
      e.preventDefault();
      e.stopPropagation();
      if(palettePopupEl && paletteCurrentDate === date){
        closePalettePopup();
        return;
      }
      createPalettePopup(target, date);
    }
    let statusEl = null;
    let saveMode = opts.saveMode || 'vacation';
    let initialized = false;
    let groupAnchors = [];

    function captureCurrentState(){
      const stateBits = getBitsString();
      return {
        start: startInput?.value || '',
        end: endInput?.value || '',
        bits: stateBits
      };
    }

    function ensureStatusElement(){
      if(statusEl) return statusEl;
      const el = document.createElement('div');
      el.className = 'vac-save-status';
      statusEl = el;
      if(ganttRoot){
        ganttRoot.appendChild(el);
      }
      return el;
    }

    function renderStatus(type, message, actions){
      const el = ensureStatusElement();
      el.textContent = '';
      el.dataset.state = type;
      const msgSpan = document.createElement('span');
      msgSpan.className = 'vac-save-message';
      msgSpan.textContent = message;
      el.appendChild(msgSpan);
      if(type === 'saving'){
        const spinner = document.createElement('span');
        spinner.className = 'vac-save-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        el.prepend(spinner);
      }
      (actions || []).forEach(({ label, onClick, className }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = className || 'vac-save-action';
        btn.addEventListener('click', onClick);
        el.appendChild(btn);
      });
    }

    function showSavingStatus(){
      renderStatus('saving', '変更を保存しています…');
    }

    function showSavedStatus(){
      renderStatus('saved', '自動保存済み');
      setTimeout(() => {
        if(statusEl && statusEl.dataset.state === 'saved'){
          statusEl.textContent = '';
          statusEl.dataset.state = '';
        }
      }, 2000);
    }

    function rollbackToLastSaved(){
      if(!lastSavedState) return;
      setRangeAndBits(lastSavedState.start, lastSavedState.end, lastSavedState.bits);
      toast('保存前の状態に戻しました', false);
    }

    function showErrorStatus(){
      const actions = [{
        label: '再試行',
        onClick: () => scheduleAutoSave('retry'),
        className: 'vac-save-retry'
      }];
      if(lastSavedState){
        actions.push({
          label: 'ロールバック',
          onClick: rollbackToLastSaved,
          className: 'vac-save-rollback'
        });
      }
      renderStatus('error', '保存に失敗しました。再試行するかロールバックできます。', actions);
    }

    function isEventModalSaveMode(){
      return saveMode === 'event-modal' || saveMode === 'event-auto';
    }

    async function invokeSaveHandler(){
      if(isEventModalSaveMode() && typeof window.saveEventFromModal === 'function'){
        return await window.saveEventFromModal();
      }
      if(typeof window.saveLongVacationFromModal === 'function'){
        return await window.saveLongVacationFromModal();
      }
      if(typeof window.handleVacationAutoSave === 'function'){
        return await window.handleVacationAutoSave();
      }
      if(typeof window.handleVacationSave === 'function'){
        return await window.handleVacationSave();
      }
      throw new Error('save_handler_missing');
    }

    async function flushAutoSave(){
      if(saveInFlight){
        queuedSave = true;
        return;
      }
      if(!latestRequestedState) return;
      saveInFlight = true;
      queuedSave = false;
      showSavingStatus();
      try{
        await invokeSaveHandler();
        lastSavedState = captureCurrentState();
        showSavedStatus();
      }catch(err){
        console.error('自動保存に失敗しました', err);
        showErrorStatus();
      }finally{
        saveInFlight = false;
        if(queuedSave){
          queuedSave = false;
          flushAutoSave();
        }
      }
    }

    function scheduleAutoSave(reason){
      latestRequestedState = captureCurrentState();
      if(autoSaveTimer){
        clearTimeout(autoSaveTimer);
      }
      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        flushAutoSave();
      }, 800);
    }

    function getGroupTitle(group, idx){
      if(typeof fallbackGroupTitle === 'function'){
        return fallbackGroupTitle(group, idx);
      }
      const raw = (group && typeof group.title === 'string') ? group.title.trim() : '';
      return raw || `グループ${idx + 1}`;
    }

    function getDateRange(){
      const startRaw = startInput?.value || '';
      const endRaw   = endInput?.value   || '';
      const start = normalizeDateStr(startRaw) || normalizeDateStr(new Date());
      let end = normalizeDateStr(endRaw);
      if(!end){
        const base = start ? new Date(start) : new Date();
        const tmp = new Date(base);
        tmp.setDate(base.getDate() + (FALLBACK_DAYS - 1));
        end = normalizeDateStr(tmp);
      }
      const startDate = new Date(start);
      const endDate = new Date(end);
      if(endDate < startDate){
        return { start: normalizeDateStr(endDate), end: normalizeDateStr(startDate) };
      }
      return { start, end };
    }

    function buildDateSlots(){
      const { start, end } = getDateRange();
      const out = [];
      if(!start || !end) return out;
      const current = new Date(start);
      const endDate = new Date(end);
      while(current <= endDate){
        out.push(normalizeDateStr(current));
        current.setDate(current.getDate() + 1);
      }
      return out;
    }

    function getMembersOrdered(){
      if(typeof getRosterOrdering === 'function'){
        return getRosterOrdering().flatMap((g, gi) => (g.members || []).map(m => ({
          ...m,
          groupTitle: getGroupTitle(g, gi)
        })));
      }
      return [];
    }

    function ensureBits(date){
      if(!bitsByDate.has(date)){
        bitsByDate.set(date, new Array(orderedMembers.length).fill(false));
      }
      const arr = bitsByDate.get(date) || [];
      if(arr.length < orderedMembers.length){
        const diff = orderedMembers.length - arr.length;
        bitsByDate.set(date, arr.concat(new Array(diff).fill(false)));
      }
    }

    function parseBitsString(raw){
      bitsByDate.clear();
      if(!raw){
        dateSlots.forEach(d => ensureBits(d));
        return;
      }
      const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
      if(parts.length === 0){
        dateSlots.forEach(d => ensureBits(d));
        return;
      }
      const useSlots = dateSlots.length ? dateSlots : parts.map((_,i)=> i.toString());
      parts.forEach((part, idx)=>{
        let key = '';
        let bits = part;
        if(part.includes(':')){
          const [k,v] = part.split(':');
          key = normalizeDateStr(k) || useSlots[idx] || '';
          bits = v || '';
        }else{
          key = useSlots[idx] || '';
        }
        ensureBits(key);
        const arr = bitsByDate.get(key) || [];
        const chars = (bits||'').trim();
        for(let i=0;i<orderedMembers.length;i++){
          arr[i] = chars[i] === '1';
        }
        bitsByDate.set(key, arr);
      });
      dateSlots.forEach(d => ensureBits(d));
    }

    function serializeBits(){
      const rows = [];
      dateSlots.forEach(date => {
        const arr = bitsByDate.get(date) || [];
        const bits = orderedMembers.map((_,i)=> arr[i] ? '1' : '0').join('');
        rows.push(`${date}:${bits}`);
      });
      return rows.join(';');
    }

    function updateBitsInput(){
      if(!bitsInput) return;
      bitsInput.value = serializeBits();
    }

    function toggleBit(date, memberIdx, on){
      ensureBits(date);
      const arr = bitsByDate.get(date) || [];
      arr[memberIdx] = on;
      bitsByDate.set(date, arr);
      updateBitsInput();
      scheduleAutoSave('cell');
    }

    function applyBitsToCells(){
      if(!tableEl) return;
      // メンバーごとにビットが1つでもあるかをチェック
      const memberHasBit = new Map();
      bitsByDate.forEach((arr) => {
        if(!Array.isArray(arr)) return;
        arr.forEach((on, idx) => {
          if(on) memberHasBit.set(idx, true);
        });
      });
      
      tableEl.querySelectorAll('.vac-cell').forEach(cell => {
        const date = cell.dataset.date;
        const idx = Number(cell.dataset.memberIndex || '-1');
        const arr = bitsByDate.get(date);
        const on = Array.isArray(arr) ? !!arr[idx] : false;
        cell.classList.toggle('on', on);
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      
      // メンバー名のハイライト表示
      tableEl.querySelectorAll('th.member-name').forEach(th => {
        const idx = Number(th.dataset.memberIndex || '-1');
        const hasBit = memberHasBit.has(idx);
        th.classList.toggle('member-has-bit', hasBit);
      });
    }

    function createHeaderRow(){
      const thead = document.createElement('thead');
      const monthRow = document.createElement('tr');
      monthRow.className = 'vac-month-row';
      const dayRow = document.createElement('tr');
      dayRow.className = 'vac-day-row';

      const groupHeader = document.createElement('th');
      groupHeader.textContent = 'グループ';
      groupHeader.className = 'group-name';
      groupHeader.rowSpan = 2;
      monthRow.appendChild(groupHeader);
      const nameHeader = document.createElement('th');
      nameHeader.textContent = '氏名';
      nameHeader.className = 'member-name';
      nameHeader.rowSpan = 2;
      monthRow.appendChild(nameHeader);

      const monthGroups = [];
      let currentMonth = '';
      let spanStart = 0;
      dateSlots.forEach((date, idx) => {
        const d = new Date(date);
        const monthLabel = `${d.getFullYear()}年${d.getMonth()+1}月`;
        if(currentMonth === ''){
          currentMonth = monthLabel;
          spanStart = idx;
        }else if(monthLabel !== currentMonth){
          monthGroups.push({ label: currentMonth, start: spanStart, end: idx - 1 });
          currentMonth = monthLabel;
          spanStart = idx;
        }
        const dow = d.getDay();
        const dayTh = document.createElement('th');
        dayTh.dataset.date = date;
        dayTh.className = 'vac-day-header';
        if(dow === 0) dayTh.classList.add('weekend-sun');
        if(dow === 6) dayTh.classList.add('weekend-sat');

        const label = document.createElement('div');
        label.className = 'vac-day-label';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'vac-date';
        dateSpan.textContent = `${d.getDate()}日`;

        const daySpan = document.createElement('span');
        daySpan.textContent = ['日','月','火','水','木','金','土'][dow] || '';
        daySpan.className = 'vac-day';

        label.appendChild(dateSpan);
        label.appendChild(daySpan);
        dayTh.appendChild(label);
        dayRow.appendChild(dayTh);
      });

      if(currentMonth){
        monthGroups.push({ label: currentMonth, start: spanStart, end: dateSlots.length - 1 });
      }

      monthGroups.forEach(group => {
        const th = document.createElement('th');
        th.className = 'vac-month-header';
        th.colSpan = group.end - group.start + 1;
        const span = document.createElement('span');
        span.className = 'vac-month-text';
        span.textContent = group.label;
        th.appendChild(span);
        monthRow.appendChild(th);
      });

      thead.appendChild(monthRow);
      thead.appendChild(dayRow);
      return thead;
    }

    function createBodyRows(){
      const tbody = document.createElement('tbody');
      groupAnchors = [];
      let cursor = 0;
      const grouped = (typeof getRosterOrdering === 'function') ? getRosterOrdering() : [];
      grouped.forEach((group, gi) => {
        const members = group.members || [];
        if(members.length === 0) return;
        const groupTitle = getGroupTitle(group, gi);
        const anchorId = `${(ganttRoot && ganttRoot.id) ? `${ganttRoot.id}-` : ''}group-${gi}`;
        groupAnchors.push({ id: anchorId, title: groupTitle, memberCount: members.length });
        members.forEach((member, mi) => {
          const tr = document.createElement('tr');
          // グループの最後の行にクラスを追加
          if(mi === members.length - 1){
            tr.classList.add('group-last-row');
          }
          if(mi === 0){
            tr.id = anchorId;
            tr.dataset.groupIndex = String(gi);
            const gth = document.createElement('th');
            gth.textContent = groupTitle;
            gth.className = 'group-name';
            gth.rowSpan = members.length;
            tr.appendChild(gth);
          }
          const nameTh = document.createElement('th');
          nameTh.textContent = member.name || '';
          nameTh.className = 'member-name';
          nameTh.dataset.memberIndex = String(cursor);
          tr.appendChild(nameTh);
          dateSlots.forEach(date => {
            const td = document.createElement('td');
            td.className = 'vac-cell';
            td.dataset.date = date;
            td.dataset.memberIndex = String(cursor);
            const d = new Date(date);
            const dow = d.getDay();
            if(dow === 0) td.classList.add('weekend-sun');
            if(dow === 6) td.classList.add('weekend-sat');
            td.setAttribute('role', 'button');
            td.setAttribute('aria-label', `${group.title || ''} ${member.name || ''} ${date}`);
            td.setAttribute('aria-pressed', 'false');
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
          cursor += 1;
        });
      });
      return tbody;
    }

    function applyHolidayColor(holidays){
      latestHolidaySet = holidays instanceof Set ? holidays : new Set();
      if(!tableEl) return;
      if(holidayPaletteIndex >= 0){
        latestHolidaySet.forEach(date => {
          const currentIdx = ensureDateColor(date);
          const defaultIdx = getDefaultColorIndex(date);
          if(currentIdx === defaultIdx){
            dateColorMap.set(date, holidayPaletteIndex);
          }
        });
      }
      applyAllColumnColors();
    }

    async function resolveHolidays(){
      // 手動定義の祝日リストのみを使用（CSP違反回避のため外部API呼び出しを削除）
      const set = new Set(MANUAL_HOLIDAYS.map(normalizeDateStr).filter(Boolean));
      return set;
    }

    function renderTable(){
      if(!ganttRoot) return;
      ganttRoot.textContent = '';
      tableEl = document.createElement('table');
      tableEl.appendChild(createHeaderRow());
      tableEl.appendChild(createBodyRows());
      ganttRoot.appendChild(tableEl);
      if(statusEl){
        ganttRoot.appendChild(statusEl);
      }
      applyAllColumnColors();
      applyBitsToCells();
      resolveHolidays().then(set => applyHolidayColor(set));
    }

    function handlePointerDown(e){
      const cell = e.target.closest('.vac-cell');
      if(!cell) return;
      // 左クリック（button === 0）のみ受け付ける
      if(e.button !== 0) return;
      const idx = Number(cell.dataset.memberIndex || '-1');
      if(idx < 0) return;
      const date = cell.dataset.date;
      const currentOn = cell.classList.contains('on');
      const toValue = !currentOn;
      draggingState = {
        toValue,
        startX: e.clientX,
        startY: e.clientY,
        hasDragged: false,
        startCell: cell
      };
      if(tableEl){
        tableEl.classList.add('dragging');
      }
      toggleBit(date, idx, toValue);
      cell.classList.toggle('on', toValue);
    }

    function handlePointerOver(e){
      if(!draggingState) return;
      const cell = e.target.closest('.vac-cell');
      if(!cell) return;
      const idx = Number(cell.dataset.memberIndex || '-1');
      if(idx < 0) return;
      const date = cell.dataset.date;
      if(draggingState.startCell && draggingState.startCell !== cell){
        draggingState.hasDragged = true;
      }
      toggleBit(date, idx, draggingState.toValue);
      cell.classList.toggle('on', draggingState.toValue);
    }

    function handlePointerMove(e){
      if(!draggingState) return;
      const movedX = typeof draggingState.startX === 'number' ? Math.abs((e.clientX || 0) - draggingState.startX) : 0;
      const movedY = typeof draggingState.startY === 'number' ? Math.abs((e.clientY || 0) - draggingState.startY) : 0;
      if(movedX > 2 || movedY > 2){
        draggingState.hasDragged = true;
      }
      if(draggingState.hasDragged && e.cancelable){
        e.preventDefault();
      }
    }

    function handlePointerUp(){
      draggingState = null;
      if(tableEl){
        tableEl.classList.remove('dragging');
      }
    }

    function clearHoverHighlights(){
      if(!tableEl) return;
      tableEl.querySelectorAll('.hover-highlight').forEach(el => el.classList.remove('hover-highlight'));
    }

    function applyHoverHighlights(cell){
      if(!tableEl || !cell) return;
      clearHoverHighlights();
      const date = cell.dataset.date;
      if(date){
        tableEl.querySelectorAll(`[data-date="${date}"]`).forEach(el => el.classList.add('hover-highlight'));
      }
      const row = cell.closest('tr');
      if(row){
        row.querySelectorAll('th, td').forEach(el => el.classList.add('hover-highlight'));
      }
    }

    function scrollToGroup(anchorId){
      if(!anchorId || !tableEl) return;
      const target = tableEl.querySelector(`#${anchorId}`);
      if(target){
        const container = scrollContainer || ganttRoot;
        if(container && container !== document.body && typeof container.scrollTo === 'function'){
          const targetRect = target.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const offsetTop = targetRect.top - containerRect.top + container.scrollTop;
          container.scrollTo({ top: offsetTop, behavior: 'smooth' });
        }else{
          target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        }
      }
    }

    function renderGroupJumps(){
      if(!jumpContainer) return;
      if(!groupAnchors.length){
        jumpContainer.style.display = 'none';
        return;
      }
      jumpContainer.style.display = 'flex';
      const label = jumpContainer.querySelector('.jump-label') || (() => {
        const el = document.createElement('span');
        el.className = 'jump-label';
        el.textContent = 'グループジャンプ';
        jumpContainer.appendChild(el);
        return el;
      })();

      const buttonsWrap = jumpContainer.querySelector('.jump-buttons') || (() => {
        const wrap = document.createElement('div');
        wrap.className = 'jump-buttons';
        jumpContainer.appendChild(wrap);
        return wrap;
      })();

      const selectWrap = jumpContainer.querySelector('.jump-select') || (() => {
        const wrap = document.createElement('label');
        wrap.className = 'jump-select';
        const select = document.createElement('select');
        wrap.appendChild(select);
        jumpContainer.appendChild(wrap);
        return wrap;
      })();
      const selectEl = selectWrap.querySelector('select');

      const showButtons = groupJumpMode === 'buttons' || groupJumpMode === 'both';
      const showSelect = groupJumpMode === 'select' || groupJumpMode === 'both';

      label.style.display = '';

      buttonsWrap.textContent = '';
      if(showButtons){
        buttonsWrap.style.display = 'flex';
        groupAnchors.forEach(anchor => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'jump-btn';
          const memberInfo = typeof anchor.memberCount === 'number' ? `（${anchor.memberCount}名）` : '';
          btn.textContent = `${anchor.title}${memberInfo}`;
          btn.addEventListener('click', () => scrollToGroup(anchor.id));
          buttonsWrap.appendChild(btn);
        });
      }else{
        buttonsWrap.style.display = 'none';
      }

      if(showSelect){
        selectWrap.style.display = 'inline-flex';
        if(selectEl){
          selectEl.innerHTML = '';
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'グループを選択';
          selectEl.appendChild(placeholder);
          groupAnchors.forEach(anchor => {
            const opt = document.createElement('option');
            opt.value = anchor.id;
            const memberInfo = typeof anchor.memberCount === 'number' ? `（${anchor.memberCount}名）` : '';
            opt.textContent = `${anchor.title}${memberInfo}`;
            selectEl.appendChild(opt);
          });
          selectEl.onchange = (e) => {
            const targetId = e.target.value;
            if(targetId){
              scrollToGroup(targetId);
            }
          };
        }
      }else{
        selectWrap.style.display = 'none';
      }
    }

    function bindTableEvents(){
      if(!tableEl) return;
      const isAdmin = typeof isOfficeAdmin === 'function' ? isOfficeAdmin() : false;
      const thead = tableEl.querySelector('thead');
      if(thead){
        thead.removeEventListener('click', handleColorCycle);
        if(isAdmin){
          thead.addEventListener('click', handleColorCycle);
        }
      }
      tableEl.addEventListener('pointerdown', handlePointerDown);
      tableEl.addEventListener('pointerover', handlePointerOver);
      tableEl.addEventListener('pointermove', handlePointerMove, { passive:false });
      tableEl.addEventListener('touchmove', handlePointerMove, { passive:false });
      ['pointerup','pointercancel','pointerleave'].forEach(ev => tableEl.addEventListener(ev, handlePointerUp));
      const tbody = tableEl.querySelector('tbody');
      if(tbody){
        const handleHover = (e) => {
          const cell = e.target.closest('td.vac-cell');
          if(!cell) return;
          applyHoverHighlights(cell);
        };
        const handleOut = (e) => {
          const cell = e.target.closest('td.vac-cell');
          if(!cell) return;
          clearHoverHighlights();
        };
        tbody.addEventListener('mouseover', handleHover);
        tbody.addEventListener('mouseout', handleOut);
        tbody.addEventListener('focusin', handleHover);
        tbody.addEventListener('focusout', handleOut);
      }
      tableEl.addEventListener('mouseleave', clearHoverHighlights);
    }

    function rebuild(){
      if(!ganttRoot) return;
      closePalettePopup();
      orderedMembers = getMembersOrdered();
      dateSlots = buildDateSlots();
      syncDateColorMapWithSlots();
      parseBitsString(bitsInput?.value || '');
      renderTable();
      renderGroupJumps();
      bindTableEvents();
    }

    function init(){
      if(initialized) return;
      initialized = true;
      if(!ganttRoot) return;
      rebuild();
      if(opts.autoBind !== false){
        if(startInput){
          startInput.addEventListener('change', () => {
            rebuild();
            scheduleAutoSave('date-change');
          });
        }
        if(endInput){
          endInput.addEventListener('change', () => {
            rebuild();
            scheduleAutoSave('date-change');
          });
        }
        if(bitsInput){
          bitsInput.addEventListener('input', ()=>{
            parseBitsString(bitsInput.value);
            applyBitsToCells();
            scheduleAutoSave('bits-input');
          });
        }
      }
      lastSavedState = captureCurrentState();
    }

    function reset(){
      bitsByDate.clear();
      if(tableEl){
        tableEl.querySelectorAll('.vac-cell').forEach(td => td.classList.remove('on'));
      }
      rebuild();
    }

    function loadFromString(str){
      parseBitsString(str || '');
      applyBitsToCells();
      updateBitsInput();
    }

    function setRangeAndBits(start, end, bits){
      if(startInput) startInput.value = normalizeDateStr(start) || '';
      if(endInput) endInput.value = normalizeDateStr(end) || '';
      if(bitsInput) bitsInput.value = bits || '';
      rebuild();
    }

    function getBitsString(){
      updateBitsInput();
      return bitsInput?.value || '';
    }

    if(opts.autoInit !== false){
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', init, { once:true });
      }else{
        init();
      }
    }

    return {
      rebuild,
      reset,
      loadFromString,
      syncInput: updateBitsInput,
      init,
      setRangeAndBits,
      getBitsString,
      applyBitsToCells,
      applyDateColorMap: applyExternalDateColors,
      setSaveMode: (mode)=>{ saveMode = mode || 'vacation'; }
    };
  }

  const defaultController = createVacationGanttController({
    rootEl: document.getElementById('vacationGantt'),
    startInput: vacationStartInput,
    endInput: vacationEndInput,
    bitsInput: vacationMembersBitsInput
  });

  window.createVacationGantt = createVacationGanttController;
  window.VacationGantt = defaultController || {
    rebuild: ()=>{},
    reset: ()=>{},
    loadFromString: ()=>{},
    syncInput: ()=>{}
  };
})();
