/**
 * App Notices
 * Refactored from notices.js
 */
App.Notices = {
    pollingTimer: null,
    unsubscribe: null,
    collapsedKey: 'noticeAreaCollapsed',
    collapsePreference: false,

    init() {
        this.collapsePreference = this.loadCollapsePreference();
        const noticesHeader = document.querySelector('#noticesArea .notices-header');
        if (noticesHeader) {
            // Remove old listeners by cloning
            const newHeader = noticesHeader.cloneNode(true);
            noticesHeader.parentNode.replaceChild(newHeader, noticesHeader);
            newHeader.addEventListener('click', () => this.toggleNoticesArea());
        }
    },

    loadCollapsePreference() {
        try {
            const officeKey = `${this.collapsedKey}_${App.State.CURRENT_OFFICE_ID || 'default'}`;
            const raw = localStorage.getItem(officeKey);
            return raw === 'true';
        } catch { return false; }
    },

    saveCollapsePreference(collapsed) {
        this.collapsePreference = !!collapsed;
        try {
            const officeKey = `${this.collapsedKey}_${App.State.CURRENT_OFFICE_ID || 'default'}`;
            localStorage.setItem(officeKey, this.collapsePreference ? 'true' : 'false');
        } catch { }
    },

    toggleNoticesArea() {
        const noticesArea = document.getElementById('noticesArea');
        if (!noticesArea) return;
        const isCollapsed = noticesArea.classList.toggle('collapsed');
        this.saveCollapsePreference(isCollapsed);
    },

    startPolling() {
        if (this.unsubscribe) return;

        const db = (typeof firebase !== 'undefined' && firebase.apps.length) ? firebase.firestore() : null;
        if (db && App.State.CURRENT_OFFICE_ID) {
            console.log('Notices: start listener');
            const colRef = db.collection('offices').doc(App.State.CURRENT_OFFICE_ID).collection('notices');
            this.unsubscribe = colRef.onSnapshot((snapshot) => {
                const list = [];
                snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
                this.applyNotices(list);
            }, (e) => {
                console.warn('Notices listener failed:', e);
                this.startLegacyPolling();
            });
        } else {
            this.startLegacyPolling();
        }
    },

    startLegacyPolling() {
        if (this.pollingTimer) return;
        this.fetchNotices();
        this.pollingTimer = setInterval(() => {
            if (App.State.SESSION_TOKEN) this.fetchNotices();
            else this.stopPolling();
        }, 30000);
    },

    stopPolling() {
        if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
        if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    },

    async fetchNotices() {
        if (!App.State.SESSION_TOKEN) return;
        const res = await App.Network.apiPost({
            action: 'getNotices',
            token: App.State.SESSION_TOKEN,
            office: App.State.CURRENT_OFFICE_ID,
            nocache: '1'
        });
        if (res && res.notices) {
            this.applyNotices(res.notices);
        }
    },

    applyNotices(raw) {
        // Normalization logic simplified for brevity but essential parts kept
        // Assume raw is array of objects or strings
        const list = (Array.isArray(raw) ? raw : []).map(n => {
            if (typeof n === 'string') return { title: n, content: '', visible: true };
            return n;
        }).filter(n => {
            const v = n.visible ?? n.display ?? true;
            return v !== false && String(v) !== 'false';
        });

        App.State.CURRENT_NOTICES = list;
        this.renderNotices(list);
    },

    renderNotices(list) {
        const area = document.getElementById('noticesArea');
        const container = document.getElementById('noticesList');
        const btn = document.getElementById('noticesBtn');
        const summary = document.getElementById('noticesSummary');

        if (!area || !container) return;

        if (!list || list.length === 0) {
            container.innerHTML = '';
            area.style.display = 'none';
            if (btn) btn.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        list.forEach(n => {
            const div = el('div', { class: 'notice-item' });
            const title = n.title || '';
            const body = n.content || '';
            // ... rendering logic ...
            div.innerHTML = `<div class="notice-header"><span class="notice-toggle">➤</span><span class="notice-title">${sanitizeText(title)}</span></div>`;
            if (body) {
                div.innerHTML += `<div class="notice-content">${sanitizeText(body)}</div>`; // Should linkify
                div.querySelector('.notice-header').addEventListener('click', () => div.classList.toggle('expanded'));
            } else {
                div.classList.add('title-only');
            }
            container.appendChild(div);
        });

        if (summary) {
            summary.textContent = list.length > 0 ? `${list[0].title} (他${list.length - 1}件)` : '';
        }

        area.style.display = 'block';
        if (btn) btn.style.display = 'inline-block';

        if (this.collapsePreference) area.classList.add('collapsed');
        else area.classList.remove('collapsed');
    }
};
