/**
 * Bootstrap
 * Initializes the application.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Bootstrap: DOMContentLoaded");

    // Initialize UI references (if Logic needs them early)
    // App.Logic might need 'board' element which is in globals.js

    // Initialize App
    // This will setup listeners, check auth, etc.
    await App.init();

    console.log("Bootstrap: App initialized");
});
