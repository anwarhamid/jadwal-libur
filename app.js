// Firebase is initialized in `firebase-config.js` and `db` is exposed on `window.db`.
// We keep a safe fallback to firebase.database() in case the config file wasn't loaded.
const db = window.db || (typeof firebase !== 'undefined' ? firebase.database() : null);

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Tambahkan data libur nasional 2026
const nationalHolidays = {
    "2026-01-01": "New Year's Day",
    "2026-01-16": "Ascension of the Prophet Muhammad",
    "2026-02-17": "Chinese New Year's Day",
    "2026-03-19": "Nyepi (Hindu New Year)",
    "2026-03-20": "Idul Fitri Day 1",
    "2026-03-21": "Idul Fitri Day 2",
    "2026-04-03": "Good Friday",
    "2026-04-05": "Easter Sunday",
    "2026-05-01": "International Labor Day",
    "2026-05-14": "Ascension Day of Jesus Christ",
    "2026-05-27": "Idul Adha",
    "2026-05-31": "Waisak Day",
    "2026-06-01": "Pancasila Day",
    "2026-06-16": "Islamic New Year",
    "2026-08-17": "Indonesian Independence Day",
    "2026-08-25": "Maulid Nabi Muhammad",
    "2026-12-25": "Christmas Day"
};
// Default users; can be extended at runtime via settings
let users = ["rizky", "farhan", "krisna", "putri", "siliya", "taufiq", "aprilia"];
// Map name -> color (hex). Pre-seeded to match existing CSS variables/colors
let userColors = {
    rizky: getComputedStyle(document.documentElement).getPropertyValue('--rizky').trim() || '#99727c',
    farhan: getComputedStyle(document.documentElement).getPropertyValue('--farhan').trim() || '#ffc0cb',
    krisna: getComputedStyle(document.documentElement).getPropertyValue('--krisna').trim() || '#eab308',
    putri: getComputedStyle(document.documentElement).getPropertyValue('--putri').trim() || '#f19d60',
    siliya: getComputedStyle(document.documentElement).getPropertyValue('--siliya').trim() || '#70cada',
    taufiq: getComputedStyle(document.documentElement).getPropertyValue('--taufiq').trim() || '#82f160',
    aprilia: getComputedStyle(document.documentElement).getPropertyValue('--aprilia').trim() || '#a270da'
};
let selectedUser = "";
let allData = {};
// Map that holds display labels for users (e.g., 'anwar' -> 'ANWAR')
let userDataLabelMap = {};

const YEAR = 2026;
const MAX_PER_MONTH = 5;
const VALID_USERS = new Set([...users, 'none']);
let firebaseConnected = false;

// --- Logging helpers (defined early so calls from init won't ReferenceError) ---
let localLogs = [];

function loadLogs() {
    try {
        const raw = localStorage.getItem('jadwal_logs');
        if (raw) localLogs = JSON.parse(raw) || [];
    } catch (e) { localLogs = []; }
}

// Toast helper (non-blocking notifications)
function showToast(message, type = 'info', duration = 4000) {
    try {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const t = document.createElement('div'); t.className = `toast ${type}`;
        const msg = document.createElement('div'); msg.className = 'tmsg'; msg.innerText = message;
        const close = document.createElement('button'); close.className = 'tclose'; close.innerText = '×';
        close.onclick = () => { try { t.remove(); } catch(e){} };
        t.appendChild(msg); t.appendChild(close);
        container.appendChild(t);
        setTimeout(() => { try { t.remove(); } catch(e){} }, duration);
    } catch (e) { console.warn('showToast failed', e); }
}

// Retry helper for pending logs
function retryPendingLog(logEntry) {
    if (!logEntry) return;
    showToast('Mencoba mengirim ulang log...', 'info');
    // Attempt to push to Firebase
    writeFirebasePush('audit/logs', logEntry).then(() => {
        // find and clear pending flag in localLogs
        try {
            const idx = localLogs.findIndex(l => l.ts === logEntry.ts && l.action === logEntry.action && (l.subject||'') === (logEntry.subject||''));
            if (idx !== -1) {
                delete localLogs[idx].pending;
                localStorage.setItem('jadwal_logs', JSON.stringify(localLogs));
            }
        } catch (e) { console.warn('retryPendingLog update failed', e); }
        showToast('Log berhasil dikirim ke server', 'success');
        try { renderLogs(); } catch(e){}
    }).catch(err => {
        console.warn('retryPendingLog failed', err);
        showToast('Gagal mengirim log. Coba lagi nanti.', 'error');
    });
}

function renderLogs(limit=50) {
    const container = document.getElementById('logs-container');
    if (!container) return;
    container.innerHTML = '';
    // apply filters
    const userFilterEl = document.getElementById('log-filter-user');
    const typeFilterEl = document.getElementById('log-filter-type');
    const timeFilterEl = document.getElementById('log-filter-time');
    const startEl = document.getElementById('log-filter-start');
    const endEl = document.getElementById('log-filter-end');
    const userFilter = userFilterEl ? userFilterEl.value : '';
    const typeFilter = typeFilterEl ? typeFilterEl.value : '';
    const timeFilter = timeFilterEl ? timeFilterEl.value : '';
    const listRaw = (localLogs || []);
    let filtered = listRaw;
    if (userFilter) filtered = filtered.filter(l => (l.subject || '').toLowerCase() === userFilter.toLowerCase());
    if (typeFilter) filtered = filtered.filter(l => l.action === typeFilter);

    // Time filtering
    if (timeFilter) {
        let startTs = null, endTs = null;
        const now = Date.now();
        if (timeFilter === 'today') {
            const d = new Date(); d.setHours(0,0,0,0); startTs = d.getTime(); endTs = now;
        } else if (timeFilter === 'last7') {
            startTs = now - (7 * 24 * 60 * 60 * 1000);
            endTs = now;
        } else if (timeFilter === 'last30') {
            startTs = now - (30 * 24 * 60 * 60 * 1000);
            endTs = now;
        } else if (timeFilter === 'custom') {
            try {
                if (startEl && startEl.value) {
                    const s = new Date(startEl.value); s.setHours(0,0,0,0); startTs = s.getTime();
                }
                if (endEl && endEl.value) {
                    const e = new Date(endEl.value); e.setHours(23,59,59,999); endTs = e.getTime();
                }
            } catch (e) { /* ignore parse errors */ }
        }
        if (startTs || endTs) {
            filtered = filtered.filter(l => {
                if (!l.ts) return false;
                if (startTs && l.ts < startTs) return false;
                if (endTs && l.ts > endTs) return false;
                return true;
            });
        }
    }

    const list = filtered.slice(0, limit);
    list.forEach(l => {
        const item = document.createElement('div'); item.className = 'log-item';
        const left = document.createElement('div'); left.className = 'left';
        const t = document.createElement('div'); t.className = 'time'; t.innerText = new Date(l.ts).toLocaleString();
        const msg = document.createElement('div'); msg.className = 'msg';
        let human = '';
        if (l.action === 'set') human = `${(l.subject||'').toUpperCase()} ditambahkan pada ${l.date}`;
        else if (l.action === 'remove') human = `Penghapusan libur pada ${l.date}`;
        else if (l.action === 'user:add') human = `Tambah user ${(l.subject||'').toUpperCase()}`;
        else if (l.action === 'user:edit') human = `Edit user ${(l.subject||'').toUpperCase()}`;
        else if (l.action === 'user:delete') human = `Hapus user ${(l.subject||'').toUpperCase()}`;
        else human = `${l.action} ${l.subject || ''} ${l.date || ''}`;
        msg.innerText = human;
        left.appendChild(t); left.appendChild(msg);
        const right = document.createElement('div');
        const badge = document.createElement('div'); badge.className = 'action'; badge.innerText = l.pending ? 'PENDING' : (l.action || 'LOG');
        right.appendChild(badge);
        // If entry is pending, add a Retry button
        if (l.pending) {
            const retry = document.createElement('button'); retry.className = 'btn-retry'; retry.innerText = 'Coba Ulang';
            retry.onclick = (ev) => { ev.stopPropagation(); try { retryPendingLog(l); } catch(e) { console.warn(e); } };
            right.appendChild(retry);
        }
        item.appendChild(left); item.appendChild(right);
        container.appendChild(item);
    });
}

function writeFirebasePush(path, value) {
    if (!db) return Promise.reject(new Error('no-db'));
    return db.ref(path).push(value).catch(err => { console.warn('Firebase push error', err); return Promise.reject(err); });
}

function addLogEntry(dateId, action, subject, meta) {
    const entry = { ts: Date.now(), date: dateId || null, action: action, subject: subject || null, meta: meta || {}, source: 'client' };
    try {
        localLogs.unshift(entry);
        if (localLogs.length > 500) localLogs = localLogs.slice(0,500);
        localStorage.setItem('jadwal_logs', JSON.stringify(localLogs));
    } catch (e) { console.warn('addLogEntry local save failed', e); }
    if (db) {
        writeFirebasePush('audit/logs', entry).catch(() => { try { localLogs[0].pending = true; localStorage.setItem('jadwal_logs', JSON.stringify(localLogs)); } catch(e){} });
    }
    try { renderLogs(); } catch(e){}
}

// Monitor Realtime Database connection status ('.info/connected')
function monitorFirebaseConnection() {
    if (!db) return;
    try {
        const connRef = db.ref('.info/connected');
        connRef.on('value', snap => {
            firebaseConnected = !!snap.val();
            console.log('Firebase connection state:', firebaseConnected);
            // update small UI indicator if present
            try {
                const el = document.getElementById('firebase-status');
                if (el) {
                    el.classList.toggle('online', firebaseConnected);
                    el.classList.toggle('offline', !firebaseConnected);
                    el.title = firebaseConnected ? 'Firebase: connected' : 'Firebase: disconnected';
                }
            } catch (e) { /* ignore DOM timing issues */ }
        });
    } catch (e) {
        console.warn('monitorFirebaseConnection error', e);
    }
}

// Helper wrappers for firebase writes that provide user-facing alerts on failure
function writeFirebaseSet(path, value) {
    if (!db) {
        showToast('Tidak terhubung ke Firebase. Perubahan hanya akan tersimpan secara lokal.', 'warning');
        return Promise.reject(new Error('no-db'));
    }
    return db.ref(path).set(value).catch(err => {
        console.warn('Firebase set error', err);
        showToast('Gagal menyimpan ke Firebase: ' + (err && err.message ? err.message : err), 'error');
        return Promise.reject(err);
    });
}

function writeFirebaseRemove(path) {
    if (!db) {
        showToast('Tidak terhubung ke Firebase. Perubahan hanya akan tersimpan secara lokal.', 'warning');
        return Promise.reject(new Error('no-db'));
    }
    return db.ref(path).remove().catch(err => {
        console.warn('Firebase remove error', err);
        showToast('Gagal menghapus di Firebase: ' + (err && err.message ? err.message : err), 'error');
        return Promise.reject(err);
    });
}

function renderCalendar() {
    const container = document.getElementById('calendar-container');
    console.log('renderCalendar() called, db available:', !!db);
    container.innerHTML = '';
    for (let m = 0; m < 12; m++) {
        const box = document.createElement('div');
        box.className = 'month-box';
        box.innerHTML = `<div class="month-title">${months[m]} 2026</div>`;
        const daysDiv = document.createElement('div');
        daysDiv.className = 'days';
        ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].forEach(d => daysDiv.innerHTML += `<div class="day-lbl">${d}</div>`);
        const firstDay = new Date(2026, m, 1).getDay();
        const totalDays = new Date(2026, m + 1, 0).getDate();
        for (let i = 0; i < firstDay; i++) daysDiv.innerHTML += `<div class="day empty"></div>`;
        for (let d = 1; d <= totalDays; d++) {
            const dateId = `2026-${String(m+1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayEl = document.createElement('div');
            dayEl.className = 'day';
            
            const userData = allData[dateId];
            const holidayName = nationalHolidays[dateId]; 

                    // A. Atur Background jika dipilih karyawan
                    if (userData) {
                        // If a CSS class for bg-user exists, add it; otherwise apply inline color from userColors
                        const cssClassName = `bg-${userData}`;
                        if (document.querySelector(`.${cssClassName}`) !== null) {
                            dayEl.classList.add(cssClassName);
                        } else if (userColors[userData]) {
                            dayEl.style.background = userColors[userData];
                            // ensure contrast for text
                            dayEl.style.color = '#fff';
                        }
                    }

            // B. Atur Warna Angka jika Libur Nasional
            if (holidayName) {
                dayEl.style.color = "red";
                dayEl.style.fontWeight = "bold";
                dayEl.title = holidayName; 
            }

            // C. Tampilkan keduanya secara bertumpuk (Stacked)
            // Kita buat dua span terpisah agar tidak saling tindih
            // Tampilkan Angka Tanggal (Merah jika libur) dan Label secara terpisah
                    dayEl.innerHTML = `
                <span class="date-num" style="${holidayName ? 'color: red; font-weight: bold;' : ''}">${d}</span>
                <div class="label-container">
                            ${holidayName ? `<span class="holiday-label">${holidayName}</span>` : ''}
                            ${userData ? `<span class="user-label">${(userDataLabelMap && userDataLabelMap[ userData ]) ? userDataLabelMap[userData] : userData.toUpperCase()}</span>` : ''}
                </div>
            `;
            
            dayEl.onclick = () => {
                // 1. LOGIKA HAPUS (HARUS DI PALING ATAS)
                // Jika user memilih 'Hapus Warna' (none), izinkan tanpa cek kuota
                if (selectedUser === 'none') {
                    if (allData[dateId]) { 
                        const yakinHapus = confirm(`Apakah anda tidak jadi libur di tanggal ${d} ${months[m]} 2026?`);
                        if (yakinHapus) {
                            writeFirebaseRemove('holidays/' + dateId)
                                .then(() => { addLogEntry(dateId, 'remove', null); })
                                .catch(() => {
                                    if (allData[dateId]) delete allData[dateId];
                                    renderCalendar();
                                    updateDashboard();
                                    addLogEntry(dateId, 'remove', null, {pending:true});
                                });
                        }
                    }
                    return; // Keluar dari fungsi setelah hapus
                }

                // 2. CEK APAKAH TANGGAL SUDAH DIISI ORANG LAIN
                // Mencegah karyawan menimpa jadwal temannya tanpa sengaja
                if (allData[dateId] && allData[dateId] !== selectedUser) {
                    showToast(`Tanggal ini sudah diambil oleh ${allData[dateId].toUpperCase()}. Gunakan 'Hapus Warna' terlebih dahulu jika ingin mengganti.`, 'warning');
                    return;
                }

                // 3. HITUNG KUOTA BULANAN
                let count = 0;
                const currentMonthPrefix = `2026-${String(m + 1).padStart(2, '0')}`;
                
                Object.keys(allData).forEach(date => {
                    if (date.startsWith(currentMonthPrefix) && allData[date] === selectedUser) {
                        count++;
                    }
                });

                // 4. VALIDASI MAKSIMAL 4 HARI
                // Jika sudah 4 hari DAN tanggal yang diklik belum ada namanya, maka blokir
                if (count >= 5 && allData[dateId] !== selectedUser) {
                    showToast(`Karyawan ${selectedUser.toUpperCase()} sudah mencapai maksimal libur (5 hari) di bulan ${months[m]}!`, 'warning');
                    return;
                }

                // 5. KONFIRMASI SIMPAN
                const yakinLibur = confirm(`Apakah anda libur pada tanggal ${d} ${months[m]} 2026?`);
                if (yakinLibur) {
                                writeFirebaseSet('holidays/' + dateId, selectedUser)
                                    .then(() => {
                                        // success
                                        addLogEntry(dateId, 'set', selectedUser);
                                    })
                                    .catch(() => {
                                        allData[dateId] = selectedUser;
                                        renderCalendar();
                                        updateDashboard();
                                        addLogEntry(dateId, 'set', selectedUser, {pending:true});
                                    });
                }
            };
            
            daysDiv.appendChild(dayEl);
        }
        box.appendChild(daysDiv);
        container.appendChild(box);
    }

    // If nothing was appended (unexpected), show fallback message for debugging
    if (!container.hasChildNodes()) {
        const msg = document.createElement('div');
        msg.style.padding = '40px';
        msg.style.textAlign = 'center';
        msg.style.color = '#64748b';
        msg.style.background = '#fff';
        msg.style.borderRadius = '12px';
        msg.style.border = '1px solid #e2e8f0';
        msg.innerText = 'Kalender tidak tersedia — buka Console (F12) untuk melihat error.';
        container.appendChild(msg);
        console.warn('renderCalendar: no month boxes rendered');
    }
}

// Ensure initial view visibility matches `.view.active` classes
function ensureInitialView() {
    const views = document.querySelectorAll('.view');
    let anyActive = false;
    views.forEach(v => {
        if (v.classList.contains('active')) {
            v.style.display = 'block';
            anyActive = true;
        } else {
            v.style.display = 'none';
        }
    });
    if (!anyActive) {
        const cv = document.getElementById('control-view');
        if (cv) {
            cv.classList.add('active');
            cv.style.display = 'block';
        }
    }

    // Sync nav-item active state with views
    const control = document.getElementById('nav-control');
    const dashboard = document.getElementById('nav-dashboard');
    if (document.getElementById('control-view').classList.contains('active')) {
        if (control) control.classList.add('active');
        if (dashboard) dashboard.classList.remove('active');
    } else if (document.getElementById('dashboard-view').classList.contains('active')) {
        if (dashboard) dashboard.classList.add('active');
        if (control) control.classList.remove('active');
    }
}

// Render employee option buttons dynamically (initial + added users)
function renderUserOptions() {
    const container = document.querySelector('.options-container');
    if (!container) return;
    // Remove existing dynamic .opt but keep the static 'Hapus' (btn-delete) if present
    container.querySelectorAll('.opt').forEach(el => {
        if (!el.classList.contains('btn-delete')) el.remove();
    });

    users.forEach(u => {
        const el = document.createElement('div');
        el.className = 'opt';
        el.dataset.user = u;
        const dot = document.createElement('span');
        dot.className = 'dot';
        // If we have a CSS variable for the user, use it; otherwise set background via style
        const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--${u}`).trim();
        if (cssVar) {
            dot.style.background = cssVar;
        } else if (userColors[u]) {
            dot.style.background = userColors[u];
        }
        el.appendChild(dot);
        const label = document.createTextNode(' ' + (userDataLabelMap[u] || u.toUpperCase()));
        el.appendChild(label);
        // Insert before the delete button if exists
        const deleteBtn = container.querySelector('.btn-delete');
        if (deleteBtn) container.insertBefore(el, deleteBtn);
        else container.appendChild(el);
    });

    // Reattach handlers: for normal opts and for the delete button
    container.querySelectorAll('.opt').forEach(opt => {
        if (opt.classList.contains('btn-delete')) {
            opt.onclick = function() {
                document.querySelectorAll('.opt').forEach(o => o.classList.remove('active'));
                this.classList.add('active');
                selectedUser = this.dataset.user; // should be 'none'
            };
        } else {
            opt.onclick = function() {
                document.querySelectorAll('.opt').forEach(o => o.classList.remove('active'));
                this.classList.add('active');
                selectedUser = this.dataset.user;
            };
        }
    });
}

// Contrast utilities (WCAG) — return contrast ratio and recommended text color
function hexToRgb(hex) {
    const h = hex.replace('#','');
    const bigint = parseInt(h.length===3? h.split('').map(c=>c+c).join(''): h,16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}
function luminance(r,g,b) {
    const a = [r,g,b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
    });
    return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
}
function contrastRatio(hex1, hex2) {
    const c1 = hexToRgb(hex1); const c2 = hexToRgb(hex2);
    const L1 = luminance(c1.r,c1.g,c1.b); const L2 = luminance(c2.r,c2.g,c2.b);
    const light = Math.max(L1,L2); const dark = Math.min(L1,L2);
    return (light + 0.05) / (dark + 0.05);
}
function recommendedTextColor(bgHex) {
    const whiteRatio = contrastRatio(bgHex,'#ffffff');
    const blackRatio = contrastRatio(bgHex,'#000000');
    return whiteRatio >= blackRatio ? '#ffffff' : '#000000';
}

// Render the user list in settings panel (with edit/delete buttons)
function renderUserList() {
    const list = document.getElementById('user-list');
    if (!list) return;
    list.innerHTML = '';
    users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'user-item';
        const left = document.createElement('div'); left.className = 'left';
        const dot = document.createElement('span'); dot.className = 'dot';
        dot.style.background = userColors[u] || '#777';
        left.appendChild(dot);
        const txt = document.createElement('div'); txt.innerText = `${userDataLabelMap[u] || u.toUpperCase()} (${u})`; left.appendChild(txt);
        item.appendChild(left);

        const actions = document.createElement('div'); actions.className = 'actions';
        const editBtn = document.createElement('button'); editBtn.className = 'edit'; editBtn.innerText = 'Edit';
        const delBtn = document.createElement('button'); delBtn.className = 'del'; delBtn.innerText = 'Hapus';
        actions.appendChild(editBtn); actions.appendChild(delBtn);
        item.appendChild(actions);

        // edit handler
        editBtn.onclick = () => {
            const nameEl = document.getElementById('new-user-name');
            const labelEl = document.getElementById('new-user-label');
            const colorEl = document.getElementById('new-user-color');
            if (nameEl) nameEl.value = u;
            if (labelEl) labelEl.value = (userDataLabelMap[u] || u.toUpperCase());
            if (colorEl) colorEl.value = (userColors[u] || '#777');
            // toggle buttons
            const addBtn = document.getElementById('add-user-btn');
            const cancelBtn = document.getElementById('cancel-edit-btn');
            addBtn.innerText = 'Simpan'; addBtn.dataset.editing = u;
            if (cancelBtn) cancelBtn.style.display = 'inline-block';
        };

        delBtn.onclick = () => {
            if (confirm(`Hapus user ${u}?`)) {
                deleteUser(u);
            }
        };

        list.appendChild(item);
    });
}

// Load saved users/colors/labels from localStorage
function loadSavedUsers() {
    try {
        // Prefer Firebase if available
        if (db) {
            db.ref('settings/users').once('value').then(snapshot => {
                const val = snapshot.val();
                if (val) {
                            // Expect val to be object mapping userKey -> { label, color }
                            const snapshotKeys = Object.keys(val);
                            const colors = {};
                            const labels = {};
                            // Try to preserve any locally-saved edits (localStorage) so failed firebase writes
                            // don't immediately overwrite the user's local changes.
                            let local = null;
                            try { local = JSON.parse(localStorage.getItem('jadwal_users')); } catch (e) { local = null; }
                            // Build merged users: union of snapshot keys and local keys (local-only appended)
                            const mergedUsers = [];
                            snapshotKeys.forEach(k => mergedUsers.push(k));
                            if (local && Array.isArray(local.users)) {
                                local.users.forEach(k => {
                                    if (!mergedUsers.includes(k)) mergedUsers.push(k);
                                });
                            }
                            // For each key prefer local color/label if present (so local edits survive until firebase agrees)
                            mergedUsers.forEach(k => {
                                const entry = val[k] || {};
                                const localColor = (local && local.colors && local.colors[k]) ? local.colors[k] : null;
                                const localLabel = (local && local.labels && local.labels[k]) ? local.labels[k] : null;
                                colors[k] = localColor || entry.color || (userColors[k] || '#777');
                                labels[k] = localLabel || entry.label || k.toUpperCase();
                            });
                            users = mergedUsers;
                            userColors = Object.assign({}, userColors, colors);
                            userDataLabelMap = Object.assign({}, userDataLabelMap, labels);
                            // Persist merged result locally so we remain stable
                            saveUsersToStorage();
                            renderUserOptions();
                            renderUserList();
                        }
            }).catch(e => console.warn('loadSavedUsers firebase read failed', e));
        }
        // Always merge localStorage as fallback / offline edits
        const raw = localStorage.getItem('jadwal_users');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.users && Array.isArray(parsed.users)) users = parsed.users;
            if (parsed.colors) userColors = Object.assign({}, userColors, parsed.colors);
            if (parsed.labels) userDataLabelMap = Object.assign({}, userDataLabelMap, parsed.labels);
        }
    } catch (e) { console.warn('loadSavedUsers error', e); }
}

// Save users/colors/labels to localStorage
function saveUsersToStorage() {
    try {
        localStorage.setItem('jadwal_users', JSON.stringify({ users, colors: userColors, labels: userDataLabelMap }));
        // Also persist to Firebase for cross-client sync
        if (db) {
            // convert arrays/maps to object mapping
            const obj = {};
            users.forEach(u => {
                obj[u] = { label: userDataLabelMap[u] || u.toUpperCase(), color: userColors[u] || '#777' };
            });
            writeFirebaseSet('settings/users', obj).catch(e => console.warn('saveUsersToFirebase failed', e));
        }
    } catch (e) { console.warn('saveUsersToStorage error', e); }
}

// Add a new user (name: id string, label: display, color: hex)
function addUser(name, label, color) {
    if (!name) return { ok:false, msg: 'Nama user diperlukan' };
    // stricter validation: only letters, numbers, dash/underscore allowed; length 2-24
    const key = name.toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9_-]{2,24}$/.test(key)) return { ok:false, msg: 'Nama hanya huruf/angka/-/_ (2-24 karakter)' };
    if (users.includes(key)) return { ok:false, msg: 'User sudah ada' };
    users.push(key);
    userColors[key] = color || '#777';
    userDataLabelMap[key] = label || key.toUpperCase();
    saveUsersToStorage();
    renderUserOptions();
    renderUserList();
    renderCalendar();
    addLogEntry(null, 'user:add', key);
    return { ok:true };
}

// Edit existing user
function editUser(oldKey, name, label, color) {
    if (!oldKey) return { ok:false, msg: 'User tidak ditemukan' };
    const newKey = name.toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9_-]{2,24}$/.test(newKey)) return { ok:false, msg: 'Nama hanya huruf/angka/-/_ (2-24 karakter)' };
    // if key changed and conflicts
    if (newKey !== oldKey && users.includes(newKey)) return { ok:false, msg: 'Nama baru sudah ada' };
    // update arrays/maps
    const idx = users.indexOf(oldKey);
    if (idx === -1) return { ok:false, msg: 'User tidak ditemukan' };
    users[idx] = newKey;
    // move color and label
    userColors[newKey] = color || userColors[oldKey] || '#777';
    userDataLabelMap[newKey] = label || userDataLabelMap[oldKey] || newKey.toUpperCase();
    if (newKey !== oldKey) {
        delete userColors[oldKey];
        delete userDataLabelMap[oldKey];
        // Move any assigned holidays in allData from oldKey to newKey
        Object.keys(allData).forEach(date => {
            if (allData[date] === oldKey) allData[date] = newKey;
        });
    }
    saveUsersToStorage();
    renderUserOptions();
    renderUserList();
    renderCalendar();
    addLogEntry(null, 'user:edit', newKey, {oldKey: oldKey});
    return { ok:true };
}

// Delete user
function deleteUser(key) {
    const idx = users.indexOf(key);
    if (idx === -1) return { ok:false, msg: 'User tidak ditemukan' };
    // remove from arrays/maps
    users.splice(idx, 1);
    delete userColors[key];
    delete userDataLabelMap[key];
    // clear assignments in allData
    Object.keys(allData).forEach(date => {
        if (allData[date] === key) delete allData[date];
    });
    saveUsersToStorage();
    renderUserOptions();
    renderUserList();
    renderCalendar();
    addLogEntry(null, 'user:delete', key);
    return { ok:true };
}

function updateDashboard() {
    const monthVal = document.getElementById('filter-month').value;
    const container = document.getElementById('stats-container');
    container.innerHTML = '';
    const counts = {};
    users.forEach(u => counts[u] = 0);
    Object.keys(allData).forEach(date => {
        if (date.startsWith(`2026-${monthVal}`)) {
            const user = allData[date];
            if (counts[user] !== undefined) counts[user]++;
        }
    });
    users.forEach(u => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.style.borderLeftColor = `var(--${u})`;
        card.innerHTML = `<h4>${u.toUpperCase()}</h4><div class="count">${counts[u]}</div><small style="color:#94a3b8">HARI LIBUR</small>`;
        container.appendChild(card);
    });
}

function init() {
    // Ensure initial view visibility in case CSS classes and inline styles mismatch
    ensureInitialView();
    // Load saved users (from previous sessions)
    loadSavedUsers();
    // Start monitoring connection to Firebase (updates `firebaseConnected`)
    monitorFirebaseConnection();
    // Load and render local logs
    loadLogs();
    // populate user filter options
    try {
        const uf = document.getElementById('log-filter-user');
        if (uf) {
            uf.innerHTML = '<option value="">Semua Karyawan</option>';
            users.forEach(u => {
                const opt = document.createElement('option'); opt.value = u; opt.innerText = (userDataLabelMap[u] || u.toUpperCase()) + ` (${u})`;
                uf.appendChild(opt);
            });
            uf.onchange = () => renderLogs();
        }
        const tf = document.getElementById('log-filter-type'); if (tf) tf.onchange = () => renderLogs();

        // Time filter controls (new)
        const timeF = document.getElementById('log-filter-time');
        const startEl = document.getElementById('log-filter-start');
        const endEl = document.getElementById('log-filter-end');
        function hideDateInputs() {
            if (startEl) startEl.style.display = 'none';
            if (endEl) endEl.style.display = 'none';
        }
        function showDateInputs() {
            if (startEl) startEl.style.display = 'inline-block';
            if (endEl) endEl.style.display = 'inline-block';
        }
        if (timeF) {
            timeF.onchange = () => {
                if (timeF.value === 'custom') showDateInputs(); else hideDateInputs();
                renderLogs();
            };
        }
        if (startEl) startEl.onchange = () => renderLogs();
        if (endEl) endEl.onchange = () => renderLogs();
        // ensure date inputs hidden by default
        hideDateInputs();
    } catch(e){}
    renderLogs();
    // One-time check: if db exists but not connected yet, warn the user
    if (db) {
        try {
            db.ref('.info/connected').once('value').then(snap => {
                if (!snap.val()) {
                        console.warn('Firebase initial connection: not connected (will monitor for reconnect).');
                }
            }).catch(e => console.warn('Initial connection check failed', e));
        } catch (e) { console.warn('Initial connection check error', e); }
    }
    const filterMonth = document.getElementById('filter-month');
    months.forEach((m, idx) => {
        filterMonth.innerHTML += `<option value="${String(idx+1).padStart(2, '0')}">${m}</option>`;
    });
    filterMonth.value = String(new Date().getMonth() + 1).padStart(2, '0');

    document.querySelectorAll('.opt').forEach(opt => {
        opt.onclick = function() {
            document.querySelectorAll('.opt').forEach(o => o.classList.remove('active'));
            this.classList.add('active');
            selectedUser = this.dataset.user;
        };
    });
    // Render dynamic user options based on saved or default users
    renderUserOptions();
    // Render settings user list (if present in DOM)
    renderUserList();
    // Make site title clickable to open Penjadwalan (control view)
    try {
        const siteTitle = document.getElementById('site-title');
        if (siteTitle) {
            siteTitle.onclick = () => { switchView('control-view'); };
            siteTitle.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchView('control-view'); } };
        }
    } catch (e) { /* ignore */ }
    // Ensure calendar is rendered initially
    try { renderCalendar(); } catch(e) {}

    // Wire settings drawer toggle buttons.
    // Note: the settings drawer HTML is placed after the script tags in `index.html`.
    // To avoid timing issues we query the elements inside the show/hide functions
    // and use event delegation for close actions so handlers work regardless of parse order.
    const openBtn = document.getElementById('open-settings-btn');
    function showDrawer() {
        const overlayEl = document.getElementById('settings-overlay');
        const drawerEl = document.getElementById('settings-drawer');
        // Ensure latest user data is rendered when the drawer opens (DOM for #user-list exists now)
        try { renderUserOptions(); } catch (e) { /* ignore if not present yet */ }
        try { renderUserList(); } catch (e) { /* ignore if not present yet */ }
        if (overlayEl) overlayEl.style.display = 'block';
        if (drawerEl) drawerEl.setAttribute('aria-hidden','false');
    }
    function hideDrawer() {
        const overlayEl = document.getElementById('settings-overlay');
        const drawerEl = document.getElementById('settings-drawer');
        if (overlayEl) overlayEl.style.display = 'none';
        if (drawerEl) drawerEl.setAttribute('aria-hidden','true');
    }
    if (openBtn) openBtn.onclick = showDrawer;
    // Use event delegation so close button and overlay clicks work even if markup
    // was parsed after this script executed.
    document.addEventListener('click', (e) => {
        const id = e.target && e.target.id;
        if (id === 'close-settings-btn' || id === 'settings-overlay') {
            hideDrawer();
        }
    });
    // close on Escape
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDrawer(); });

    // Hook up add-user UI
    const addBtn = document.getElementById('add-user-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            const nameEl = document.getElementById('new-user-name');
            const labelEl = document.getElementById('new-user-label');
            const colorEl = document.getElementById('new-user-color');
            const name = nameEl ? nameEl.value.trim() : '';
            const label = labelEl ? labelEl.value.trim() : '';
            const color = colorEl ? colorEl.value : '#777';
            // If button in editing mode
            const editingKey = addBtn.dataset.editing;
            if (editingKey) {
                const res = editUser(editingKey, name, label, color);
                if (!res.ok) showToast(res.msg, 'error');
                else {
                    addBtn.innerText = 'Tambah'; delete addBtn.dataset.editing;
                    const cancelBtn = document.getElementById('cancel-edit-btn'); if (cancelBtn) cancelBtn.style.display = 'none';
                    if (nameEl) nameEl.value = ''; if (labelEl) labelEl.value = '';
                    renderUserList();
                }
            } else {
                // contrast validation: warn if chosen color has low contrast with recommended text
                const recommended = recommendedTextColor(color);
                const ratio = contrastRatio(color, recommended === '#ffffff' ? '#ffffff' : '#000000');
                if (ratio < 3) {
                    if (!confirm('Kontras warna rendah (kurang dari 3:1). Tetap lanjut?')) return;
                }
                const res = addUser(name, label, color);
                if (!res.ok) showToast(res.msg, 'error');
                else {
                    if (nameEl) nameEl.value = '';
                    if (labelEl) labelEl.value = '';
                    renderUserList();
                }
            }
        };
    }
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            const addBtn = document.getElementById('add-user-btn');
            if (addBtn) { addBtn.innerText = 'Tambah'; delete addBtn.dataset.editing; }
            cancelBtn.style.display = 'none';
            const nameEl = document.getElementById('new-user-name'); const labelEl = document.getElementById('new-user-label');
            if (nameEl) nameEl.value = ''; if (labelEl) labelEl.value = '';
        };
    }
    if (!db) {
        console.warn('Firebase `db` not available. Rendering calendar with local state only.');
        allData = {};
        renderCalendar();
        updateDashboard();
        return;
    }

    // Listen for remote audit logs and merge into local logs
    try {
        db.ref('audit/logs').limitToLast(200).on('value', (snap) => {
            const val = snap.val();
            if (!val) return;
            const remote = Object.values(val);
            // merge remote into localLogs without duplicates
            const map = {};
            localLogs.forEach(l => { const k = `${l.ts}|${l.action}|${l.subject}`; map[k]=l; });
            remote.forEach(r => { const k = `${r.ts}|${r.action}|${r.subject}`; if (!map[k]) map[k]=r; });
            // build array sorted by ts desc
            const merged = Object.values(map).sort((a,b)=>b.ts - a.ts).slice(0,500);
            localLogs = merged;
            try { localStorage.setItem('jadwal_logs', JSON.stringify(localLogs)); } catch(e){}
            renderLogs();
        });
    } catch(e){ console.warn('audit logs listener failed', e); }

    // Listen for holidays updates
    db.ref('holidays').on('value', (snapshot) => {
        allData = snapshot.val() || {};
        renderCalendar();
        updateDashboard();
    });

    // Listen for user settings updates and sync
    db.ref('settings/users').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            const loadedUsers = [];
            const colors = {};
            const labels = {};
            Object.keys(val).forEach(k => {
                loadedUsers.push(k);
                const entry = val[k] || {};
                colors[k] = entry.color || (userColors[k] || '#777');
                labels[k] = entry.label || k.toUpperCase();
            });
            users = loadedUsers;
            userColors = Object.assign({}, userColors, colors);
            userDataLabelMap = Object.assign({}, userDataLabelMap, labels);
            saveUsersToStorage(); // keep local copy in sync
            renderUserOptions();
            renderUserList();
            renderCalendar();
            // refresh log user filter options
            try {
                const uf = document.getElementById('log-filter-user');
                if (uf) {
                    const sel = uf.value || '';
                    uf.innerHTML = '<option value="">Semua Karyawan</option>';
                    users.forEach(u => {
                        const opt = document.createElement('option'); opt.value = u; opt.innerText = (userDataLabelMap[u] || u.toUpperCase()) + ` (${u})`;
                        uf.appendChild(opt);
                    });
                    uf.value = sel;
                }
            } catch(e){}
        }
    });
}
init();
// Fungsi untuk membuka/menutup dropdown
function toggleDropdown() {
    const dropdown = document.getElementById("myDropdown");
    dropdown.classList.toggle("show");
}

// Menutup dropdown jika user mengklik area lain di layar
window.onclick = function(event) {
    if (!event.target.matches('.dropbtn')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            let openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}

// Fungsi switchView yang sudah disempurnakan
function switchView(viewId) {
    // Sembunyikan semua tampilan
    document.getElementById('control-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'none';

    // Tampilkan tampilan yang dipilih
    const el = document.getElementById(viewId);
    if (el) el.style.display = 'block';

    // Update kelas active pada navigasi
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (viewId === 'control-view') {
        const nav = document.getElementById('nav-control');
        if (nav) nav.classList.add('active');
    } else if (viewId === 'dashboard-view') {
        const nav = document.getElementById('nav-dashboard');
        if (nav) nav.classList.add('active');
    }

    // Jika ke dashboard, update datanya
    if (viewId === 'dashboard-view') {
        updateDashboard();
    }

    // Tutup kembali dropdown setelah memilih
    const dd = document.getElementById("myDropdown");
    if (dd) dd.classList.remove("show");
    
        // Also close settings drawer/overlay if open so the selected view is visible
        try {
            const overlay = document.getElementById('settings-overlay');
            const drawer = document.getElementById('settings-drawer');
            if (overlay) overlay.style.display = 'none';
            if (drawer) drawer.setAttribute && drawer.setAttribute('aria-hidden','true');
        } catch (e) { /* ignore */ }
}

