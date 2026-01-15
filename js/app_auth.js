/**
 * App Auth
 * Refactored from auth.js
 */
App.Auth = {
    async checkLogin() {
        return new Promise((resolve) => {
            if (typeof App.initFirebase === 'function') {
                App.initFirebase();
            }
            if (typeof firebase === 'undefined' || !(firebase.apps && firebase.apps.length)) {
                console.error("Firebase SDK not loaded");
                resolve(false);
                return;
            }

            firebase.auth().onAuthStateChanged((user) => {
                if (user) {
                    const storedOffice = localStorage.getItem('presence_office');
                    const storedRole = localStorage.getItem('presence_role');

                    if (storedOffice && storedRole) {
                        App.State.SESSION_TOKEN = 'firebase_session';
                        App.State.CURRENT_OFFICE_ID = storedOffice;
                        App.State.CURRENT_ROLE = storedRole;
                        this.updateAuthUI();

                        // Start Services
                        if (App.Network.startRemoteSync) App.Network.startRemoteSync(true);
                        if (App.Network.startConfigWatch) App.Network.startConfigWatch();
                        if (App.Notices && App.Notices.startPolling) App.Notices.startPolling();
                        if (App.Tools && App.Tools.startPolling) App.Tools.startPolling(storedOffice);

                        resolve(true);
                    } else {
                        this.logout();
                        resolve(false);
                    }
                } else {
                    App.State.SESSION_TOKEN = '';
                    App.State.CURRENT_OFFICE_ID = '';
                    App.State.CURRENT_ROLE = '';
                    this.updateAuthUI();
                    resolve(false);
                }
            });
        });
    },

    async login(officeInput, passwordInput) {
        try {
            if (typeof App.initFirebase === 'function') {
                App.initFirebase();
            }
            if (typeof firebase === 'undefined' || !(firebase.apps && firebase.apps.length)) {
                throw new Error("Firebaseの初期化に失敗しました。");
            }

            // Worker Auth
            const formData = new URLSearchParams();
            formData.append('action', 'login');
            formData.append('office', officeInput);
            formData.append('password', passwordInput);

            const resp = await fetch(App.Config.REMOTE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });

            const result = await resp.json();

            if (!result.ok) {
                throw new Error("認証に失敗しました。");
            }

            localStorage.setItem('presence_office', result.office);
            localStorage.setItem('presence_role', result.role);
            localStorage.setItem('presence_office_name', result.officeName || result.office);

            await firebase.auth().signInAnonymously();

            App.State.SESSION_TOKEN = 'firebase_session';
            App.State.CURRENT_OFFICE_ID = result.office;
            App.State.CURRENT_ROLE = result.role;

            App.UI.showToast(`ログインしました: ${result.officeName}`);
            this.updateAuthUI();

            return true;

        } catch (error) {
            console.error("Login error:", error);
            App.UI.showToast(error.message, true);
            return false;
        }
    },

    async logout() {
        try {
            if (typeof firebase !== 'undefined') {
                await firebase.auth().signOut();
            }
            localStorage.removeItem('presence_office');
            localStorage.removeItem('presence_role');
            App.UI.showToast("ログオフしました");
            setTimeout(() => location.reload(), 500);
        } catch (e) {
            console.error(e);
        }
    },

    updateAuthUI() {
        const loginEl = document.getElementById('login-screen'); // Ensure ID exists in HTML
        const board = App.UI.DOM.board;

        if (App.State.SESSION_TOKEN) {
            if (loginEl) loginEl.style.display = 'none';
            if (board) board.style.display = 'block';
            this.ensureAuthUI();
        } else {
            if (loginEl) loginEl.style.display = 'flex';
            if (board) board.style.display = 'none';
            this.ensureAuthUI();
        }
    },

    ensureAuthUI() {
        const loggedIn = !!App.State.SESSION_TOKEN;
        const isAdmin = loggedIn && (App.State.CURRENT_ROLE === 'admin' || App.State.CURRENT_ROLE === 'superAdmin');

        const setDisp = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'inline-block' : 'none';
        }

        setDisp('noticesBtn', false); // Managed by Notices module
        setDisp('adminBtn', isAdmin);
        setDisp('logoutBtn', loggedIn);
        setDisp('toolsBtn', loggedIn);
        setDisp('manualBtn', loggedIn);

        // Filters
        setDisp('nameFilter', loggedIn);
        setDisp('statusFilter', loggedIn);
    }
};
