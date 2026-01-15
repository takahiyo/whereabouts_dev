/**
 * App Sync Legacy
 * Synchronizes App.State changes to legacy global variables.
 */
(function () {
    if (!App || !App.State) return;

    // Export Config Constants to Global Scope
    window.REMOTE_ENDPOINT = App.Config.REMOTE_ENDPOINT;
    window.REMOTE_POLL_MS = App.Config.REMOTE_POLL_MS;
    window.CONFIG_POLL_MS = App.Config.CONFIG_POLL_MS;
    window.TOKEN_DEFAULT_TTL = App.Config.TOKEN_DEFAULT_TTL;
    window.PUBLIC_OFFICE_FALLBACKS = App.Config.PUBLIC_OFFICE_FALLBACKS;
    window.firebaseConfig = App.Config.Firebase;
    window.initFirebase = App.initFirebase;

    // Wrap App.State in a Proxy to update globals
    // We assume App.State is an object.

    // We need to keep the original values
    const originalState = App.State;

    App.State = new Proxy(originalState, {
        set: function (obj, prop, value) {
            obj[prop] = value;

            // Sync to globals
            if (prop === 'SESSION_TOKEN') {
                try { window.SESSION_TOKEN = value; } catch (e) { }
            }
            if (prop === 'CURRENT_OFFICE_ID') {
                try { window.CURRENT_OFFICE_ID = value; } catch (e) { }
            }
            if (prop === 'CURRENT_ROLE') {
                try { window.CURRENT_ROLE = value; } catch (e) { }
            }
            if (prop === 'CURRENT_OFFICE_NAME') {
                try { window.CURRENT_OFFICE_NAME = value; } catch (e) { }
            }
            if (prop === 'CURRENT_NOTICES') {
                try { window.CURRENT_NOTICES = value; } catch (e) { }
            }

            return true;
        },
        get: function (obj, prop) {
            return obj[prop];
        }
    });

    console.log("App.State changes will now sync to legacy globals.");
})();
