/**
 * App Network & Sync
 * Refactored from sync.js
 */

App.Network = {
    // Config
    remotePullTimer: null,
    configWatchTimer: null,
    fallbackTimer: null,
    tokenRenewTimer: null,
    unsubscribeSnapshot: null,
    useSdkMode: false,
    rowTimers: new Map(),

    // Setup Menus (Logic moved here for cohesion)
    defaultMenus() {
        return {
            timeStepMinutes: 30,
            statuses: [
                { value: "在席", class: "st-here", clearOnSet: true },
                { value: "外出", requireTime: true, class: "st-out" },
                { value: "在宅勤務", class: "st-remote", clearOnSet: true },
                { value: "出張", requireTime: true, class: "st-trip" },
                { value: "研修", requireTime: true, class: "st-training" },
                { value: "健康診断", requireTime: true, class: "st-health" },
                { value: "コアドック", requireTime: true, class: "st-coadoc" },
                { value: "帰宅", class: "st-home" },
                { value: "休み", class: "st-off", clearOnSet: true }
            ],
            noteOptions: ["直出", "直帰", "直出・直帰"],
            businessHours: [
                "07:00-15:30", "07:30-16:00", "08:00-16:30", "08:30-17:00", "09:00-17:30",
                "09:30-18:00", "10:00-18:30", "10:30-19:00", "11:00-19:30", "11:30-20:00", "12:00-20:30"
            ]
        };
    },

    setupMenus(m) {
        const base = this.defaultMenus();
        const MENUS = (m && typeof m === 'object') ? Object.assign({}, base, m) : base;
        App.State.MENUS = MENUS;

        // Normalization
        if (!Array.isArray(MENUS.businessHours)) MENUS.businessHours = base.businessHours;

        // Status setup
        const sts = Array.isArray(MENUS.statuses) ? MENUS.statuses : base.statuses;
        App.State.STATUSES = sts.map(s => ({ value: String(s.value) }));
        App.State.requiresTimeSet = new Set(sts.filter(s => s.requireTime).map(s => String(s.value)));
        App.State.clearOnSet = new Set(sts.filter(s => s.clearOnSet).map(s => String(s.value)));
        App.State.statusClassMap = new Map(sts.map(s => [String(s.value), String(s.class || "")]));

        // Update Datalists
        this.updateDatalists();
    },

    updateDatalists() {
        // Re-implement datalist population
        let dl = document.getElementById('noteOptions');
        if (!dl) { dl = document.createElement('datalist'); dl.id = 'noteOptions'; document.body.appendChild(dl); }
        dl.replaceChildren();
        const optBlank = document.createElement('option'); optBlank.value = ""; optBlank.label = "（空白）";
        dl.appendChild(optBlank);
        (App.State.MENUS.noteOptions || []).forEach(t => {
            const opt = document.createElement('option'); opt.value = String(t); dl.appendChild(opt);
        });

        // WorkHours (legacy support)
        let workDl = document.getElementById('workHourOptions');
        if (!workDl) { workDl = document.createElement('datalist'); workDl.id = 'workHourOptions'; document.body.appendChild(workDl); }
        workDl.replaceChildren();
        const wBlank = document.createElement('option'); wBlank.value = ""; wBlank.label = "（空白）";
        workDl.appendChild(wBlank);
        (App.State.MENUS.businessHours || []).forEach(h => {
            const opt = document.createElement('option'); opt.value = String(h); workDl.appendChild(opt);
        });
    },

    // API Post
    async apiPost(payload) {
        try {
            const res = await fetch(App.Config.REMOTE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.error("API Error:", e);
            return { error: 'network', details: e.message };
        }
    },

    // Plan B: Legacy Polling
    async startLegacyPolling(immediate) {
        console.log("Fallback to Workers Polling (Plan B)");
        this.useSdkMode = false;
        if (this.remotePullTimer) { clearInterval(this.remotePullTimer); this.remotePullTimer = null; }

        // Ensure config watch is running in Plan B
        this.startConfigWatch(true);

        const pollAction = async () => {
            const r = await this.apiPost({ action: 'get', token: App.State.SESSION_TOKEN });
            if (r?.error === 'unauthorized') {
                // App.Auth.logout(); 
                return;
            }
            if (r && r.data) App.Logic.applyState(r.data);
        };

        if (immediate) pollAction().catch(() => { });
        this.remotePullTimer = setInterval(pollAction, App.Config.REMOTE_POLL_MS);
    },

    // Plan A: Remote Sync with Firebase
    startRemoteSync(immediate) {
        if (this.remotePullTimer) { clearInterval(this.remotePullTimer); this.remotePullTimer = null; }
        if (this.unsubscribeSnapshot) { this.unsubscribeSnapshot(); this.unsubscribeSnapshot = null; }
        if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; }

        if (!App.State.CURRENT_OFFICE_ID) {
            console.error("No Office ID");
            return;
        }

        if (!App.initFirebase()) {
            this.startLegacyPolling(immediate);
            return;
        }

        // Fallback Timer
        this.fallbackTimer = setTimeout(() => {
            if (!this.useSdkMode) {
                console.warn("Plan A Timeout. Switching to Plan B.");
                this.startLegacyPolling(immediate);
            }
        }, 5000);

        firebase.auth().signInAnonymously().then(() => {
            const db = firebase.firestore();
            const docRef = db.collection('offices').doc(App.State.CURRENT_OFFICE_ID).collection('members');

            this.unsubscribeSnapshot = docRef.onSnapshot((snapshot) => {
                if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; }

                if (!this.useSdkMode) {
                    console.log("Plan A Connected.");
                    this.useSdkMode = true;
                    // Stop config poll if SDk connected
                    if (this.configWatchTimer) { clearInterval(this.configWatchTimer); this.configWatchTimer = null; }
                }

                let needsConfigRefetch = false;
                const changes = {};
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added' || change.type === 'removed') needsConfigRefetch = true;
                    changes[change.doc.id] = change.doc.data();
                });

                if (needsConfigRefetch) this.fetchConfigOnce();
                if (Object.keys(changes).length > 0) App.Logic.applyState(changes);

            }, (error) => {
                console.error("Plan A Error:", error);
                if (this.fallbackTimer) { clearTimeout(this.fallbackTimer); this.fallbackTimer = null; }
                if (!this.useSdkMode) this.startLegacyPolling(immediate);
            });
        }).catch(e => {
            console.error("Auth Error:", e);
            this.startLegacyPolling(immediate);
        });
    },

    async fetchConfigOnce() {
        const cfg = await this.apiPost({ action: 'getConfig', token: App.State.SESSION_TOKEN, nocache: '1' });
        if (cfg && !cfg.error) {
            const updated = cfg.updated || 0;
            const groups = cfg.groups || cfg.config?.groups || [];
            const menus = cfg.menus || cfg.config?.menus || null;

            const shouldUpdate = (updated && updated !== App.State.CONFIG_UPDATED) || (!updated && App.State.CONFIG_UPDATED === 0);
            if (shouldUpdate) {
                App.State.GROUPS = this.normalizeConfigClient(groups);
                App.State.CONFIG_UPDATED = updated || Date.now();
                this.setupMenus(menus);
                App.UI.render();
            }
        }
    },

    startConfigWatch(immediate = true) {
        if (this.configWatchTimer) { clearInterval(this.configWatchTimer); this.configWatchTimer = null; }
        if (immediate) this.fetchConfigOnce().catch(console.error);
        this.configWatchTimer = setInterval(() => this.fetchConfigOnce(), App.Config.CONFIG_POLL_MS);
    },

    normalizeConfigClient(groups) {
        return (groups || []).map(g => ({
            title: g.title || "",
            members: (g.members || []).map(m => ({
                id: String(m.id ?? "").trim(),
                name: String(m.name ?? ""),
                ext: m.ext || "",
                mobile: m.mobile || "",
                email: m.email || "",
                workHours: m.workHours || ""
            })).filter(m => m.id || m.name)
        }));
    },

    debounceRowPush(key) {
        if (App.State.PENDING_ROWS.has(key)) {
            // Already pending, just reset timer?
            // Actually board.js logic was: set PENDING, clear old timer, set new timer.
            // We can follow that.
        }
        App.State.PENDING_ROWS.add(key);

        if (this.rowTimers.has(key)) clearTimeout(this.rowTimers.get(key));

        // Add dataset.editing to inputs (visual feedback/locking prevention)
        const tr = document.getElementById(`row-${key}`);
        if (tr) tr.querySelectorAll('input,select').forEach(e => e.dataset.editing = "true");

        const timerId = setTimeout(() => {
            this.rowTimers.delete(key);
            this.pushRowDelta(key);
        }, 1500); // 1.5s debounce

        this.rowTimers.set(key, timerId);
    },

    async pushRowDelta(key) {
        const tr = document.getElementById(`row-${key}`);
        if (!tr) return;
        const st = App.Logic.getRowStateByTr(tr);
        if (!st) return;

        st.workHours = st.workHours == null ? '' : String(st.workHours);
        const baseRev = { [key]: Number(tr.dataset.rev || 0) };
        const payload = { updated: Date.now(), data: { [key]: st } };

        try {
            const r = await this.apiPost({
                action: 'set',
                token: App.State.SESSION_TOKEN,
                data: JSON.stringify(payload),
                baseRev: JSON.stringify(baseRev)
            });

            if (!r) {
                App.UI.showToast('通信エラー', true);
                return;
            }

            if (r.error === 'conflict') {
                const c = (r.conflicts && r.conflicts.find(x => x.id === key)) || null;
                if (c && c.server) {
                    App.Logic.applyState({ [key]: c.server });
                    App.UI.showToast('競合しました（再読込）', true);
                } else {
                    // Just update revision if conflict but no content change?
                    const rev = Number((r.rev && r.rev[key]) || 0);
                    if (rev) tr.dataset.rev = String(rev);
                }
                return;
            }

            if (!r.error) {
                const rev = Number((r.rev && r.rev[key]) || 0);
                if (rev) tr.dataset.rev = String(rev);
                return;
            }

            App.UI.showToast('保存失敗', true);
        } finally {
            App.State.PENDING_ROWS.delete(key);
            if (tr) {
                tr.querySelectorAll('[data-editing]').forEach(e => delete e.dataset.editing);
            }
        }
    }
};
