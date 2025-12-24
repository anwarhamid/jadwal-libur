// Firebase configuration and initialization (moved from index.html/app.js)
// Keep this file outside version control or replace values with env placeholders for production.
const firebaseConfig = {
    apiKey: "AIzaSyAlzi3Egf-L9Fz0tE-YZLDDtAEWs97cAW4",
    authDomain: "jadwal-libur-f38db.firebaseapp.com",
    databaseURL: "https://jadwal-libur-f38db-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "jadwal-libur-f38db",
    storageBucket: "jadwal-libur-f38db.firebasestorage.app",
    messagingSenderId: "123733774698",
    appId: "1:123733774698:web:e3bf19d569d8831d7fd513",
    measurementId: "G-H3W268K4HG"
};

firebase.initializeApp(firebaseConfig);
// Expose the database instance on `window` to avoid duplicate declarations
window.db = firebase.database();

// Optional: export for module systems (not used in this plain script setup)
// export { firebaseConfig, db };
