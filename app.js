// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CHICKEN ZONE — app.js
// Auto Parts Inventory Manager — GMT800 Family Garage
// Architecture: Fetch on demand per view, session memory cache, Supabase Pro backend
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── CONFIGURATION ─────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════

var SUPABASE_URL = 'https://oqseclogmhqlfhjhxmai.supabase.co';
var SUPABASE_KEY = 'sb_publishable_5v-bGGy8gfVVMQHLbcKmEQ_HB7Y7Lrs';
var db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CATALOG ICON MAP ────────────────────────────────────────────────────────────────────────
var CAT_ICONS = {
    'Maintenance': '\u{1F6E2}', 'Engine': '\u2699\uFE0F', 'Cooling': '\u{1F321}', 'Fuel': '\u26FD',
    'Transmission': '\u{1F504}', 'Transfer Case': '4\uFE0F\u20E3', 'Drivetrain': '\u{1F529}',
    'Brakes': '\u{1F6D1}', 'Suspension': '\u{1F527}', 'Steering': '\u{1F3AF}',
    'Electrical': '\u26A1', 'Lighting': '\u{1F4A1}', 'Interior': '\u{1FA91}',
    'Exterior': '\u{1F697}', 'HVAC': '\u2744\uFE0F'
};

// ─── AVATAR EMOJI OPTIONS ─────────────────────────────────────────────────────────────────────
var AVATAR_EMOJIS = ['🐇', '🐄', '🐖', '🐎', '🐑', '🐓', '🦆', '🐕', '🐈', '🦌'];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── APPLICATION STATE ──────────────────────────────────────────────────────────────────────────
// Single source of truth. All reads go through here. Nothing persists to localStorage.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

var LS_CATALOG_KEY = 'cz_catalog_v1';  // only catalog, nothing else

var currentUser = null;
var _currentUserProfile = null;
var _isAdmin = false;
var _catalog = [];       // catalog_parts rows, normalized
var _partDetails = {};       // part_details keyed by catalog_part_id
var dbInventory = [];       // alias for _session.inventory

// ─── SESSION MEMORY CACHE ────────────────────────────────────────────────────────────────────
// Lives only for this browser session. Gone on page close. No localStorage.
// Each view populates only what it needs. Shared across views so switching is instant.
var _session = {
    catalog: null,   // loaded once on login, shared everywhere
    partDetail: null,   // loaded once on login
    inventory: null,   // parts table — loaded on first visit to parts/dashboard
    vehicles: null,   // vehicles table — loaded on first visit to vehicles/dashboard
    wishlist: null,   // wishlist table — loaded on first visit to wishlist
    reminders: null,   // maintenance_reminders — loaded on first visit to dashboard/vehicle
};

// ─── UI STATE ────────────────────────────────────────────────────────────────────────────────
var partsSort = 'alpha';
var partsSortDir = 1;
var partSearch = '';
var partsTimer = null;
var partsQtyFilter = 'all';
var wizardStep = 1;
var wizardVehicle = null;
var wizardCat = null;
var wizardPart = null;
var addMode = '';
var cameraStream = null;
var _currentPartProfile = { id: null, name: '', type: 'catalog' };
var _currentVehicleProfile = { id: null, tab: 'overview' };
var _navigating = false;   // prevents hashchange feedback loop
var _currentView = 'dashboard';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ─── STRING / DOM HELPERS ────────────────────────────────────────────────────────────────────
function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
}
function fmtDate(d) {
    if (!d) return '-';
    // Handle both date strings (2024-01-15) and full ISO timestamps
    var dateStr = d.includes('T') ? d.split('T')[0] : d;
    var dt = new Date(dateStr + 'T12:00:00');
    if (isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────────────────────────
function toast(msg, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.style.display = 'flex';
    t.style.alignItems = 'center';
    t.style.gap = '8px';
    t.style.paddingRight = '8px';
    var span = document.createElement('span');
    span.textContent = msg;
    span.style.flex = '1';
    t.appendChild(span);
    // Error toasts get an X to dismiss manually; others auto-dismiss
    if (type === 'error') {
        var x = document.createElement('button');
        x.textContent = '×';
        x.style.cssText = 'background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0;line-height:1;opacity:.7;flex-shrink:0';
        x.onclick = function () { t.remove(); };
        t.appendChild(x);
        // Error toasts don't auto-dismiss
        c.appendChild(t);
    } else {
        c.appendChild(t);
        setTimeout(function () { t.remove(); }, 3800);
    }
}

// ─── MODAL ───────────────────────────────────────────────────────────────────────────────────
function showModal(html) {
    var el = document.getElementById('modal-container');
    if (el) el.innerHTML = html;
}
function closeModal() {
    var el = document.getElementById('modal-container');
    if (el) el.innerHTML = '';
    stopCamera();
}

// ─── BADGES AND DISPLAY HELPERS ──────────────────────────────────────────────────────────────
function condBadge(c) {
    var m = { 'New': 'badge-new', 'Used - Good': 'badge-good', 'Used - Fair': 'badge-fair', 'Used - Poor': 'badge-poor' };
    return c ? '<span class="badge ' + (m[c] || '') + '">' + esc(c) + '</span>' : '<span style="color:var(--text-dim)">-</span>';
}
function prioBadge(p) {
    var m = { 'High': 'badge-high', 'Medium': 'badge-medium', 'Low': 'badge-ok' };
    return p ? '<span class="badge ' + (m[p] || '') + '">' + esc(p) + '</span>' : '';
}
function colorToCss(name) {
    if (!name) return '#888';
    var n = name.toLowerCase().trim();
    var map = {
        black: '#0a0a0a', white: '#eee', silver: '#c0c0c0', gray: '#888', grey: '#888',
        red: '#cc0000', blue: '#1e4db7', navy: '#001f5a', green: '#2d7a2d',
        yellow: '#d4b800', orange: '#e67e00', brown: '#5a3a1e', tan: '#c8a876',
        beige: '#d4c4a8', gold: '#b8860b', maroon: '#800000', purple: '#4b0082',
        pink: '#e8769e'
    };
    return map[n] || '#888';
}
function getVehicleDisplayName(v) {
    if (!v) return 'Unknown';
    var notes = v.notes || '';
    var m = notes.match(/Driver:\s*([^.,\n]+)/i);
    if (m) return m[1].trim() + "'s " + v.model;
    return v.year + ' ' + v.make + ' ' + v.model;
}

// ─── CATALOG ACCESSORS ───────────────────────────────────────────────────────────────────────
function getCatalog() { return _catalog; }
function getPartDetail(id) { return _partDetails[id] || null; }
function getCategories() {
    return _catalog.map(function (p) { return p.cat; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
}

// ─── NETWORK HELPERS ─────────────────────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
    ms = ms || 8000;
    var t = new Promise(function (_, reject) {
        setTimeout(function () {
            reject(new Error('Request timed out after ' + (ms / 1000) + 's — please try again.'));
        }, ms);
    });
    return Promise.race([promise, t]);
}

// ─── ERROR DISPLAY ───────────────────────────────────────────────────────────────────────────
// Shows a friendly error box with refresh and optional bug report buttons
function errBox(msg, techDetail) {
    if (currentUser) { window._lastErrorForBug = { msg: msg, view: _currentView }; }
    // Detect the common first-load timeout — show a friendly explanation instead of scary error
    var isFirstLoadTimeout = msg && (msg.indexOf('timed out') >= 0 || msg.indexOf('Request timed out') >= 0);
    var reportBtn = currentUser
        ? '<button class="btn btn-secondary btn-sm btn-bug-report" onclick="openBugReportFromError()">&#x1F41B; Report Bug</button>'
        : '';
    if (isFirstLoadTimeout) {
        return '<div style="padding:40px 32px">' +
            '<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:24px;color:var(--text);font-size:13px;line-height:1.6">' +
            '<strong style="font-size:16px;display:block;margin-bottom:10px;color:var(--warning)">&#x23F1;&#xFE0F; Taking a moment to wake up...</strong>' +
            '<div style="color:var(--text-muted);margin-bottom:8px">This is a normal hosting-side delay on first load and not a real error.</div>' +
            '<div style="color:var(--text-muted);margin-bottom:14px">Please press <strong>Retry</strong> to continue. If that does not work, try clicking another tab in the sidebar and coming back. If neither works after a few tries, then submit a bug report.</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button style="padding:6px 16px;background:#1a1a2e;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;cursor:pointer;font-size:13px;font-weight:600" onclick="retryCurrentView()">&#x1F504; Retry</button>' +
            reportBtn +
            '</div></div></div>';
    }
    return '<div style="padding:40px 32px">' +
        '<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:24px;color:var(--danger);font-size:13px;line-height:1.6">' +
        '<strong style="font-size:16px;display:block;margin-bottom:8px">&#x26A0;&#xFE0F; Something went wrong</strong>' +
        esc(msg) +
        '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
        '<button style="padding:6px 16px;background:#1a1a2e;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;cursor:pointer;font-size:13px;font-weight:600" onclick="retryCurrentView()">&#x1F504; Retry</button>' +
        reportBtn +
        '</div></div></div>';
}

// ─── LOADING STATE ───────────────────────────────────────────────────────────────────────────
function viewLoading(msg) {
    return '<div class="view-loading">' +
        '<div class="egg-spin-sm">&#x1F95A;</div>' +
        '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase">' +
        (msg || 'Loading...') + '</div></div>';
}
function showSpinner(msg) {
    var el = document.getElementById('app-spinner');
    if (!el) return;
    var label = el.querySelector('.spinner-label');
    if (label && msg) label.textContent = msg;
    el.style.display = 'flex';
}
function hideSpinner() {
    var el = document.getElementById('app-spinner');
    if (el) el.style.display = 'none';
}

// ─── FILE UPLOAD ─────────────────────────────────────────────────────────────────────────────
async function uploadFile(bucket, file) {
    var ext = file.name.split('.').pop();
    var path = currentUser.id + '/' + Date.now() + '.' + ext;
    var r = await db.storage.from(bucket).upload(path, file);
    if (r.error) throw r.error;
    return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// ─── SIDEBAR / CAMERA ────────────────────────────────────────────────────────────────────────
function toggleSidebar() {
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebar-overlay');
    var open = sb.classList.toggle('open');
    ov.classList.toggle('visible', open);
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
}
function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(function (t) { t.stop(); });
        cameraStream = null;
    }
}

// ─── LOCATION STORAGE (shelf locations — not GPS) ────────────────────────────────────────────
function getLocations() { try { return JSON.parse(localStorage.getItem('cz_locations') || '[]'); } catch (e) { return []; } }
function saveLocations(locs) { localStorage.setItem('cz_locations', JSON.stringify(locs)); }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── URL HASH ROUTING ───────────────────────────────────────────────────────────────────────────
// Defined BEFORE the auth handler — auth handler calls parseHash on startup.
// Format: #viewname  or  #viewname/{"key":"value"}
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function buildHash(view, arg) {
    if (!arg) return '#' + view;
    return '#' + view + '/' + encodeURIComponent(JSON.stringify(arg));
}

function parseHash(hash) {
    if (!hash || hash === '#' || hash === '') return { view: 'dashboard', arg: null };
    var h = hash.replace(/^#/, '');
    var slash = h.indexOf('/');
    if (slash < 0) return { view: h, arg: null };
    var view = h.substring(0, slash);
    try {
        var arg = JSON.parse(decodeURIComponent(h.substring(slash + 1)));
        return { view: view, arg: arg };
    } catch (e) {
        return { view: view, arg: null };
    }
}

// ─── BROWSER BACK / FORWARD SUPPORT ─────────────────────────────────────────────────────────
window.addEventListener('hashchange', function () {
    if (_navigating) return;         // we triggered this change, ignore it
    if (!currentUser) return;        // not logged in yet, ignore
    var parsed = parseHash(window.location.hash);
    showView(parsed.view, parsed.arg);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── DATA LOADING ───────────────────────────────────────────────────────────────────────────────
// No localStorage. Session memory only. Fetch on demand per view.
// Catalog loads once on login. Everything else loads when first needed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ─── CATALOG LOAD — runs once on login ───────────────────────────────────────────────────────
async function loadCatalog() {
    if (_session.catalog) return; // already loaded this session
    // Try localStorage first — catalog only changes when admin edits part info
    try {
        var cached = localStorage.getItem(LS_CATALOG_KEY);
        if (cached) {
            var parsed = JSON.parse(cached);
            if (parsed && parsed.catalog && parsed.catalog.length > 0 && parsed.partDetails) {
                _catalog = parsed.catalog;
                _partDetails = parsed.partDetails;
                _session.catalog = true;
                console.log('Catalog from cache: ' + _catalog.length + ' parts');
                // Refresh in background
                refreshCatalogFromSupabase();
                return;
            }
        }
    } catch (e) {
        try { localStorage.removeItem(LS_CATALOG_KEY); } catch (le) { }
    }
    await refreshCatalogFromSupabase();
}

async function refreshCatalogFromSupabase() {
    try {
        var results = await withTimeout(Promise.all([
            db.from('catalog_parts').select('id,name,category,subcategory,oem_number,aftermarket_ref,failure_rank,fits').order('failure_rank'),
            db.from('part_details').select('*')
        ]), 8000);
        if (results[0].error) throw new Error('Catalog failed: ' + results[0].error.message);
        _catalog = (results[0].data || []).map(function (row) {
            return {
                id: row.id, name: row.name, cat: row.category, sub: row.subcategory || '',
                oem: row.oem_number || '', afm: row.aftermarket_ref || '',
                rank: row.failure_rank || 999, fits: row.fits || 'all', desc: ''
            };
        });
        _partDetails = {};
        (results[1].data || []).forEach(function (row) {
            _partDetails[row.catalog_part_id] = {
                time: row.estimated_time || '', tools: row.tools || [],
                hardware: row.hardware || [], tip: row.pro_tip || ''
            };
        });
        _session.catalog = true;
        console.log('Catalog refreshed: ' + _catalog.length + ' parts');
        try {
            localStorage.setItem(LS_CATALOG_KEY, JSON.stringify({ catalog: _catalog, partDetails: _partDetails }));
        } catch (e) { /* quota — skip cache */ }
    } catch (e) {
        if (_session.catalog) {
            console.warn('Background catalog refresh failed:', e.message);
            return;
        }
        throw e;
    }
}

// Wipe catalog cache when admin edits a catalog part
function invalidateCatalog() {
    _session.catalog = false;
    try { localStorage.removeItem(LS_CATALOG_KEY); } catch (e) { }
}

// ─── ON-DEMAND FETCHERS — each view calls what it needs ──────────────────────────────────────
async function getInventory() {
    if (_session.inventory) return _session.inventory;
    var r = await withTimeout(db.from('parts').select('*'));
    if (r.error) throw new Error(r.error.message);
    _session.inventory = r.data || [];
    dbInventory = _session.inventory;
    return _session.inventory;
}
async function getVehicles() {
    if (_session.vehicles) return _session.vehicles;
    var r = await withTimeout(db.from('vehicles').select('*').order('year', { ascending: false }));
    if (r.error) throw new Error(r.error.message);
    _session.vehicles = r.data || [];
    return _session.vehicles;
}
async function getWishlist() {
    if (_session.wishlist) return _session.wishlist;
    var r = await withTimeout(db.from('wishlist').select('*').order('created_at', { ascending: false }));
    if (r.error) throw new Error(r.error.message);
    _session.wishlist = r.data || [];
    return _session.wishlist;
}
async function getReminders() {
    if (_session.reminders) return _session.reminders;
    var r = await withTimeout(db.from('maintenance_reminders').select('*,vehicles(id,year,make,model,notes)').eq('is_active', true));
    if (r.error) throw new Error(r.error.message);
    _session.reminders = r.data || [];
    return _session.reminders;
}

// ─── CACHE INVALIDATION — call after any write operation ─────────────────────────────────────
function invalidate() {
    // Clear all session caches so next fetch gets fresh data
    _session.inventory = null;
    _session.vehicles = null;
    _session.wishlist = null;
    _session.reminders = null;
    // Note: catalog is never invalidated — it only changes when you push a new deploy
}
function invalidateInventory() { _session.inventory = null; dbInventory = []; }
function invalidateVehicles() { _session.vehicles = null; _session.reminders = null; }
function invalidateWishlist() { _session.wishlist = null; }

// ─── DESCRIPTION FETCH — on demand when opening a part profile ───────────────────────────────
async function getPartDescription(catalogId) {
    var cp = _catalog.find(function (p) { return p.id === catalogId; });
    if (!cp) return '';
    if (cp.desc) return cp.desc; // already fetched
    try {
        var r = await db.from('catalog_parts').select('description').eq('id', catalogId).single();
        if (r.data) cp.desc = r.data.description || '';
    } catch (e) { }
    return cp.desc || '';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── AUTHENTICATION ─────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════


// ─── ADMIN VIEW-AS MODE ──────────────────────────────────────────────────────────────────────
// Admin can preview what each role sees without losing admin access
var _viewAsRole = null;

function getEffectiveRole() {
    if (_viewAsRole && _isAdmin) return _viewAsRole;
    return (_currentUserProfile && _currentUserProfile.role) || 'viewer';
}

function getEffectiveAdmin() {
    if (_viewAsRole && _isAdmin) return _viewAsRole === 'admin';
    return _isAdmin;
}

async function setViewAs(role) {
    _viewAsRole = role === 'actual' ? null : role;
    // Admin nav (which contains the View-As dropdown itself) stays visible to actual admins
    // even when previewing as another role — otherwise they can't switch back
    var adminNav = document.getElementById('admin-nav');
    if (adminNav) adminNav.style.display = _isAdmin ? 'block' : 'none';
    // Hide just the Users panel button when previewing non-admin role
    var usersBtn = document.querySelector('#admin-nav button[onclick*="users"]');
    if (usersBtn) usersBtn.style.display = getEffectiveAdmin() ? '' : 'none';
    var banner = document.getElementById('view-as-banner');
    if (banner) {
        if (_viewAsRole) {
            banner.innerHTML = '\u{1F441}\uFE0F Viewing as <strong>' + _viewAsRole + '</strong> <button class="btn btn-ghost btn-sm" onclick="setViewAs(\'actual\')" style="margin-left:8px;font-size:11px">Exit</button>';
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }
    var parsed = parseHash(window.location.hash);
    await showView(parsed.view || 'dashboard', parsed.arg);
}

var _appInitialized = false;
db.auth.onAuthStateChange(async function (event, session) {
    if (session && session.user) {
        currentUser = session.user;
        if (_appInitialized) {
            // Subsequent auth events (token refresh etc).
            // Verify cached profile matches the auth user — guard against stale state from a different account.
            if (_currentUserProfile && _currentUserProfile.id === currentUser.id) return;
            // Profile missing or wrong user — fetch fresh
            try {
                var rp = await db.from('profiles').select('*').eq('id', currentUser.id).single();
                _currentUserProfile = rp.data || null;
                _isAdmin = _currentUserProfile && _currentUserProfile.role === 'admin';
                // Update sidebar to match
                var d2 = document.getElementById('user-email-display');
                if (d2 && _currentUserProfile) {
                    var c2 = _currentUserProfile.user_color || '#FFD700';
                    var n2 = _currentUserProfile.display_name || _currentUserProfile.username || currentUser.email;
                    var e2 = _currentUserProfile.avatar_emoji || '\u{1F407}';
                    d2.innerHTML = e2 + ' <span style="color:' + c2 + ';font-weight:600">' + esc(n2) + '</span>';
                }
                var an = document.getElementById('admin-nav');
                if (an) an.style.display = _isAdmin ? 'block' : 'none';
            } catch (e) { }
            return;
        }
        // ── FIRST TIME ONLY ────────────────────────────────────────────────────
        // Show username immediately from metadata
        var uname = (currentUser.user_metadata && currentUser.user_metadata.username) || currentUser.email;
        var display = document.getElementById('user-email-display');
        if (display) display.innerHTML = '<span style="font-weight:600">' + esc(uname) + '</span>';
        try {
            showSpinner('Opening the garage...');
            await loadCatalog();
            var profRes = await withTimeout(db.from('profiles').select('*').eq('id', currentUser.id).single(), 6000);
            _currentUserProfile = profRes.data || null;
            _isAdmin = _currentUserProfile && _currentUserProfile.role === 'admin';
            if (_currentUserProfile) {
                var ucolor = _currentUserProfile.user_color || '#FFD700';
                var dname = _currentUserProfile.display_name || _currentUserProfile.username || uname;
                var emoji2 = _currentUserProfile.avatar_emoji || '🐇';
                if (display) display.innerHTML = emoji2 + ' <span style="color:' + ucolor + ';font-weight:600">' + esc(dname) + '</span>';
            }
            var adminNav = document.getElementById('admin-nav');
            if (adminNav) adminNav.style.display = _isAdmin ? 'block' : 'none';
        } catch (e) {
            console.warn('Startup error:', e);
            _currentUserProfile = null;
            _isAdmin = false;
        }
        _appInitialized = true;
        hideSpinner();
        var authEl = document.getElementById('auth-screen');
        var appEl = document.getElementById('app');
        if (authEl) authEl.style.display = 'none';
        if (appEl) appEl.style.display = 'flex';
        var parsed = parseHash(window.location.hash);
        await showView(parsed.view || 'dashboard', parsed.arg);
    } else {
        currentUser = null;
        _currentUserProfile = null;
        _isAdmin = false;
        _appInitialized = false;
        hideSpinner();
        var authEl2 = document.getElementById('auth-screen');
        var appEl2 = document.getElementById('app');
        if (authEl2) authEl2.style.display = 'flex';
        if (appEl2) appEl2.style.display = 'none';
    }
});


// ─── SIGN IN ─────────────────────────────────────────────────────────────────────────────────
async function signIn() {
    var input = document.getElementById('login-username').value.trim();
    var password = document.getElementById('login-password').value;
    if (!input || !password) { toast('Please enter your username and password', 'error'); return; }
    // Direct email login
    if (input.indexOf('@') >= 0) {
        var r0 = await db.auth.signInWithPassword({ email: input, password: password });
        if (r0.error) toast('Incorrect username or password', 'error');
        return;
    }
    // Username login: look up real email, fall back to old @chickzone.internal format
    var loginEmail = null;
    try {
        var pr = await db.from('profiles').select('real_email').eq('username', input).single();
        if (pr.data && pr.data.real_email) loginEmail = pr.data.real_email;
    } catch (e) { }
    if (loginEmail) {
        var r1 = await db.auth.signInWithPassword({ email: loginEmail, password: password });
        if (!r1.error) return;
    }
    var r2 = await db.auth.signInWithPassword({ email: input + '@chickzone.internal', password: password });
    if (r2.error) toast('Incorrect username or password', 'error');
}

// ─── SIGN UP ─────────────────────────────────────────────────────────────────────────────────
async function signUp() {
    var username = document.getElementById('reg-username').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    var email = document.getElementById('reg-email').value.trim();
    var password = document.getElementById('reg-password').value;
    var invCode = document.getElementById('reg-invite') ? document.getElementById('reg-invite').value.trim().toUpperCase() : '';
    if (!username || !email || !password) return toast('Please fill all fields', 'error');
    if (username.length < 3) return toast('Username must be at least 3 characters', 'error');
    if (email.indexOf('@') < 0) return toast('Please enter a valid email', 'error');
    // Check username uniqueness
    var existing = await db.from('profiles').select('id').eq('username', username).single();
    if (existing.data) return toast('That username is taken', 'error');
    // Check invite code if provided
    var assignedRole = 'viewer';
    var usedCodeId = null;
    var usedCodeUses = 0;
    if (invCode) {
        var existsRes = await db.from('invite_codes').select('*').ilike('code', invCode);
        if (existsRes.error) {
            toast('Could not check invite code. Please try again.', 'error');
            return;
        }
        if (!existsRes.data || existsRes.data.length === 0) {
            toast('Invite code not found. Check spelling and try again.', 'error');
            return;
        }
        var ic = existsRes.data[0];
        if (!ic.is_active) {
            toast('This invite code has been deactivated. Ask an admin for a new one.', 'error');
            return;
        }
        assignedRole = ic.role;
        usedCodeId = ic.id;
        usedCodeUses = ic.uses || 0;
    }
    // Create auth user
    var r = await db.auth.signUp({ email: email, password: password, options: { data: { username: username, real_email: email } } });
    if (r.error) { toast(r.error.message, 'error'); return; }

    // Sign in immediately so we have an authenticated session for the profile upsert
    var signInRes = await db.auth.signInWithPassword({ email: email, password: password });
    if (signInRes.error) {
        // Signup worked but auto-signin failed — send them to login manually
        toast('Account created! Please sign in.', 'success');
        switchAuthTab('login');
        document.getElementById('login-username').value = username;
        return;
    }

    // Now authenticated — upsert profile with the correct role
    var { error: upsertErr } = await db.from('profiles').upsert({
        id: signInRes.data.user.id, username: username, display_name: username,
        full_name: username, real_email: email, role: assignedRole, user_color: '#FFD700', avatar_emoji: '🐇'
    });
    if (upsertErr) { console.error('Profile upsert failed:', upsertErr.message); }

    // Increment invite code uses
    if (usedCodeId) {
        await db.from('invite_codes').update({ uses: usedCodeUses + 1 }).eq('id', usedCodeId);
    }

    // Auth state change will initialize the app automatically
    toast('Welcome to Chicken Zone' + (assignedRole !== 'viewer' ? ' — role set to ' + assignedRole + '!' : '! Enter an invite code on your profile to unlock access.'), 'success');
}

function switchAuthTab(tab) {
    var tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(function (t, i) { t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register')); });
    document.getElementById('auth-form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('auth-form-register').style.display = tab === 'register' ? 'block' : 'none';
}

async function signOut() { _appInitialized = false; await db.auth.signOut(); }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── NAVIGATION / VIEW ROUTING ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════


// ─── RETRY CURRENT VIEW — re-renders without full page reload ────────────────────────────────
async function retryCurrentView() {
    // Invalidate session cache for current view so fresh data is fetched
    var view = _currentView;
    if (view === 'parts' || view === 'part-profile' || view === 'dashboard') {
        invalidateInventory();
    }
    if (view === 'vehicles' || view === 'vehicle-profile' || view === 'dashboard') {
        invalidateVehicles();
    }
    if (view === 'wishlist') {
        invalidateWishlist();
    }
    // Re-render current view
    var parsed = parseHash(window.location.hash);
    await showView(parsed.view || _currentView, parsed.arg);
}

async function showView(view, arg) {
    if (window.innerWidth <= 768) closeSidebar();
    _currentView = view;
    // Update URL hash for bookmarkability and back/forward
    var newHash = buildHash(view, arg);
    if (window.location.hash !== newHash) {
        _navigating = true;
        window.location.hash = newHash;
        setTimeout(function () { _navigating = false; }, 100);
    }
    // Apply viewer-mode class to disable action buttons for viewers
    var appEl2 = document.getElementById('app');
    if (appEl2) {
        if (getEffectiveRole() === 'viewer') {
            appEl2.classList.add('viewer-mode');
        } else {
            appEl2.classList.remove('viewer-mode');
        }
    }
    // Highlight correct nav item
    var navView = view === 'part-profile' ? 'parts' : view === 'vehicle-profile' ? 'vehicles' : view;
    document.querySelectorAll('.nav-item').forEach(function (n) {
        n.classList.toggle('active', n.dataset.view === navView);
    });
    // Show correct container
    document.querySelectorAll('#main-content > div').forEach(function (d) { d.style.display = 'none'; });
    var el = document.getElementById('view-' + view);
    if (el) el.style.display = 'block';
    // Render
    try {
        if (view === 'dashboard') await renderDashboard();
        else if (view === 'parts') await renderPartsPage();
        else if (view === 'part-profile') await renderPartProfile(arg);
        else if (view === 'vehicles') await renderVehicles();
        else if (view === 'vehicle-profile') await renderVehicleProfile(arg);
        else if (view === 'wishlist') await renderWishlist();
        else if (view === 'feedback') await renderFeedbackPage();
        else if (view === 'profile') await renderUserProfile();
        else if (view === 'users') _isAdmin ? await renderUsersPanel() : await renderUserProfile();
    } catch (err) {
        console.error('showView error for ' + view + ':', err);
        if (el) el.innerHTML = errBox('Could not load this page. ' + err.message);
    }
}

// ─── REFRESH CURRENT VIEW — call after writes to update displayed data ────────────────────────
async function refreshCurrentView() {
    var parsed = parseHash(window.location.hash);
    await showView(parsed.view || _currentView, parsed.arg);
}
async function refreshVehicleView() {
    if (_currentVehicleProfile.id) {
        await renderVehicleProfile({ id: _currentVehicleProfile.id });
    } else {
        await renderVehicles();
    }
}
