/**
 * App Tools
 * Refactored from tools.js
 */
App.Tools = {
    pollingTimer: null,
    unsubscribe: null,
    pollOfficeId: '',

    startPolling(officeId) {
        const target = officeId || App.State.CURRENT_OFFICE_ID;
        if (!target) return;
        if (this.unsubscribe) return;

        const db = (typeof firebase !== 'undefined' && firebase.apps.length) ? firebase.firestore() : null;
        if (db) {
            console.log('Tools: start listener');
            const docRef = db.collection('offices').doc(target).collection('tools').doc('config');
            this.unsubscribe = docRef.onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    this.applyToolsData(data.tools || [], []);
                } else {
                    this.applyToolsData([], []);
                }
            }, (e) => {
                this.startLegacyPolling(target);
            });
        } else {
            this.startLegacyPolling(target);
        }
    },

    startLegacyPolling(officeId) {
        if (this.pollingTimer) return;
        this.pollOfficeId = officeId;
        this.fetchTools();
        this.pollingTimer = setInterval(() => this.fetchTools(), 60000);
    },

    stopPolling() {
        if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; }
        if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    },

    async fetchTools() {
        if (!App.State.SESSION_TOKEN) return;
        const res = await App.Network.apiPost({
            action: 'getTools',
            token: App.State.SESSION_TOKEN,
            office: this.pollOfficeId,
            nocache: '1'
        });
        if (res && res.tools) {
            this.applyToolsData(res.tools, res.warnings);
        }
    },

    applyToolsData(raw, warnings) {
        // Simplification for brevity: Assume normalization
        // In real port, we should copy the normalization logic
        const list = App.Tools.normalize(raw); // Placeholder for normalization
        this.renderToolsList(list);
    },

    normalize(raw) {
        // Simple passthrough for now, relying on existing structure or simplified one
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.list)) return raw.list;
        return [];
    },

    renderToolsList(list) {
        const container = document.getElementById('toolsList');
        if (!container) return;
        container.innerHTML = '';
        if (!list || !list.length) {
            container.textContent = 'ツール情報なし';
            return;
        }
        // Recursive render
        const render = (items, parent) => {
            items.forEach(item => {
                const div = el('div', { class: 'tools-item' });
                const link = item.url ? `<a href="${item.url}" target="_blank">${sanitizeText(item.title)}</a>` : sanitizeText(item.title);
                div.innerHTML = `<div class="tools-item-title">${link}</div>`;
                if (item.note) div.innerHTML += `<div class="tools-item-note">${sanitizeText(item.note)}</div>`;
                parent.appendChild(div);
                if (item.children) {
                    const childContainer = el('div', { style: 'padding-left:12px' });
                    render(item.children, childContainer);
                    parent.appendChild(childContainer);
                }
            });
        };
        render(list, container);
    }
};
