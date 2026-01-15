/**
 * App Logic & UI
 * Refactored from board.js, globals.js using App namespace and Event Delegation.
 */

// Shortcuts
const el = (tag, attrs = {}, children = []) => {
    const element = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'text') element.textContent = v;
        else if (k === 'class') element.className = v;
        else element.setAttribute(k, v);
    });
    children.forEach(c => {
        if (typeof c === 'string') element.appendChild(document.createTextNode(c));
        else if (c instanceof Node) element.appendChild(c);
    });
    return element;
};

const sanitizeText = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

// UI Helpers attached to App.UI
App.UI.DOM = {
    board: null,
    toast: null,
    menuEl: null,
    menuList: null,
    titleBtn: null,
    contactOverlay: null,

    init() {
        this.board = document.getElementById('board');
        this.toast = document.getElementById('toast');
        this.menuEl = document.getElementById('menu');
        this.menuList = document.getElementById('menuList');
        this.titleBtn = document.querySelector('.title-btn');
        if (this.titleBtn) {
            this.titleBtn.addEventListener('click', (e) => { e.stopPropagation(); App.UI.toggleMenu(); });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                App.UI.closeMenu();
                App.Logic.closeContactPopup();
                App.Logic.hideAllCandidatePanels();
            }
        });
        document.addEventListener('click', (e) => {
            if (this.menuEl && this.menuEl.classList.contains('show')) {
                const within = this.menuEl.contains(e.target) || this.titleBtn.contains(e.target);
                if (!within) App.UI.closeMenu();
            }
        });
    },

    showToast(msg, isError = false) {
        if (!this.toast) return;
        this.toast.innerHTML = '';
        const panel = el('div', { class: 'toast-panel' }, [msg]);
        this.toast.className = `toast ${isError ? 'toast--error' : 'toast--success'} show`;
        this.toast.appendChild(panel);
        setTimeout(() => {
            this.toast.classList.remove('show');
        }, 3000);
    }
};

App.Logic = {
    // Time Options
    buildTimeOptions(stepMin) {
        const startMin = 7 * 60;
        const endMin = 22 * 60;
        const frag = document.createDocumentFragment();
        frag.appendChild(el('option', { value: "", text: "" }));
        const step = Math.max(5, Math.min(60, Number(stepMin || 30)));
        for (let m = startMin; m <= endMin; m += step) {
            const h = Math.floor(m / 60), mm = m % 60;
            const t = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            frag.appendChild(el('option', { value: t, text: t }));
        }
        return frag;
    },

    // Candidate Panels
    renderCandidatePanel(panel, type) {
        if (!panel) return;
        const options = type === 'workHours'
            ? (App.State.MENUS?.businessHours || [])
            : (App.State.MENUS?.noteOptions || []);

        panel.replaceChildren();
        const ul = el('ul', { class: 'candidate-list' });
        const vals = [''].concat(Array.isArray(options) ? options.map(v => String(v ?? '')) : []);

        vals.forEach(v => {
            const label = v === '' ? '（空白）' : v;
            const btn = el('button', {
                type: 'button',
                class: 'candidate-option',
                'data-value': v,
                text: label
            });
            ul.appendChild(el('li', {}, [btn]));
        });
        panel.appendChild(ul);
    },

    toggleCandidatePanel(wrapper) {
        if (!wrapper) return;
        const panel = wrapper.querySelector('.candidate-panel');
        const btn = wrapper.querySelector('.candidate-btn');
        const type = wrapper.dataset.type;
        if (!panel || !type) return;

        const isOpen = panel.classList.contains('show');
        this.hideAllCandidatePanels();
        if (isOpen) {
            panel.classList.remove('show');
            if (btn) btn.setAttribute('aria-expanded', 'false');
            return;
        }
        this.renderCandidatePanel(panel, type);
        panel.classList.add('show');
        if (btn) btn.setAttribute('aria-expanded', 'true');
    },

    hideAllCandidatePanels() {
        const board = App.UI.DOM.board;
        if (!board) return;
        board.querySelectorAll('.candidate-panel.show').forEach(p => {
            p.classList.remove('show');
            const btn = p.closest('.candidate-input')?.querySelector('.candidate-btn');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
    },

    buildCandidateField({ id, name, placeholder, type, value }) {
        const wrapper = el('div', { class: 'candidate-input', 'data-type': type });
        const input = el('input', {
            id, name, type: 'text', placeholder, autocomplete: 'off', inputmode: 'text'
        });
        if (value != null) input.value = value;

        let btn = null;
        if (type !== 'note' && type !== 'workHours') {
            btn = el('button', {
                type: 'button', class: 'candidate-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': '候補を表示'
            });
            btn.innerHTML = '▼';
        }

        const panel = el('div', { class: 'candidate-panel', role: 'listbox' });
        wrapper.appendChild(input);
        if (btn) wrapper.appendChild(btn);
        wrapper.appendChild(panel);

        // click on input for note/workHours also toggles
        if (type === 'note' || type === 'workHours') {
            input.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!panel.classList.contains('show')) {
                    this.hideAllCandidatePanels();
                    this.renderCandidatePanel(panel, type);
                    panel.classList.add('show');
                }
            });
        }

        return { wrapper, input };
    },

    // Row Logic
    getRowStateByTr(tr) {
        if (!tr) return null;
        const key = tr.dataset.key;
        const workHoursInput = tr.querySelector('input[name="workHours"]');
        return {
            id: key,
            ext: tr.querySelector('td.ext')?.textContent.trim() || "",
            workHours: workHoursInput ? workHoursInput.value : "",
            status: tr.querySelector('select[name="status"]').value,
            time: tr.querySelector('select[name="time"]').value,
            note: tr.querySelector('input[name="note"]').value
        };
    },

    buildRow(member) {
        const name = member.name || "";
        const ext = (member.ext && /^[0-9]{1,6}$/.test(String(member.ext))) ? String(member.ext) : "";
        const key = member.id;
        const tr = el('tr', { id: `row-${key}` });
        tr.dataset.key = key;
        tr.dataset.rev = '0';
        tr.dataset.mobile = member.mobile ? String(member.mobile) : '';
        tr.dataset.email = member.email ? String(member.email) : '';

        const tdName = el('td', { class: 'name', 'data-label': '氏名' });
        tdName.textContent = name;

        // Attach long press
        this.attachContactLongPress(tdName, tr, member);

        const tdExt = el('td', { class: 'ext', 'data-label': '内線' }, [ext]);

        const workPlaceholder = '09:00-17:30';
        const workInit = member.workHours == null ? '' : String(member.workHours);
        const tdWork = el('td', { class: 'work', 'data-label': '業務時間' });
        const workField = this.buildCandidateField({ id: `work-${key}`, name: 'workHours', placeholder: workPlaceholder, type: 'workHours', value: workInit });
        tdWork.appendChild(el('label', { class: 'sr-only', for: `work-${key}`, text: '業務時間' }));
        tdWork.appendChild(workField.wrapper);

        const tdStatus = el('td', { class: 'status', 'data-label': 'ステータス' });
        const selStatus = el('select', { id: `status-${key}`, name: 'status' });
        tdStatus.appendChild(el('label', { class: 'sr-only', for: `status-${key}`, text: 'ステータス' }));
        App.State.STATUSES.forEach(s => selStatus.appendChild(el('option', { value: s.value, text: s.value })));
        tdStatus.appendChild(selStatus);

        const tdTime = el('td', { class: 'time', 'data-label': '戻り時間' });
        const selTime = el('select', { id: `time-${key}`, name: 'time' });
        tdTime.appendChild(el('label', { class: 'sr-only', for: `time-${key}`, text: '戻り時間' }));
        selTime.appendChild(this.buildTimeOptions(App.State.MENUS?.timeStepMinutes));
        tdTime.appendChild(selTime);

        const tdNote = el('td', { class: 'note', 'data-label': '備考' });
        const noteField = this.buildCandidateField({ id: `note-${key}`, name: 'note', placeholder: '備考', type: 'note' });
        tdNote.appendChild(noteField.wrapper);

        tr.append(tdName, tdExt, tdWork, tdStatus, tdTime, tdNote);
        return tr;
    },

    buildPanel(group, idx) {
        const gid = `grp-${idx}`;
        const sec = el('section', { class: 'panel', id: gid });
        sec.dataset.groupIndex = String(idx);

        const title = group.title || `グループ${idx + 1}`;
        sec.appendChild(el('h3', { class: 'title', text: title }));

        const table = el('table', { 'aria-label': `在席表（${title}）` });
        table.appendChild(el('colgroup', {}, [
            el('col', { class: 'col-name' }), el('col', { class: 'col-ext' }), el('col', { class: 'col-work' }),
            el('col', { class: 'col-status' }), el('col', { class: 'col-time' }), el('col', { class: 'col-note' })
        ]));

        const thead = el('thead');
        const thr = el('tr');
        ['氏名', '内線', '業務時間', 'ステータス', '戻り時間', '備考'].forEach(h => thr.appendChild(el('th', { text: h })));
        thead.appendChild(thr);
        table.appendChild(thead);

        const tbody = el('tbody');
        (group.members || []).forEach(m => {
            const r = this.buildRow(m);
            tbody.appendChild(r);
        });
        table.appendChild(tbody);
        sec.appendChild(table);
        return sec;
    },

    ensureRowControls(tr) {
        if (!tr) return;
        const key = tr.dataset.key;
        // Self-healing: status
        let s = tr.querySelector('td.status select');
        if (!s) {
            const td = tr.querySelector('td.status');
            s = el('select', { id: `status-${key}`, name: 'status' });
            App.State.STATUSES.forEach(x => s.appendChild(el('option', { value: x.value, text: x.value })));
            td && td.appendChild(s);
        }
        // Self-healing: time
        let t = tr.querySelector('td.time select');
        if (!t) {
            const td = tr.querySelector('td.time');
            t = el('select', { id: `time-${key}`, name: 'time' });
            t.appendChild(this.buildTimeOptions(App.State.MENUS?.timeStepMinutes));
            td && td.appendChild(t);
        }
        // Self-healing: workHours
        let w = tr.querySelector('input[name="workHours"]');
        if (!w || !w.closest('.candidate-input')) {
            const td = tr.querySelector('td.work');
            const placeholder = '09:00-17:30';
            const field = this.buildCandidateField({ id: `work-${key}`, name: 'workHours', placeholder, type: 'workHours', value: w?.value });
            if (td) {
                if (!td.querySelector('label.sr-only')) {
                    td.insertBefore(el('label', { class: 'sr-only', for: `work-${key}`, text: '業務時間' }), td.firstChild || null);
                }
                td.querySelector('.candidate-input')?.remove();
                td.appendChild(field.wrapper);
                w = field.input;
            }
        }
        // Self-healing: note
        const noteInp = tr.querySelector('input[name="note"]');
        if (!noteInp || !noteInp.closest('.candidate-input')) {
            const td = tr.querySelector('td.note');
            const field = this.buildCandidateField({ id: `note-${key}`, name: 'note', placeholder: '備考', type: 'note', value: noteInp?.value });
            if (td) {
                td.querySelector('.candidate-input')?.remove();
                td.appendChild(field.wrapper);
            }
        }
    },

    ensureTimePrompt(tr) {
        if (!tr) return;
        const statusEl = tr.querySelector('select[name="status"]');
        const timeTd = tr.querySelector('td.time');
        const timeEl = tr.querySelector('select[name="time"]');
        if (!(statusEl && timeTd && timeEl)) return;
        const needs = App.State.requiresTimeSet.has(statusEl.value);
        const empty = !timeEl.value;
        if (needs && empty) {
            timeTd.classList.add('need-time');
            timeEl.setAttribute('aria-invalid', 'true');
            let hint = timeTd.querySelector('.time-hint');
            if (!hint) { hint = document.createElement('span'); hint.className = 'time-hint'; hint.textContent = '戻り時間を選択'; timeTd.appendChild(hint); }
        } else {
            timeTd.classList.remove('need-time');
            timeEl.removeAttribute('aria-invalid');
            const hint = timeTd.querySelector('.time-hint'); if (hint) hint.remove();
        }
    },

    // Event Wiring
    wireEvents() {
        const board = App.UI.DOM.board;
        if (!board) return;

        // Delegation
        document.addEventListener('click', (e) => {
            // Candidate Button
            const candidateBtn = e.target.closest('.candidate-btn');
            if (candidateBtn && board.contains(candidateBtn)) {
                e.preventDefault(); e.stopPropagation();
                this.toggleCandidatePanel(candidateBtn.closest('.candidate-input'));
                return;
            }
            // Candidate Option
            const candidateOpt = e.target.closest('.candidate-option');
            if (candidateOpt) {
                e.preventDefault();
                const wrapper = candidateOpt.closest('.candidate-input');
                const input = wrapper?.querySelector('input');
                if (input) {
                    input.value = candidateOpt.dataset.value ?? '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                }
                this.hideAllCandidatePanels();
                return;
            }

            if (!e.target.closest('.candidate-input')) this.hideAllCandidatePanels();
        });

        // Focus/Blur for editing state
        board.addEventListener('focusin', e => {
            const t = e.target;
            if (t && t.dataset) t.dataset.editing = '1';
        });
        board.addEventListener('focusout', e => {
            const t = e.target;
            if (t && t.dataset) delete t.dataset.editing;
        });

        board.addEventListener('change', (e) => {
            const t = e.target;
            if (!t) return;
            const tr = t.closest('tr');
            if (!tr) return;
            if (t.name === 'status') this.handleStatusChange(tr, t);
            else if (t.name === 'time') this.handleTimeChange(tr, t);
        });

        board.addEventListener('input', (e) => {
            const t = e.target;
            if (!t || !t.closest('tr')) return;
            const key = t.closest('tr').dataset.key;
            if (t.name === 'note' || t.name === 'workHours') {
                App.Network.debounceRowPush(key);
            }
        });
    },

    handleStatusChange(tr, statusEl) {
        const status = statusEl.value;
        const timeSel = tr.querySelector('select[name="time"]');
        const noteInp = tr.querySelector('input[name="note"]');

        // Recolor
        tr.className = '';
        const cls = App.State.statusClassMap.get(status);
        if (cls) tr.classList.add(cls);

        // Toggle Time
        this.toggleTimeEnable(statusEl, timeSel);

        // Clear on set
        if (App.State.clearOnSet.has(status)) {
            if (timeSel) timeSel.value = '';
            if (noteInp && this.isNotePresetValue(noteInp.value)) { noteInp.value = ''; }
        }

        this.ensureTimePrompt(tr);

        App.Network.debounceRowPush(tr.dataset.key);
    },

    isNotePresetValue(val) {
        const v = (val == null ? "" : String(val)).trim();
        if (v === "") return true;
        const set = new Set((App.State.MENUS?.noteOptions || []).map(x => String(x)));
        return set.has(v);
    },

    handleTimeChange(tr, timeEl) {
        this.ensureTimePrompt(tr);
        App.Network.debounceRowPush(tr.dataset.key);
    },

    toggleTimeEnable(statusEl, timeEl) {
        if (!timeEl) return;
        const needsTime = App.State.requiresTimeSet.has(statusEl.value);
        const timeTd = timeEl.closest('td.time');
        if (needsTime) {
            timeEl.setAttribute('aria-disabled', 'false');
            timeEl.tabIndex = 0;
            timeTd?.classList.remove('time-disabled');
        } else {
            timeEl.setAttribute('aria-disabled', 'true');
            timeEl.tabIndex = -1;
            timeTd?.classList.add('time-disabled');
        }
    },

    // Contact Event Logic (Long Press)
    contactHoldTimer: null,
    contactScrollBound: false,

    closeContactPopup() {
        if (App.UI.DOM.contactOverlay) {
            App.UI.DOM.contactOverlay.remove();
            App.UI.DOM.contactOverlay = null;
        }
    },

    resolveContactInfo(tr, fallback) {
        const nameText = tr?.querySelector('td.name')?.textContent || fallback?.name || '';
        const mobileVal = tr ? (tr.dataset.mobile ?? '') : '';
        const emailVal = tr ? (tr.dataset.email ?? '') : '';
        return {
            name: nameText,
            mobile: (mobileVal || fallback?.mobile || '').trim(),
            email: (emailVal || fallback?.email || '').trim()
        };
    },

    showContactPopup(member) {
        this.closeContactPopup();
        const overlay = el('div', { class: 'contact-overlay' });
        const dialogLabel = `${sanitizeText(member.name || '')}の連絡先`;
        const dialog = el('div', { class: 'contact-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': dialogLabel });
        const closeBtn = el('button', { type: 'button', class: 'contact-close', 'aria-label': '閉じる' }, ['×']);
        const title = el('h4', { class: 'contact-title', text: dialogLabel });

        const mobile = member.mobile ? String(member.mobile) : '';
        const email = member.email ? String(member.email) : '';

        const mobileRow = el('div', { class: 'contact-row' }, [
            el('span', { class: 'contact-label', text: '携帯' }),
            mobile
                ? el('a', { class: 'contact-link', href: `tel:${mobile}`, text: mobile })
                : el('span', { class: 'contact-empty', text: '未登録' })
        ]);

        const emailRow = el('div', { class: 'contact-row' }, [
            el('span', { class: 'contact-label', text: 'メール' }),
            email
                ? el('a', { class: 'contact-link', href: `mailto:${encodeURIComponent(email)}`, text: email })
                : el('span', { class: 'contact-empty', text: '未登録' })
        ]);

        const body = el('div', { class: 'contact-body' }, [mobileRow, emailRow]);
        closeBtn.addEventListener('click', () => this.closeContactPopup());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeContactPopup(); });

        dialog.append(closeBtn, title, body);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        App.UI.DOM.contactOverlay = overlay;
        closeBtn.focus({ preventScroll: true });
    },

    attachContactLongPress(tdName, tr, fallbackMember) {
        if (!tdName) return;
        const HOLD_DELAY_MS = 900;
        const MOVE_TOLERANCE_PX = 10;
        let startTouchPoint = null;

        const startHold = (touchPoint) => {
            if (this.contactHoldTimer) clearTimeout(this.contactHoldTimer);
            startTouchPoint = touchPoint ? { x: touchPoint.clientX, y: touchPoint.clientY } : null;
            this.contactHoldTimer = setTimeout(() => {
                this.contactHoldTimer = null;
                const payload = this.resolveContactInfo(tr, fallbackMember);
                this.showContactPopup(payload);
            }, HOLD_DELAY_MS);
        };
        const cancelHold = () => {
            startTouchPoint = null;
            if (this.contactHoldTimer) clearTimeout(this.contactHoldTimer);
            this.contactHoldTimer = null;
        };
        const handleTouchStart = (e) => {
            // e.preventDefault(); // Don't prevent default, allow scrolling? 
            // Actually board.js had preventDefault() but it might block scrolling if not careful.
            // board.js: e.preventDefault()
            const touch = e.touches?.[0];
            startHold(touch);
        };
        const handleTouchMove = (e) => {
            if (!startTouchPoint) return;
            const touch = e.touches?.[0];
            if (!touch) return cancelHold();
            const dx = Math.abs(touch.clientX - startTouchPoint.x);
            const dy = Math.abs(touch.clientY - startTouchPoint.y);
            if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
                cancelHold();
            }
        };

        const handleMouseDown = (e) => { if (e.button === 0) startHold(); };

        tdName.addEventListener('touchstart', handleTouchStart, { passive: true }); // Changed to passive:true for scroll logic? 
        // Logic in board.js was: Start timer. If scrolled or moved, cancel.
        tdName.addEventListener('touchend', cancelHold, { passive: true });
        tdName.addEventListener('touchcancel', cancelHold);
        tdName.addEventListener('touchmove', handleTouchMove, { passive: true });
        tdName.addEventListener('mousedown', handleMouseDown);
        tdName.addEventListener('mouseup', cancelHold);
        tdName.addEventListener('mouseleave', cancelHold);

        if (!this.contactScrollBound) {
            window.addEventListener('scroll', () => cancelHold(), { passive: true, capture: true });
            this.contactScrollBound = true;
        }
    },

    // Public Apply State
    applyState(data) {
        if (!data) return;
        Object.entries(data).forEach(([k, v]) => {
            if (App.State.PENDING_ROWS.has(k)) return;
            const tr = document.getElementById(`row-${k}`);
            if (!tr) return; // Should ensureRowControls
            this.ensureRowControls(tr);

            const s = tr.querySelector('select[name="status"]');
            const t = tr.querySelector('select[name="time"]');
            const w = tr.querySelector('input[name="workHours"]');
            const n = tr.querySelector('input[name="note"]');
            const extTd = tr.querySelector('td.ext');

            if (extTd && v && v.ext !== undefined) {
                extTd.textContent = String(v.ext || '').replace(/[^0-9]/g, '');
            }
            if (v && v.mobile !== undefined) { tr.dataset.mobile = String(v.mobile ?? '').trim(); }
            if (v && v.email !== undefined) { tr.dataset.email = String(v.email ?? '').trim(); }

            if (v.status && App.State.STATUSES.some(x => x.value === v.status)) if (s) s.value = v.status;
            if (v.workHours != null && w) w.value = v.workHours;
            if (v.time != null && t) t.value = v.time;
            if (v.note != null && n) n.value = v.note;

            const remoteRev = Number(v.rev || 0);
            const localRev = Number(tr.dataset.rev || 0);
            if (remoteRev > localRev) {
                tr.dataset.rev = String(remoteRev);
            }

            if (s && t) this.toggleTimeEnable(s, t);
            this.ensureTimePrompt(tr);

            // Recolor
            tr.className = '';
            const cls = App.State.statusClassMap.get(s?.value);
            if (cls) tr.classList.add(cls);
        });
    }
};

App.UI.render = function () {
    const board = App.UI.DOM.board;
    if (!board) return;
    board.replaceChildren();

    (App.State.GROUPS || []).forEach((g, i) => {
        board.appendChild(App.Logic.buildPanel(g, i));
    });

    board.style.display = '';

    // Wire events
    App.Logic.wireEvents();

    // Group Menu
    App.UI.buildGroupMenu();
};

App.UI.buildGroupMenu = function () {
    if (!App.UI.DOM.menuList) return;
    App.UI.DOM.menuList.replaceChildren();

    const total = (App.State.GROUPS || []).reduce((s, g) => s + ((g.members && g.members.length) || 0), 0);
    const topBtn = el('button', { class: 'grp-item', 'data-target': 'top', text: `全体（合計：${total}名）` });
    topBtn.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); App.UI.closeMenu(); });
    App.UI.DOM.menuList.appendChild(el('li', {}, [topBtn]));

    (App.State.GROUPS || []).forEach((g, i) => {
        const title = g.title || `グループ${i + 1}`;
        const sub = (g.members?.length) ? `（${g.members.length}名）` : '（0名）';
        const span = el('span', { class: 'muted', text: ` ${sub}` });
        const btn = el('button', { class: 'grp-item', 'data-target': `grp-${i}` }, [title, span]);
        btn.addEventListener('click', () => {
            document.getElementById(`grp-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            App.UI.closeMenu();
        });
        App.UI.DOM.menuList.appendChild(el('li', {}, [btn]));
    });
};

App.UI.toggleMenu = function () {
    if (App.UI.DOM.menuEl) {
        App.UI.DOM.menuEl.classList.toggle('show');
        const isShow = App.UI.DOM.menuEl.classList.contains('show');
        if (App.UI.DOM.titleBtn) App.UI.DOM.titleBtn.setAttribute('aria-expanded', String(isShow));
    }
};
App.UI.closeMenu = function () {
    if (App.UI.DOM.menuEl) {
        App.UI.DOM.menuEl.classList.remove('show');
        if (App.UI.DOM.titleBtn) App.UI.DOM.titleBtn.setAttribute('aria-expanded', 'false');
    }
};
