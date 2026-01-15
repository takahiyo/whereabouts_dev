/**
 * App Core Structure
 * Implements Single Source of Truth and Namespace separation.
 */
const App = {
  // Application Configuration (Immutable settings)
  Config: {
    REMOTE_ENDPOINT: "https://presence-proxy-test.taka-hiyo.workers.dev",
    REMOTE_POLL_MS: 10000,
    CONFIG_POLL_MS: 30000,
    TOKEN_DEFAULT_TTL: 3600000,
    
    // Firebase Config
    Firebase: {
      apiKey: "AIzaSyDRTr7h0diRJW6U1dQJaJgr303A5wm3aTE",
      authDomain: "whereabouts-438df.firebaseapp.com",
      projectId: "whereabouts-438df",
      storageBucket: "whereabouts-438df.firebasestorage.app",
      messagingSenderId: "955108979418",
      appId: "1:955108979418:web:31a7235eeec873018dabe3",
      measurementId: "G-26G0TS4HDW"
    },

    // Public Office Fallbacks
    PUBLIC_OFFICE_FALLBACKS: []
  },

  // Application State (Mutable runtime data)
  State: {
    GROUPS: [],
    CONFIG_UPDATED: 0,
    MENUS: null,
    STATUSES: [],
    requiresTimeSet: new Set(),
    clearOnSet: new Set(),
    statusClassMap: new Map(),
    
    // Auth & Session
    SESSION_TOKEN: "",
    CURRENT_OFFICE_NAME: "",
    CURRENT_OFFICE_ID: "",
    CURRENT_ROLE: "user",
    
    // Timers
    Timers: {
      tokenRenew: null,
      remotePull: null,
      configWatch: null,
      eventSync: null
    },
    
    // UI State
    resumeRemoteSyncOnVisible: false,
    resumeConfigWatchOnVisible: false,
    resumeEventSyncOnVisible: false,
    
    // Pending updates
    PENDING_ROWS: new Set(),
    
    // Event/Vacation State
    Events: {
      currentIds: [],
      currentOfficeId: '',
      cached: { officeId:'', list:[] },
      appliedIds: [],
      appliedOfficeId: '',
      appliedTitles: [],
      selectedId: '',
      selectedIds: [],
      dateColorState: { 
        officeId:'', 
        map: new Map(), 
        lastSaved: new Map(), 
        autoSaveTimer: null, 
        saveInFlight: false, 
        queued: false, 
        statusEl: null, 
        loaded: false 
      }
    }
  },

  // UI Components & References
  UI: {
    // Will be populated on init
    Elements: {}
  },

  // Data Logic
  Data: {}
};

// Initialize Firebase helper (moved from config.js)
App.initFirebase = function() {
  if (typeof firebase === 'undefined') {
    console.error("Firebase SDK not loaded.");
    return false;
  }
  if (firebase.apps && firebase.apps.length > 0) return true;
  
  firebase.initializeApp(App.Config.Firebase);
  return true;
};

// Helper for waiting firebase load
if (!App.initFirebase()) {
  window.addEventListener('load', () => { App.initFirebase(); }, { once: true });
}
