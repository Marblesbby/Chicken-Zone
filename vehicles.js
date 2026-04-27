// ─── CHICKEN ZONE — vehicles.js — Vehicles List, Vehicle Profile, Service, Maintenance ──────────
// Depends on: app.js, parts.js (install flow)

// ─── VEHICLES ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// ─── VEHICLES LIST PAGE ──────────────────────────────────────────────────────
async function renderVehicles() {
    var myToken = Date.now();
    const el = document.getElementById('view-vehicles');
    el.dataset.renderToken = myToken;
    let vehicles = [];
    let ownerProfiles = [];
    try {
        if (!_session.vehicles) el.innerHTML = viewLoading('Loading vehicles...');
        [vehicles] = await Promise.all([getVehicles()]);
        // Fetch owner assignments
        var opRes = await db.from('profiles').select('username,display_name,avatar_emoji,user_color,assigned_vehicle_id').not('assigned_vehicle_id', 'is', null);
        ownerProfiles = opRes.data || [];
    } catch (err) {
        el.innerHTML = errBox(err.message, err.stack);
        console.error(err);
        return;
    }

    let html = '';
    html = maybeShowTesterBanner() + html;
    html += '<div class="page-header"><div><div class="page-title">Vehicles</div><div class="page-subtitle">Car Profiles</div></div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary" onclick="showVehicleModal()">+ New Vehicle</button>';
    html += '<button class="btn btn-secondary" onclick="toast(\'Guest car feature coming soon!\',\'info\')">+ Guest</button>';
    html += '</div></div>';

    if (!vehicles || vehicles.length === 0) {
        html += '<div class="empty-state"><div class="empty-icon">🚗</div><p>No vehicles yet</p></div>';
    } else {
        html += '<div class="vehicle-grid">';
        vehicles.forEach(function (v) {
            const driverName = getVehicleDisplayName(v);
            const subtitle = [v.make, v.model, v.trim].filter(Boolean).join(' ').replace(/\s+AWD$/, '');
            html += '<div class="vehicle-card" style="position:relative" onclick="showView(\'vehicle-profile\',{id:\'' + v.id + '\'})">';
            html += '<div class="vehicle-year-bg">' + v.year + '</div>';
            html += '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:22px;font-weight:700;text-transform:uppercase;color:var(--text)">' + esc(driverName) + '</div>';
            html += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;display:flex;align-items:center;gap:8px">' + esc(subtitle);
            if (v.color) html += '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + colorToCss(v.color) + ';border:1px solid rgba(255,255,255,.2);flex-shrink:0" title="' + esc(v.color) + '"></span>';
            html += '</div>';
            html += '<div style="font-size:13px;color:var(--text-muted)">🛣 <span style="color:var(--text);font-weight:600">' + (v.current_mileage || 0).toLocaleString() + '</span> miles</div>';
            if (v.vin) html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px">VIN: ' + esc(v.vin) + '</div>';
            // Find owner for this vehicle
            var vOwner = ownerProfiles.find(function (op) { return op.assigned_vehicle_id === v.id; });
            if (vOwner) {
                html += '<div style="position:absolute;bottom:12px;right:12px;display:flex;align-items:center;gap:4px;font-size:12px;color:' + (vOwner.user_color || '#FFD700') + '">';
                html += (vOwner.avatar_emoji || '🐇') + ' ' + esc(vOwner.display_name || vOwner.username || 'Owner');
                html += '</div>';
            }
            html += '<div class="flex-row no-print" style="margin-top:14px;flex-wrap:wrap;gap:6px" onclick="event.stopPropagation()">';
            html += '<button class="btn btn-secondary btn-sm" onclick="showLogMileageModal(\'' + v.id + '\')">🛣 Log Miles</button>';
            html += '<button class="btn btn-secondary btn-sm" onclick="printVehicleProfile(\'' + v.id + '\')">🖨️</button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';
    }
    if (String(el.dataset.renderToken) !== String(myToken)) return; // navigated away, discard stale render
    el.innerHTML = html;
}

// Legacy - make sure anything calling openVehicleDetail still works
function openVehicleDetail(id) {
    showView('vehicle-profile', { id: id });
}

// Refresh vehicle data - stays on current view (list or profile)
async function refreshVehicleView() {
    if (_currentVehicleProfile.id) {
        await renderVehicleProfile({ id: _currentVehicleProfile.id });
    } else {
        await renderVehicles();
    }
}



// ─── VEHICLE PROFILE - FULL PAGE VIEW ────────────────────────────────────────
// (declared in foundation)

async function renderVehicleProfile(arg) {
    var myVToken = Date.now();
    const el = document.getElementById('view-vehicle-profile');
    if (!el) return;
    el.innerHTML = viewLoading('Loading vehicle...');
    el.dataset.renderToken = myVToken;

    const id = arg?.id;
    if (!id) {
        el.innerHTML = '<div style="padding:60px"><button class="btn btn-secondary btn-sm" onclick="showView(\'vehicles\')">← Back to Vehicles</button></div>';
        return;
    }

    // Preserve tab from previous render or use default
    // arg.tab can override the tab (e.g. from dashboard photo reminder click)
    if (_currentVehicleProfile.id !== id) {
        _currentVehicleProfile = { id: id, tab: arg?.tab || 'overview' };
    } else if (arg?.tab) {
        _currentVehicleProfile.tab = arg.tab;
    }

    let v = null, services = [], reminders = [], installs = [], mileLogs = [];
    try {
        const vRes = await withTimeout(db.from('vehicles').select('*').eq('id', id).single());
        v = vRes.data;
        if (!v) throw new Error('Vehicle not found');
        const r = await withTimeout(Promise.all([
            db.from('service_history').select('*').eq('vehicle_id', id).order('performed_date', { ascending: false }),
            db.from('maintenance_reminders').select('*').eq('vehicle_id', id).eq('is_active', true).order('created_at'),
            db.from('part_installations').select('*,parts(name,part_number,condition,catalog_part_id)').eq('vehicle_id', id).order('installed_date', { ascending: false }),
            db.from('mileage_logs').select('*').eq('vehicle_id', id).order('logged_at', { ascending: false }).limit(6)
        ]));
        services = r[0].data || [];
        reminders = r[1].data || [];
        installs = r[2].data || [];
        mileLogs = r[3].data || [];
    } catch (err) {
        el.innerHTML = '<div style="padding:32px"><button class="btn btn-secondary btn-sm" onclick="showView(\'vehicles\')">← Back</button><div class="alert alert-danger" style="margin-top:16px">Error loading vehicle: ' + err.message + '</div></div>';
        return;
    }

    const today = new Date();
    const dueReminders = reminders.filter(function (r) {
        if (r.snoozed_until_date && new Date(r.snoozed_until_date) > today) return false;
        if (r.next_due_date && new Date(r.next_due_date) <= today) return true;
        if (r.next_due_mileage && (v.current_mileage || 0) >= r.next_due_mileage) return true;
        return false;
    });

    const driverName = getVehicleDisplayName(v);
    const subtitle = [v.make, v.model, v.trim].filter(Boolean).join(' ').replace(/\s+AWD$/, '');

    // Extract engine and transmission from notes
    const engineMatch = (v.notes || '').match(/Engine:\s*([^.,\n]+)/i);
    const transMatch = (v.notes || '').match(/Trans(?:mission)?:\s*([^.,\n]+)/i);
    const interiorMatch = (v.notes || '').match(/([A-Za-z]+)\s+interior/i);
    const engine = engineMatch ? engineMatch[1].trim() : '';
    const transmission = transMatch ? transMatch[1].trim() : '';
    const interiorColor = interiorMatch ? interiorMatch[1] : '';
    // Fetch assigned owner for this vehicle
    let vOwner = null;
    try {
        var ownerRes = await db.from('profiles').select('username,display_name,avatar_emoji,user_color').eq('assigned_vehicle_id', id).single();
        vOwner = ownerRes.data || null;
    } catch (e) { }

    const tab = _currentVehicleProfile.tab || 'overview';

    let html = '';

    // Hero header matching the list card style
    html += '<div style="background:linear-gradient(135deg,#0a0a1a 0%,#151525 100%);margin:-32px -32px 24px -32px;padding:28px 32px;border-bottom:2px solid var(--accent);position:relative;overflow:hidden">';
    html += '<button class="btn btn-ghost btn-sm" onclick="showView(\'vehicles\')" style="margin-bottom:12px">← Back to Vehicles</button>';
    html += '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:120px;color:var(--accent);line-height:1;opacity:.15;position:absolute;right:24px;top:30px">' + v.year + '</div>';
    html += '<div style="position:relative">';
    html += '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:40px;font-weight:700;text-transform:uppercase;color:var(--text);line-height:1">' + esc(driverName) + '</div>';
    html += '<div style="color:var(--text-muted);font-size:14px;margin-top:4px;display:flex;align-items:center;gap:10px">' + esc(subtitle);
    if (v.color) html += '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + colorToCss(v.color) + ';border:1px solid rgba(255,255,255,.2)" title="' + esc(v.color) + '"></span>';
    html += '</div>';
    html += '<div style="color:var(--text-muted);font-size:13px;margin-top:12px">🛣 <strong style="color:var(--text)">' + (v.current_mileage || 0).toLocaleString() + '</strong> miles' + (v.vin ? ' · VIN: ' + esc(v.vin) : '') + '</div>';
    html += '<div class="flex-row no-print" style="flex-wrap:wrap;gap:6px;margin-top:16px">';
    html += '<button class="btn btn-secondary btn-sm" onclick="showLogMileageModal(\'' + id + '\')">🛣 Log Miles</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="showVehicleModal(\'' + id + '\')">✏️ Edit</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="printVehicleProfile(\'' + id + '\')">🖨️ Print</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="toast(\'Sell feature coming soon\',\'info\')" title="Sell vehicle (coming soon)">💰 Sell</button>';
    html += '</div></div></div>';

    // Due reminders banner
    if (dueReminders.length > 0) {
        html += '<div class="alert alert-warning" style="margin-bottom:20px">⚠️ <strong>' + dueReminders.length + ' maintenance item' + (dueReminders.length > 1 ? 's' : '') + ' due</strong></div>';
    }

    // Tabs
    html += '<div class="tabs no-print">';
    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'service', label: 'Service History (' + services.length + ')' },
        { id: 'parts', label: 'Installed Parts (' + installs.filter(function (i) { return !i.removed_date; }).length + ')' },
        { id: 'photos', label: 'Photos' },
        { id: 'reminders', label: 'Maintenance (' + reminders.length + ')' }
    ];
    tabs.forEach(function (t) {
        html += '<div class="tab ' + (tab === t.id ? 'active' : '') + '" onclick="setVehicleTab(\'' + t.id + '\')">' + t.label + '</div>';
    });
    html += '</div>';

    html += '<div id="vehicle-tab-content">';
    if (tab === 'overview') html += renderVehicleOverview(v, engine, transmission, interiorColor, mileLogs, services, installs, vOwner);
    else if (tab === 'service') html += renderServiceTab(services, id);
    else if (tab === 'parts') html += renderPartsTab(installs, id);
    else if (tab === 'photos') html += await renderPhotosTab(v);
    else if (tab === 'reminders') html += renderRemindersTab(reminders, v, id);
    html += '</div>';

    el.innerHTML = html;
    // Load comments after profile renders
    if (tab === 'overview' && id) {
        setTimeout(function () {
            var cEl = document.getElementById('comments-vehicle-' + id);
            if (cEl) renderComments('vehicle', id, 'comments-vehicle-' + id);
        }, 100);
    }
}

function setVehicleTab(tab) {
    _currentVehicleProfile.tab = tab;
    renderVehicleProfile({ id: _currentVehicleProfile.id });
}



function toggleSection(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var isHidden = el.style.display === 'none';
    el.style.display = isHidden ? '' : 'none';
    var arrowId = id.replace('-section', '-arrow');
    var arrow = document.getElementById(arrowId);
    if (arrow) arrow.innerHTML = isHidden ? '&#x25BC;' : '&#x25B6;';
}

function filterReminders(query) {
    // Simple client-side filter of visible reminders
    var items = document.querySelectorAll('.reminder-card');
    items.forEach(function (card) {
        var text = card.textContent.toLowerCase();
        card.style.display = (!query.trim() || text.includes(query.toLowerCase())) ? '' : 'none';
    });
}

function renderVehicleOverview(v, engine, transmission, interiorColor, mileLogs, services, installs, vOwner) {
    const active = (installs || []).filter(function (i) { return !i.removed_date; });
    let html = '<div class="grid-2" style="gap:16px">';

    // Left: specs
    html += '<div class="card"><div class="stat-label" style="margin-bottom:12px">Vehicle Specs</div>';
    // Vehicle specs in 2-column grid: Left = Engine/Owner/Interior, Right = Transmission/Commute Style
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:10px">';

    // LEFT COLUMN
    html += '<div>';
    html += '<div class="detail-field" style="margin-bottom:10px"><label>Engine</label><div class="value" style="font-family:Barlow Condensed,sans-serif;font-size:18px;color:var(--accent)">' + esc(engine || 'Not specified') + '</div></div>';
    if (vOwner) {
        html += '<div class="detail-field" style="margin-bottom:10px"><label>Owner</label><div class="value" style="display:flex;align-items:center;gap:6px"><span style="font-size:18px">' + (vOwner.avatar_emoji || '\u{1F407}') + '</span><span style="color:' + (vOwner.user_color || '#FFD700') + ';font-weight:600">' + esc(vOwner.display_name || vOwner.username || 'Unknown') + '</span></div></div>';
    } else {
        html += '<div class="detail-field" style="margin-bottom:10px"><label>Owner</label><div class="value" style="color:var(--text-dim)">Not assigned</div></div>';
    }
    if (interiorColor) {
        html += '<div class="detail-field" style="margin-bottom:10px"><label>Interior</label><div class="value" style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + colorToCss(interiorColor) + ';border:1px solid rgba(255,255,255,.2)"></span>' + esc(interiorColor) + '</div></div>';
    }
    html += '</div>';

    // RIGHT COLUMN
    html += '<div>';
    html += '<div class="detail-field" style="margin-bottom:10px"><label>Transmission</label><div class="value" style="font-family:Barlow Condensed,sans-serif;font-size:18px;color:var(--accent)">' + esc(transmission || 'Not specified') + '</div></div>';
    if (v.commute_style && COMMUTE_STYLES[v.commute_style]) {
        var cs = COMMUTE_STYLES[v.commute_style];
        html += '<div class="detail-field" style="margin-bottom:10px"><label>Commute Style</label><div class="value" style="font-family:Barlow Condensed,sans-serif;font-size:16px;color:var(--accent)">' + esc(cs.label) + ' <span style="font-size:12px;color:var(--text-muted)">(~' + cs.miles_per_year.toLocaleString() + ' mi/yr)</span></div></div>';
    } else {
        html += '<div class="detail-field" style="margin-bottom:10px"><label>Commute Style</label><div class="value" style="color:var(--text-dim)">Not set</div></div>';
    }
    html += '</div>';

    html += '</div>';
    html += '</div>';

    // Right: mileage
    html += '<div class="card"><div class="stat-label" style="margin-bottom:12px">Recent Mileage Logs</div>';
    if ((mileLogs || []).length === 0) {
        html += '<div style="color:var(--text-muted);font-size:13px">No mileage logged yet</div>';
    } else {
        mileLogs.forEach(function (l) {
            html += '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">';
            html += '<span style="font-weight:600;font-family:\'Barlow Condensed\',sans-serif;font-size:16px">' + l.mileage.toLocaleString() + ' mi</span>';
            html += '<span style="color:var(--text-muted)">' + fmtDate(l.logged_at) + '</span>';
            html += '</div>';
        });
    }
    html += '</div>';

    html += '</div>';

    // Stats row
    html += '<div class="grid-2" style="gap:16px;margin-top:16px">';
    html += '<div class="stat-card"><div class="stat-label">Service Records</div><div class="stat-value">' + services.length + '</div></div>';
    html += '<div class="stat-card"><div class="stat-label">Active Parts</div><div class="stat-value">' + active.length + '</div></div>';
    html += '</div>';

    // Notes
    if (v.notes) {
        // Filter out the structured fields from notes for display
        let cleanNotes = v.notes
            .replace(/Driver:\s*[^.,\n]+[.,]?\s*/i, '')
            .replace(/Engine:\s*[^.,\n]+[.,]?\s*/i, '')
            .replace(/Trans(?:mission)?:\s*[^.,\n]+[.,]?\s*/i, '')
            .replace(/Automatic\s+climate\s+control[.,]?\s*/i, '')
            .replace(/[A-Za-z]+\s+interior[.,]?\s*/i, '')
            .trim();
        if (cleanNotes) {
            html += '<div class="card" style="margin-top:16px"><div class="stat-label" style="margin-bottom:8px">Notes</div><div style="font-size:13px;color:var(--text-muted);line-height:1.6">' + esc(cleanNotes) + '</div></div>';
        }
    }

    // Comments section
    html += '<div class="card" style="margin-top:16px"><div class="stat-label" style="margin-bottom:10px">💬 Comments</div>';
    html += '<div id="comments-vehicle-' + v.id + '"></div></div>';
    // Note: renderComments called after full profile renders
    return html;
}

// Photos tab - skeleton for Phase 2
async function renderPhotosTab(v) {
    var vehicleId = v.id;
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px" class="no-print">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;color:var(--text-muted)">Condition photos tagged by location. Orange ! means photo is over 1 year old.</div>';
    html += '<label class="btn btn-primary btn-sm" style="cursor:pointer">+ Upload Photo<input type="file" accept="image/*" style="display:none" onchange="handleVehiclePhotoUpload(\'' + vehicleId + '\',this.files[0])"></label>';
    html += '</div>';
    var photos = [];
    try {
        var res = await db.from('vehicle_photos').select('*').eq('vehicle_id', vehicleId).order('uploaded_at', { ascending: false });
        photos = res.data || [];
    } catch (e) { photos = []; }
    if (photos.length === 0) {
        html += '<div class="empty-state"><div class="empty-icon">&#x1F4F8;</div><p>No photos yet</p>';
        html += '<div style="font-size:12px;color:var(--text-dim);margin-top:8px">Upload exterior, interior, and condition shots. Tap a photo to add tags.</div></div>';
        return html;
    }
    var ORDER = { Exterior: 0, Interior: 1, 'Engine Bay': 2, Damage: 3 };
    photos.sort(function (a, b) {
        var ao = ORDER[a.location_tag] !== undefined ? ORDER[a.location_tag] : 99;
        var bo = ORDER[b.location_tag] !== undefined ? ORDER[b.location_tag] : 99;
        if (ao !== bo) return ao - bo;
        var ad = a.damage_rating && a.damage_rating !== 'Excellent' ? 1 : 0;
        var bd = b.damage_rating && b.damage_rating !== 'Excellent' ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return new Date(b.uploaded_at) - new Date(a.uploaded_at);
    });
    var current = photos.filter(function (p) { return p.is_current; });
    var historical = photos.filter(function (p) { return !p.is_current; });
    var oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    function photoCard(p) {
        var needsUpdate = new Date(p.uploaded_at) < oneYearAgo;
        var tagColor = p.location_tag === 'Damage' ? 'var(--danger)' : p.location_tag === 'Exterior' ? 'var(--ku-blue)' : 'var(--info)';
        var card = '<div style="position:relative;cursor:pointer" onclick="openPhotoDetail(\'' + p.id + '\',\'' + vehicleId + '\')">' +
            '<img src="' + p.image_url + '" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--border)">' +
            '<div style="position:absolute;top:6px;left:6px;display:flex;gap:4px;flex-wrap:wrap">';
        if (p.location_tag) card += '<span style="background:' + tagColor + ';color:#fff;font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px">' + esc(p.location_tag) + '</span>';
        if (p.damage_rating && p.damage_rating !== 'Excellent') card += '<span style="background:var(--danger);color:#fff;font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:3px">' + esc(p.damage_rating) + '</span>';
        card += '</div>';
        if (needsUpdate) card += '<div style="position:absolute;top:6px;right:6px;background:var(--warning);color:#111;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700" title="Over 1 year old">!</div>';
        card += '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">' + fmtDate(p.uploaded_at) + '</div>';
        if (p.notes) card += '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.notes) + '</div>';
        card += '</div>';
        return card;
    }
    var sections = {};
    current.forEach(function (p) { var k = p.location_tag || 'Untagged'; if (!sections[k]) sections[k] = []; sections[k].push(p); });
    ['Exterior', 'Interior', 'Engine Bay', 'Damage', 'Untagged'].forEach(function (sec) {
        if (!sections[sec] || sections[sec].length === 0) return;
        html += '<div style="margin-bottom:24px">';
        html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:12px">' + sec + '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">';
        sections[sec].forEach(function (p) { html += photoCard(p); });
        html += '</div></div>';
    });
    if (historical.length > 0) {
        html += '<div style="margin-top:16px">';
        html += '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'photo-hist\').style.display===\'none\'?document.getElementById(\'photo-hist\').style.display=\'grid\':document.getElementById(\'photo-hist\').style.display=\'none\'" style="margin-bottom:12px">&#x25BC; Show History (' + historical.length + ')</button>';
        html += '<div id="photo-hist" style="display:none;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;opacity:.6">';
        historical.forEach(function (p) { html += photoCard(p); });
        html += '</div></div>';
    }
    return html;
}

async function handleVehiclePhotoUpload(vehicleId, file) {
    if (!file) return;
    toast('Uploading...', 'info');
    try {
        var url = await uploadFile('vehicle-photos', file);
        await db.from('vehicle_photos').insert({ vehicle_id: vehicleId, uploaded_by: currentUser.id, image_url: url, is_current: true, uploaded_at: new Date().toISOString() });
        toast('Uploaded! Tap the photo to add tags.', 'success');
        setVehicleTab('photos');
    } catch (e) { toast('Upload failed: ' + e.message, 'error'); }
}

async function openPhotoDetail(photoId, vehicleId) {
    var res = await db.from('vehicle_photos').select('*').eq('id', photoId).single();
    var p = res.data; if (!p) return;
    var locOpts = ['Exterior', 'Interior', 'Engine Bay', 'Damage'].map(function (t) { return '<option value="' + t + '"' + (p.location_tag === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    var dmgOpts = ['Excellent', 'Good', 'Fair', 'Poor', 'Parts Only'].map(function (d) { return '<option value="' + d + '"' + (p.damage_rating === d ? ' selected' : '') + '>' + d + '</option>'; }).join('');
    var hr = p.location_tag ? await db.from('vehicle_photos').select('*').eq('vehicle_id', vehicleId).eq('location_tag', p.location_tag).order('uploaded_at', { ascending: false }) : null;
    var history = (hr && hr.data || []).filter(function (h) { return h.id !== photoId; });
    showModal('<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:560px">' +
        '<div class="modal-header"><div class="modal-title">Photo Details</div><button class="close-btn" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' +
        '<img src="' + p.image_url + '" style="width:100%;border-radius:8px;margin-bottom:16px;max-height:280px;object-fit:cover">' +
        '<div class="grid-2">' +
        '<div class="form-group"><label>Location Tag</label><select class="form-control" id="pd-loc"><option value="">Untagged</option>' + locOpts + '</select></div>' +
        '<div class="form-group"><label>Damage Rating</label><select class="form-control" id="pd-dmg"><option value="">No damage noted</option>' + dmgOpts + '</select></div>' +
        '</div>' +
        '<div class="form-group"><label>Notes</label><input type="text" class="form-control" id="pd-notes" value="' + esc(p.notes || '') + '" placeholder="e.g. Rust on rocker panel"></div>' +
        (history.length > 0 ? '<div style="margin-top:12px"><div style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Previous ' + esc(p.location_tag || '') + ' photos</div>' +
            '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
            history.slice(0, 6).map(function (h) { return '<div style="flex-shrink:0"><img src="' + h.image_url + '" style="width:80px;height:60px;object-fit:cover;border-radius:4px;opacity:.7"><div style="font-size:10px;color:var(--text-muted);text-align:center">' + fmtDate(h.uploaded_at) + '</div></div>'; }).join('') +
            '</div></div>' : '') + '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-danger btn-sm" title="Delete permanently (cannot be undone)" onclick="deleteVehiclePhoto(\'' + photoId + '\',\'' + vehicleId + '\')">Delete</button>' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="savePhotoTags(\'' + photoId + '\',\'' + vehicleId + '\')">Save Tags</button>' +
        '</div></div></div>');
}

async function savePhotoTags(photoId, vehicleId) {
    var locTag = val('pd-loc'), dmgRating = val('pd-dmg'), notes = val('pd-notes');
    if (locTag) { await db.from('vehicle_photos').update({ is_current: false }).eq('vehicle_id', vehicleId).eq('location_tag', locTag).eq('is_current', true).neq('id', photoId); }
    var { error } = await db.from('vehicle_photos').update({ location_tag: locTag || null, damage_rating: dmgRating || null, notes: notes || null, is_current: true }).eq('id', photoId);
    if (error) { toast(error.message, 'error'); return; }
    toast('Tags saved!', 'success'); closeModal(); setVehicleTab('photos');
}

async function deleteVehiclePhoto(photoId, vehicleId) {
    if (!confirm('Delete this photo?')) return;
    await db.from('vehicle_photos').delete().eq('id', photoId);
    toast('Deleted', 'success'); closeModal(); setVehicleTab('photos');
}



async function showVehicleModal(id = null) { let v = null; if (id) { const { data } = await db.from('vehicles').select('*').eq('id', id).single(); v = data } showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">${v ? 'Edit Vehicle' : 'Add Vehicle'}</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="grid-3"><div class="form-group"><label>Year *</label><input type="number" class="form-control" id="v-year" value="${v?.year || ''}" placeholder="2006"></div><div class="form-group" style="grid-column:span 2"><label>Make *</label><input type="text" class="form-control" id="v-make" value="${esc(v?.make || '')}" placeholder="Cadillac, GMC, Chevrolet..."></div></div><div class="grid-2"><div class="form-group"><label>Model *</label><input type="text" class="form-control" id="v-model" value="${esc(v?.model || '')}" placeholder="Escalade, Yukon, Avalanche..."></div><div class="form-group"><label>Trim</label><input type="text" class="form-control" id="v-trim" value="${esc(v?.trim || '')}" placeholder="Denali, EXT, LTZ..."></div></div><div class="grid-2"><div class="form-group"><label>Color</label><input type="text" class="form-control" id="v-color" value="${esc(v?.color || '')}" placeholder="Black, Silver..."></div><div class="form-group"><label>Current Mileage</label><input type="number" class="form-control" id="v-miles" value="${v?.current_mileage || ''}"></div></div><div class="form-group"><label>VIN</label><input type="text" class="form-control" id="v-vin" value="${esc(v?.vin || '')}"></div><div class="form-group"><label>Commute Style</label><select class="form-control" id="v-commute"><option value="">Select driving pattern...</option><option value="city" ${v?.commute_style === 'city' ? 'selected' : ''}>City Driver ~8k mi/yr</option><option value="mixed" ${v?.commute_style === 'mixed' ? 'selected' : ''}>Mixed ~12k mi/yr</option><option value="highway" ${v?.commute_style === 'highway' ? 'selected' : ''}>Highway Commuter ~15k mi/yr</option><option value="weekend" ${v?.commute_style === 'weekend' ? 'selected' : ''}>Weekend Driver ~3k mi/yr</option><option value="worktruck" ${v?.commute_style === 'worktruck' ? 'selected' : ''}>Work Truck ~20k mi/yr</option></select></div><div class="form-group"><label>Preferred Historical Date</label><input type="date" class="form-control" id="v-histdate" value="${v?.preferred_historical_date || ''}"><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Used as default when adding historical part installs (parts installed before you started using Chicken Zone)</div></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="v-notes">${esc(v?.notes || '')}</textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveVehicle(${v ? `'${v.id}'` : 'null'})">${v ? 'Save' : 'Add Vehicle'}</button></div></div></div>`); }

async function saveVehicle(id) {
    const year = parseInt(document.getElementById('v-year').value); const make = val('v-make'), model = val('v-model'); if (!year || !make || !model) return toast('Year, make, and model are required', 'error'); const data = { year, make, model, trim: val('v-trim') || null, color: val('v-color') || null, current_mileage: parseInt(document.getElementById('v-miles').value) || 0, vin: val('v-vin') || null, notes: val('v-notes') || null, commute_style: val('v-commute') || null, preferred_historical_date: val('v-histdate') || null }; let error; if (id) { ({ error } = await db.from('vehicles').update(data).eq('id', id)) } else { data.created_by = currentUser.id; ({ error } = await db.from('vehicles').insert(data)) } if (error) { toast(error.message, 'error'); return } if (!id) {
        // Get the new vehicle ID
        var { data: newV } = await db.from('vehicles').select('id').order('created_at', { ascending: false }).limit(1).single();
        if (newV) {
            var commuteKey = val('v-commute') || 'mixed';
            var today2 = new Date();
            var autoItems = AUTO_MAINTENANCE.map(function (m) {
                var nd = null;
                if (m.interval_days) { var d2 = new Date(today2); d2.setDate(d2.getDate() + m.interval_days); nd = d2.toISOString().split('T')[0]; }
                return { vehicle_id: newV.id, title: m.title, interval_miles: m.interval_miles, interval_days: m.interval_days, next_due_date: nd, is_active: true, reminder_type: m.reminder_type, is_auto: true };
            });
            await db.from('maintenance_reminders').insert(autoItems);
        }
    }
    toast(id ? 'Vehicle updated!' : 'Vehicle added!', 'success'); invalidate(); closeModal(); await refreshVehicleView()
}

async function confirmDeleteVehicle(id, name) { if (!confirm(`Delete "${name}" and all history?`)) return; await db.from('vehicles').delete().eq('id', id); _currentVehicleProfile = { id: null, tab: 'overview' }; invalidate(); toast('Deleted', 'success'); await showView('vehicles') }

async function showLogMileageModal(vehicleId) { const { data: v } = await db.from('vehicles').select('year,make,model,current_mileage').eq('id', vehicleId).single(); showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Log Mileage</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div style="margin-bottom:16px;padding:12px;background:var(--surface);border-radius:6px;font-size:13px"><strong>${v ? `${v.year} ${v.make} ${v.model}` : 'Vehicle'}</strong><br><span style="color:var(--text-muted)">Current: <strong>${(v?.current_mileage || 0).toLocaleString()} mi</strong></span></div><div class="form-group"><label>New Mileage Reading *</label><input type="number" class="form-control" id="ml-miles" placeholder="e.g. 155000"></div><div class="form-group"><label>Note</label><input type="text" class="form-control" id="ml-note" placeholder="e.g. After road trip"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="logMileage('${vehicleId}')">Log Mileage</button></div></div></div>`) }

async function logMileage(vehicleId) { const mileage = parseInt(document.getElementById('ml-miles').value); if (!mileage) return toast('Please enter mileage', 'error'); const [{ error: e1 }, { error: e2 }] = await Promise.all([db.from('mileage_logs').insert({ vehicle_id: vehicleId, mileage, notes: val('ml-note') || null }), db.from('vehicles').update({ current_mileage: mileage }).eq('id', vehicleId)]); if (e1 || e2) { toast('Error', 'error'); return } toast('Mileage logged!', 'success'); closeModal(); await refreshVehicleView() }

async function showServiceModal(vehicleId) { showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">Add Service Record</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Service Type *</label><input type="text" class="form-control" id="sr-type" list="svc-list" placeholder="e.g. Oil Change"><datalist id="svc-list"><option>Oil Change</option><option>Tire Rotation</option><option>Brake Job</option><option>Transmission Service</option><option>Coolant Flush</option><option>Spark Plugs</option><option>Air Filter</option><option>Water Pump</option><option>Alternator</option><option>Ball Joints</option><option>Wheel Bearings</option><option>Alignment</option><option>Differential Fluid</option><option>Transfer Case Fluid</option></datalist></div><div class="form-group"><label>Description</label><textarea class="form-control" id="sr-desc" placeholder="Details about work performed..."></textarea></div><div class="grid-2"><div class="form-group"><label>Date</label><input type="date" class="form-control" id="sr-date" value="${new Date().toISOString().split('T')[0]}"></div><div class="form-group"><label>Mileage</label><input type="number" class="form-control" id="sr-miles"></div></div><div class="form-group"><label>Performed By</label><input type="text" class="form-control" id="sr-by" placeholder="e.g. Dad, Shop"></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="sr-notes"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveServiceRecord('${vehicleId}')">Add Record</button></div></div></div>`) }

async function saveServiceRecord(vehicleId) { const t = val('sr-type'); if (!t) return toast('Service type required', 'error'); const { error } = await db.from('service_history').insert({ vehicle_id: vehicleId, service_type: t, description: val('sr-desc') || null, performed_date: val('sr-date') || null, mileage_at_service: parseInt(document.getElementById('sr-miles').value) || null, performed_by: val('sr-by') || null, notes: val('sr-notes') || null }); if (error) { toast(error.message, 'error'); return } toast('Record added!', 'success'); invalidate(); closeModal(); await refreshVehicleView() }

async function deleteServiceRecord(id) { if (!confirm('Delete this record?')) return; await db.from('service_history').delete().eq('id', id); toast('Deleted', 'success'); invalidate(); await refreshVehicleView() }

async function showInstallPartModal(invId, cpId, partName, condition, location) {
    var compatVehicles = await getVehicles();
    if (cpId) {
        var cp = _catalog.find(function (p) { return p.id === cpId; });
        if (cp && cp.fits !== 'all') {
            compatVehicles = compatVehicles.filter(function (v) {
                return cp.fits === 'esc' ? v.make === 'Cadillac' : cp.fits === 'yk' ? v.make === 'GMC' : true;
            });
        }
    }
    var opts = '<option value="">Select vehicle...</option>';
    compatVehicles.forEach(function (v) { opts += '<option value="' + v.id + '">' + esc(getVehicleDisplayName(v)) + '</option>'; });
    var partDisplay = partName ? ('<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:16px"><div style="font-weight:600;font-size:15px">' + esc(partName) + '</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + (condition ? 'Condition: ' + esc(condition) + '&nbsp;&nbsp;' : '') + (location ? 'Location: ' + esc(location) : 'No location set') + '</div></div>') : '';
    var partField;
    if (invId) {
        partField = '<input type="hidden" id="ip-part" value="' + invId + '">';
    } else {
        var invOpts = '<option value="">Select...</option>';
        (_session.inventory || []).filter(function (p) { return p.quantity > 0; }).sort(function (a, b) { return (a.date_acquired || '').localeCompare(b.date_acquired || ''); }).forEach(function (p) { invOpts += '<option value="' + p.id + '">' + esc(p.name) + (p.part_number ? ' #' + esc(p.part_number) : '') + '</option>'; });
        partField = '<div class="form-group"><label>Part from Inventory *</label><select class="form-control" id="ip-part">' + invOpts + '</select></div>';
    }
    showModal('<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px"><div class="modal-header"><div class="modal-title">Install Part</div><button class="close-btn" onclick="closeModal()">&times;</button></div><div class="modal-body">' + partDisplay + partField + '<div class="form-group"><label>Install On *</label><select class="form-control" id="ip-vehicle">' + opts + '</select></div><div class="grid-2"><div class="form-group"><label>Date Installed</label><input type="date" class="form-control" id="ip-date" value="' + new Date().toISOString().split('T')[0] + '"></div><div class="form-group"><label>Mileage at Install</label><input type="number" class="form-control" id="ip-miles" placeholder="e.g. 155000"></div></div><div class="form-group"><label>How Long Did It Take?</label><input type="text" class="form-control" id="ip-time" placeholder="e.g. 2 hrs, 45 min"></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="ip-notes" rows="2"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveInstallFromModal()">Install Part</button></div></div></div>');
}


function saveInstallFromModal() {
    var v = document.getElementById('ip-vehicle');
    saveInstall(v ? v.value : '');
}


// ─── HISTORICAL PART INSTALL ──────────────────────────────────────────────────────────────────
// Lets users record parts that were installed before they started using the app,
// or parts they had on hand when installing. Creates install record only — no inventory entry.

async function showHistoricalInstallModal(vehicleId) {
    var vRes = await db.from('vehicles').select('preferred_historical_date').eq('id', vehicleId).single();
    var defaultDate = (vRes.data && vRes.data.preferred_historical_date) || '';

    var cats = getCategories();
    var catOpts = '<option value="">Select a category...</option>';
    cats.forEach(function (c) { catOpts += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });

    // Build multi-part checklist grouped by category
    var multiList = '';
    cats.forEach(function (cat) {
        var partsInCat = _catalog.filter(function (p) { return p.cat === cat; });
        if (!partsInCat.length) return;
        multiList += '<div style="margin-bottom:10px">';
        multiList += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);font-weight:700;margin-bottom:4px">' + esc(cat) + '</div>';
        partsInCat.forEach(function (p) {
            multiList += '<label style="display:flex;align-items:center;gap:8px;padding:4px;cursor:pointer;font-size:13px;border-radius:4px" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'\'">';
            multiList += '<input type="checkbox" id="hi-check-' + p.id + '" value="' + p.id + '" style="cursor:pointer;flex-shrink:0">';
            multiList += '<span style="flex:1">' + esc(p.name) + '</span>';
            if (p.oem) multiList += '<span style="font-size:10px;color:var(--text-dim);font-family:\'Barlow Condensed\',sans-serif">' + esc(p.oem) + '</span>';
            multiList += '</label>';
        });
        multiList += '</div>';
    });

    var modal = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal" style="max-width:480px">' +
        '<div class="modal-header"><div class="modal-title">+ Historical Install</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;line-height:1.5">For parts installed before you started using Chicken Zone, or parts you already had on hand. This won\'t add to inventory — just records the install.</div>' +

        // ── Single-part section (shown by default)
        '<div id="hi-single-section">' +
        '<div class="form-group"><label>Part Type</label>' +
        '<select class="form-control" id="hi-cat" onchange="updateHistoricalPartList()">' + catOpts + '</select></div>' +
        '<div class="form-group"><label>Part Name</label>' +
        '<select class="form-control" id="hi-part" onchange="updateHistoricalOEM()" disabled>' +
        '<option value="">Select a category first...</option></select></div>' +
        '<div class="form-group"><label>OEM Part Number</label>' +
        '<input type="text" class="form-control" id="hi-oem" placeholder="(auto-filled when part selected)" readonly></div>' +
        '</div>' +

        // ── Multi-part section (hidden until toggle)
        '<div id="hi-multi-section" style="display:none">' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;padding:10px;background:rgba(255,215,0,.06);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;line-height:1.5">' +
        '&#x2705; All selected parts will be installed using their OEM part numbers. To edit part numbers or other details afterward, use the <strong>Installed Parts</strong> tab on this vehicle\'s profile.' +
        '</div>' +
        '<div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:10px">' +
        multiList +
        '</div></div>' +

        // ── Shared fields
        '<div class="grid-2" style="margin-top:12px">' +
        '<div class="form-group"><label>Condition</label>' +
        '<select class="form-control" id="hi-cond">' +
        '<option value="New" selected>New</option>' +
        '<option value="Used - Good">Used - Good</option>' +
        '<option value="Used - Fair">Used - Fair</option>' +
        '<option value="Used - Poor">Used - Poor</option>' +
        '<option value="Unknown">Unknown</option>' +
        '</select></div>' +
        '<div class="form-group"><label>Mileage at Install</label>' +
        '<input type="number" class="form-control" id="hi-miles" placeholder="optional"></div>' +
        '</div>' +

        '<div class="grid-2">' +
        '<div class="form-group"><label>Date Installed</label>' +
        '<input type="date" class="form-control" id="hi-date" value="' + defaultDate + '"></div>' +
        '<div class="form-group" style="display:flex;align-items:center;padding-top:24px">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0">' +
        '<input type="checkbox" id="hi-no-date" onchange="if(this.checked)document.getElementById(\'hi-date\').value=\'\'"> ' +
        '<span style="font-size:12px">I don\'t know the date</span></label></div>' +
        '</div>' +

        '<div class="form-group"><label>Notes</label>' +
        '<textarea class="form-control" id="hi-notes" rows="2" placeholder="optional"></textarea></div>' +

        // ── Multiple toggle at bottom left
        '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--accent);width:fit-content">' +
        '<input type="checkbox" id="hi-multi" onchange="toggleHistoricalMultiple()"> &#xFF0B; Multiple Parts' +
        '</label></div>' +

        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveHistoricalInstall(\'' + vehicleId + '\')">Save</button>' +
        '</div></div></div>';

    showModal(modal);
}

function toggleHistoricalMultiple() {
    var isMulti = document.getElementById('hi-multi').checked;
    document.getElementById('hi-single-section').style.display = isMulti ? 'none' : 'block';
    document.getElementById('hi-multi-section').style.display = isMulti ? 'block' : 'none';
}

function updateHistoricalPartList() {
    var cat = val('hi-cat');
    var sel = document.getElementById('hi-part');
    if (!sel) return;
    if (!cat) {
        sel.innerHTML = '<option value="">Select a category first...</option>';
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    var partsInCat = _catalog.filter(function (p) { return p.cat === cat; });
    var opts = '<option value="">Select a part...</option>';
    partsInCat.forEach(function (p) {
        opts += '<option value="' + p.id + '" data-oem="' + esc(p.oem) + '" data-name="' + esc(p.name) + '">' + esc(p.name) + '</option>';
    });
    sel.innerHTML = opts;
    document.getElementById('hi-oem').value = '';
}

function updateHistoricalOEM() {
    var sel = document.getElementById('hi-part');
    var opt = sel.options[sel.selectedIndex];
    var oemEl = document.getElementById('hi-oem');
    if (opt && opt.dataset && opt.dataset.oem) {
        oemEl.value = opt.dataset.oem;
    } else {
        oemEl.value = '';
    }
}

async function saveHistoricalInstall(vehicleId) {
    var cond = val('hi-cond') || 'New';
    var miles = parseInt(document.getElementById('hi-miles').value) || null;
    var noDate = document.getElementById('hi-no-date') && document.getElementById('hi-no-date').checked;
    var dateInstalled = noDate ? null : (val('hi-date') || null);
    var notes = val('hi-notes') || null;
    var isMulti = document.getElementById('hi-multi') && document.getElementById('hi-multi').checked;

    if (isMulti) {
        var checked = Array.from(document.querySelectorAll('#hi-multi-section input[type="checkbox"]:checked'));
        if (checked.length === 0) return toast('Select at least one part', 'error');
        var failCount = 0;
        for (var ci = 0; ci < checked.length; ci++) {
            var cpId = checked[ci].value;
            var cp = _catalog.find(function (p) { return p.id === cpId; });
            if (!cp) continue;
            var pr = await db.from('parts').insert({
                name: cp.name, catalog_part_id: cp.id,
                part_number: cp.oem || null, condition: cond,
                quantity: 0, source: 'Historical', is_historical: true
            }).select().single();
            if (pr.error) { failCount++; continue; }
            await db.from('part_installations').insert({
                part_id: pr.data.id, vehicle_id: vehicleId,
                installed_date: dateInstalled, installed_mileage: miles,
                notes: notes, is_historical: true
            });
        }
        if (failCount > 0) toast(failCount + ' part(s) failed to save', 'error');
        else toast(checked.length + ' historical install' + (checked.length > 1 ? 's' : '') + ' logged \uD83C\uDF89', 'success');
        invalidate();
        closeModal();
        setTimeout(async function () { if (_currentVehicleProfile.id) await refreshVehicleView(); }, 200);
        return;
    }

    // ── Single part mode
    var catalogId = val('hi-part');
    if (!catalogId) return toast('Select a part', 'error');
    var partSel = document.getElementById('hi-part');
    var partOpt = partSel.options[partSel.selectedIndex];
    var partName = partOpt.dataset.name || '';
    var oem = val('hi-oem');

    var { data: newPart, error: partErr } = await db.from('parts').insert({
        name: partName, catalog_part_id: catalogId,
        part_number: oem || null, condition: cond,
        quantity: 0, source: 'Historical', is_historical: true
    }).select().single();
    if (partErr) { toast(partErr.message, 'error'); return; }

    var { error: instErr } = await db.from('part_installations').insert({
        part_id: newPart.id, vehicle_id: vehicleId,
        installed_date: dateInstalled, installed_mileage: miles,
        notes: notes, is_historical: true
    });
    if (instErr) { toast(instErr.message, 'error'); return; }

    toast('Historical install logged', 'success');
    invalidate();
    closeModal();
    setTimeout(async function () {
        if (_currentVehicleProfile.id) await refreshVehicleView();
    }, 200);
}


async function saveInstall(vehicleId) {
    if (!vehicleId) return toast('Please select a vehicle', 'error');
    var partId = document.getElementById('ip-part').value;
    if (!partId) return toast('Please select a part', 'error');
    var timeTaken = val('ip-time') || null;
    var pRes = await db.from('parts').select('quantity,name,catalog_part_id').eq('id', partId).single();
    var p = pRes.data;
    var { error } = await db.from('part_installations').insert({
        part_id: partId, vehicle_id: vehicleId,
        installed_date: val('ip-date') || null,
        installed_mileage: parseInt(document.getElementById('ip-miles').value) || null,
        time_taken: timeTaken,
        notes: val('ip-notes') || null
    });
    if (error) { toast(error.message, 'error'); return; }
    var newQty = (p && p.quantity > 0) ? p.quantity - 1 : 0;
    if (p && p.quantity > 0) {
        await db.from('parts').update({ quantity: newQty }).eq('id', partId);
    }
    // Force-clear ALL session caches so next render is fully fresh
    invalidate();
    closeModal();
    toast('Part installed!', 'success');
    // Show wishlist prompt if part hit 0
    if (newQty === 0) {
        var pname = p ? p.name : 'this part';
        setTimeout(function () { showAddToWishlistPrompt(pname); }, 500);
    }
    // Wait briefly for modal close, then refresh — avoids race with cancellation token
    setTimeout(async function () {
        if (_currentVehicleProfile.id) {
            await refreshVehicleView();
        }
    }, 300);
}

async function showRemovePartModal(installId) { showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Mark Part Removed</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Date Removed</label><input type="date" class="form-control" id="rp-date" value="${new Date().toISOString().split('T')[0]}"></div><div class="form-group"><label>Reason</label><input type="text" class="form-control" id="rp-reason" placeholder="e.g. Failed early, Upgraded, Swapped"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="markRemoved('${installId}')">Confirm</button></div></div></div>`) }

async function markRemoved(installId) { const { error } = await db.from('part_installations').update({ removed_date: val('rp-date') || new Date().toISOString().split('T')[0], removal_reason: val('rp-reason') || null }).eq('id', installId); if (error) { toast(error.message, 'error'); return } toast('Marked removed', 'success'); invalidate(); closeModal(); await refreshVehicleView() }

async function deleteInstallRecord(installId) {
    if (!confirm('Permanently delete this installation record? This cannot be undone.')) return;
    var { error } = await db.from('part_installations').delete().eq('id', installId);
    if (error) { toast(error.message, 'error'); return; }
    toast('Record deleted', 'success');
    invalidate();
    await refreshVehicleView();
}

async function showSwapPartModal(installId, catalogPartId, partName) {
    var invItems = (_session.inventory || []).filter(function (p) {
        return p.catalog_part_id === catalogPartId && p.quantity > 0;
    });
    var invOpts = '<option value="">No inventory — just log the swap</option>';
    invItems.forEach(function (p) {
        invOpts += '<option value="' + p.id + '">' + esc(p.name) +
            (p.condition ? ' (' + esc(p.condition) + ')' : '') +
            (p.part_number ? ' #' + esc(p.part_number) : '') + '</option>';
    });
    var invField = invItems.length > 0
        ? '<div class="form-group"><label>Use from Inventory</label><select class="form-control" id="sw-inv">' + invOpts + '</select></div>'
        : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;padding:8px;background:var(--surface);border-radius:6px">No matching inventory on hand — the swap will be logged but no inventory item will be consumed.</div><input type="hidden" id="sw-inv" value="">';
    showModal('<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal" style="max-width:440px">' +
        '<div class="modal-header"><div class="modal-title">&#x1F504; Swap Part</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button></div>' +
        '<div class="modal-body">' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:16px">' +
        '<strong style="font-size:13px">' + esc(partName) + '</strong><br>' +
        '<span style="font-size:12px;color:var(--text-muted)">Current install will be marked removed. A new install will be logged in its place.</span>' +
        '</div>' +
        invField +
        '<div class="grid-2">' +
        '<div class="form-group"><label>Date Swapped</label><input type="date" class="form-control" id="sw-date" value="' + new Date().toISOString().split('T')[0] + '"></div>' +
        '<div class="form-group"><label>Mileage at Swap</label><input type="number" class="form-control" id="sw-miles" placeholder="optional"></div>' +
        '</div>' +
        '<div class="form-group"><label>Reason / Notes</label><input type="text" class="form-control" id="sw-reason" placeholder="e.g. Failed early, Upgraded, Preventive"></div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveSwapPart(\'' + installId + '\',\'' + esc(partName).replace(/\'/g, '&#39;') + '\')">Confirm Swap</button>' +
        '</div></div></div>');
}

async function saveSwapPart(installId, partName) {
    var swDate = val('sw-date') || new Date().toISOString().split('T')[0];
    var swMiles = parseInt(document.getElementById('sw-miles').value) || null;
    var swReason = val('sw-reason') || null;
    var invId = val('sw-inv') || null;

    var { error: remErr } = await db.from('part_installations').update({
        removed_date: swDate,
        removal_reason: swReason || 'Swapped'
    }).eq('id', installId);
    if (remErr) { toast(remErr.message, 'error'); return; }

    if (invId) {
        var { error: instErr } = await db.from('part_installations').insert({
            part_id: invId,
            vehicle_id: _currentVehicleProfile.id,
            installed_date: swDate,
            installed_mileage: swMiles,
            notes: swReason || null
        });
        if (instErr) { toast(instErr.message, 'error'); return; }
        var qRes = await db.from('parts').select('quantity').eq('id', invId).single();
        if (qRes.data && qRes.data.quantity > 0) {
            await db.from('parts').update({ quantity: qRes.data.quantity - 1 }).eq('id', invId);
        }
    }

    invalidate();
    closeModal();
    toast('Part swapped! &#x2705;', 'success');
    setTimeout(async function () { if (_currentVehicleProfile.id) await refreshVehicleView(); }, 300);
}

async function showReminderModal(vehicleId, kind) {
    kind = kind || 'follow_up';
    var titleText = kind === 'routine' ? 'Add Routine Maintenance' : 'Add Follow-up';
    var btnLabel = kind === 'routine' ? 'Add Routine' : 'Add Follow-up';
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">${titleText}</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Title *</label><input type="text" class="form-control" id="mr-title" list="rem-list" placeholder="e.g. Oil Change"><datalist id="rem-list"><option>Oil Change</option><option>Tire Rotation</option><option>Brake Inspection</option><option>Transmission Fluid</option><option>Coolant Flush</option><option>Spark Plugs</option><option>Air Filter</option><option>Differential Fluid</option><option>Transfer Case Fluid</option><option>Ball Joint Inspection</option></datalist></div><div class="form-group"><label>Description</label><input type="text" class="form-control" id="mr-desc"></div><div class="form-group"><label>Reminder Type</label><select class="form-control" id="mr-type" onchange="toggleRF()"><option value="mileage">Mileage Based</option><option value="time">Time Based</option><option value="both">Both</option></select></div><div class="grid-2"><div class="form-group" id="mr-mg"><label>Interval (Miles)</label><input type="number" class="form-control" id="mr-miles" placeholder="e.g. 5000"></div><div class="form-group" id="mr-dg" style="display:none"><label>Interval (Days)</label><input type="number" class="form-control" id="mr-days" placeholder="e.g. 180"></div></div><div class="grid-2"><div class="form-group"><label>Last Done Date</label><input type="date" class="form-control" id="mr-ld"></div><div class="form-group"><label>Last Done Mileage</label><input type="number" class="form-control" id="mr-lm"></div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="rem-save-btn" onclick="saveReminder('${vehicleId}','${kind}')">${btnLabel}</button></div></div></div>`)
}

function toggleRF() { const t = document.getElementById('mr-type').value; document.getElementById('mr-mg').style.display = (t === 'mileage' || t === 'both') ? 'block' : 'none'; document.getElementById('mr-dg').style.display = (t === 'time' || t === 'both') ? 'block' : 'none' }

async function saveReminder(vehicleId, kind) {
    kind = kind || 'follow_up';
    var title = val('mr-title');
    if (!title) return toast('Title required', 'error');
    var type = document.getElementById('mr-type').value;
    var im = parseInt(document.getElementById('mr-miles').value) || null;
    var id_ = parseInt(document.getElementById('mr-days').value) || null;
    var ld = val('mr-ld') || null;
    var lm = parseInt(document.getElementById('mr-lm').value) || null;
    var nd = null, nm = null;
    if (ld && id_) { var d = new Date(ld); d.setDate(d.getDate() + id_); nd = d.toISOString().split('T')[0]; }
    if (lm && im) nm = lm + im;
    var rec = {
        vehicle_id: vehicleId, title: title, description: val('mr-desc') || null,
        reminder_type: type, interval_miles: im, interval_days: id_,
        last_done_date: ld, last_done_mileage: lm,
        next_due_date: nd, next_due_mileage: nm,
        is_routine: kind === 'routine',
        is_active: true
    };
    var { error } = await db.from('maintenance_reminders').insert(rec);
    if (error) { toast(error.message, 'error'); return; }
    toast(kind === 'routine' ? 'Routine added!' : 'Follow-up added!', 'success');
    invalidate();
    closeModal();
    await refreshVehicleView();
}

async function markReminderDone(reminderId, vehicleId, currentMileage) {
    var r = (await db.from('maintenance_reminders').select('*').eq('id', reminderId).single()).data;
    if (!r) return;
    var today = new Date().toISOString().split('T')[0];
    var isFollowUp = !r.is_auto && !r.is_routine;
    if (isFollowUp) {
        // Follow-up: ask for comment then delete + log to service history + add comment to vehicle
        var note = prompt('Add a comment about completing "' + r.title + '" (visible in vehicle comments):');
        if (note === null) return; // cancelled
        await Promise.all([
            db.from('maintenance_reminders').delete().eq('id', reminderId),
            db.from('service_history').insert({
                vehicle_id: vehicleId,
                service_type: r.title,
                description: note || 'Follow-up completed',
                performed_date: today,
                mileage_at_service: currentMileage || null
            })
        ]);
        if (note && note.trim()) {
            // Add to vehicle comments table
            var uname = (_currentUserProfile && (_currentUserProfile.display_name || _currentUserProfile.username)) || 'User';
            var ucolor = (_currentUserProfile && _currentUserProfile.user_color) || '#FFD700';
            await db.from('comments').insert({
                record_type: 'vehicle', record_id: vehicleId,
                body: 'Follow-up done: ' + r.title + ' — ' + note,
                user_id: currentUser.id, username: uname, user_color: ucolor
            });
        }
        toast('Follow-up done & logged!', 'success');
    } else {
        // Routine: recurring - update next due dates
        var nd = null, nm = null;
        if (r.interval_days) { var d = new Date(); d.setDate(d.getDate() + r.interval_days); nd = d.toISOString().split('T')[0]; }
        if (r.interval_miles && currentMileage) nm = parseInt(currentMileage) + r.interval_miles;
        await Promise.all([
            db.from('maintenance_reminders').update({
                last_done_date: today, last_done_mileage: currentMileage || null,
                next_due_date: nd, next_due_mileage: nm,
                snoozed_until_date: null, snoozed_until_mileage: null
            }).eq('id', reminderId),
            db.from('service_history').insert({
                vehicle_id: vehicleId, service_type: r.title,
                description: 'Completed via maintenance reminder',
                performed_date: today, mileage_at_service: currentMileage || null
            })
        ]);
        toast('Done! Service record logged.', 'success');
    }
    invalidate();
    await refreshVehicleView();
}

async function showSnoozeModal(reminderId, title) { showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Snooze Reminder</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">Snoozing: <strong style="color:var(--text)">${esc(title)}</strong></div><div class="form-group"><label>Snooze Until Date</label><input type="date" class="form-control" id="sn-date"></div><div style="text-align:center;color:var(--text-dim);font-size:12px;margin:4px 0"> -  or  - </div><div class="form-group"><label>Snooze Until Mileage</label><input type="number" class="form-control" id="sn-miles"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="snoozeReminder('${reminderId}')">Snooze</button></div></div></div>`) }

async function snoozeReminder(id) { const sd = val('sn-date') || null, sm = parseInt(document.getElementById('sn-miles').value) || null; if (!sd && !sm) return toast('Enter date or mileage', 'error'); await db.from('maintenance_reminders').update({ snoozed_until_date: sd, snoozed_until_mileage: sm }).eq('id', id); toast('Snoozed!', 'success'); invalidate(); closeModal(); await refreshVehicleView() }

async function deleteReminder(id) { if (!confirm('Delete reminder?')) return; await db.from('maintenance_reminders').delete().eq('id', id); toast('Deleted', 'success'); invalidate(); await refreshVehicleView() }

// ─── VEHICLE TAB RENDERERS ────────────────────────────────────────────────────

function renderServiceTab(services, vehicleId) {
    var html = '<div class="no-print" style="margin-bottom:14px;display:flex;gap:8px;align-items:center">';
    html += '<input type="text" class="form-control" id="svc-search" placeholder="&#x1F50D; Search service history..." style="flex:1;font-size:13px" oninput="filterServiceHistory(this.value,' + JSON.stringify(services) + ')">';
    html += '<button class="btn btn-primary btn-sm" onclick="showServiceModal(_currentVehicleProfile.id)">+ Add Record</button>';
    html += '</div>';
    html += '<div id="svc-list">';
    html += renderServiceList(services);
    html += '</div>';
    return html;
}

function filterServiceHistory(query, services) {
    var el = document.getElementById('svc-list');
    if (!el) return;
    var filtered = services;
    if (query.trim()) {
        var q = query.toLowerCase();
        filtered = services.filter(function (s) {
            return (s.service_type && s.service_type.toLowerCase().includes(q)) || (s.description && s.description.toLowerCase().includes(q));
        });
    }
    el.innerHTML = renderServiceList(filtered);
}

function renderServiceList(services) {
    var html = '';
    if (!services || services.length === 0) return '<div class="empty-state"><div class="empty-icon">&#x1F4CB;</div><p>No service records yet</p></div>';
    services.forEach(function (s) {
        html += '<div class="service-row"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div>';
        html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;text-transform:uppercase;color:#ffffff">' + esc(s.service_type || 'Service') + '</div>';
        var meta = [s.performed_date ? fmtDate(s.performed_date) : null, s.mileage_at_service ? s.mileage_at_service.toLocaleString() + ' mi' : null, s.performed_by ? 'by ' + esc(s.performed_by) : null].filter(Boolean).join(' &middot; ');
        if (meta) html += '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">' + meta + '</div>';
        if (s.description) html += '<div style="margin-top:8px;font-size:13px;color:var(--ku-blue)">' + esc(s.description) + '</div>';
        html += '</div><button class="btn btn-ghost btn-sm no-print" onclick="deleteServiceRecord(\'' + s.id + '\')">&#x1F5D1;&#xFE0F;</button></div></div>';
    });
    return html;
}


// ─── PART PROFILE POPUP (read-only overlay) ───────────────────────────────────────────────
async function showPartProfilePopup(catalogId) {
    if (!catalogId) { toast('No catalog info for this part', 'info'); return; }
    var cp = _catalog.find(function (p) { return p.id === catalogId; });
    if (!cp) { toast('Part not found in catalog', 'error'); return; }
    var pd = getPartDetail(catalogId) || {};

    var html = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal" style="max-width:560px;max-height:80vh;overflow-y:auto">' +
        '<div class="modal-header" style="position:sticky;top:0;background:var(--surface);z-index:1">' +
        '<div class="modal-title">' + esc(cp.name) + '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + esc(cp.cat) + (cp.sub ? ' · ' + esc(cp.sub) : '') + '</div>';

    if (cp.desc) html += '<div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">' + esc(cp.desc) + '</div>';

    // Part numbers
    if (cp.oem || cp.afm) {
        html += '<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap">';
        if (cp.oem) html += '<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">OEM</div><div style="font-family:Barlow Condensed,sans-serif;font-size:15px">' + esc(cp.oem) + '</div></div>';
        if (cp.afm) html += '<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Aftermarket Ref</div><div style="font-size:13px;color:var(--text-muted)">' + esc(cp.afm) + '</div></div>';
        html += '</div>';
    }

    // What you need
    if (pd.time) html += '<div style="margin-bottom:8px"><span style="font-size:11px;text-transform:uppercase;color:var(--text-dim)">Swap Time</span> <strong>' + esc(pd.time) + '</strong></div>';
    if (pd.tools && pd.tools.length) { html += '<div style="margin-bottom:8px"><div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Tools</div><div style="font-size:13px">' + pd.tools.map(function (t) { return esc(t); }).join(', ') + '</div></div>'; }
    if (pd.hardware && pd.hardware.length) { html += '<div style="margin-bottom:8px"><div style="font-size:11px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">Also Buy</div><div style="font-size:13px">' + pd.hardware.map(function (h) { return esc(h); }).join(', ') + '</div></div>'; }
    if (pd.tip) html += '<div style="margin-top:8px;padding:8px;background:var(--accent-dim);border-radius:6px;font-size:12px"><strong>Pro Tip:</strong> ' + esc(pd.tip) + '</div>';

    html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">' +
        '<button class="btn btn-secondary" onclick="showView(\'part-profile\',{id:\'' + catalogId + '\',type:\'catalog\'});closeModal()">Open Full Page ↗</button>' +
        '</div>';

    html += '</div></div></div>';
    showModal(html);
}

function renderPartsTab(installs, vehicleId) {
    var active = (installs || []).filter(function (i) { return !i.removed_date; });
    var removed = (installs || []).filter(function (i) { return !!i.removed_date; });
    var html = '<div class="no-print" style="margin-bottom:14px;display:flex;gap:8px;align-items:center">';
    html += '<input type="text" class="form-control" id="parts-tab-search" placeholder="&#x1F50D; Search installed parts..." style="flex:1;font-size:13px" oninput="filterInstalledParts(this.value)">';
    html += '<button class="btn btn-primary btn-sm" onclick="showInstallPartModal(_currentVehicleProfile.id,null,null,null,null)">+ Log Install</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="showHistoricalInstallModal(_currentVehicleProfile.id)">+ History</button>';
    html += '</div>';
    html += '<div id="parts-tab-list">';
    html += renderPartsTabContent(active, removed);
    html += '</div>';
    return html;
}

function filterInstalledParts(query) {
    var el = document.getElementById('parts-tab-list');
    if (!el) return;
    // Re-render with filter
    var allInstalls = _installedPartsCache || [];
    var active = allInstalls.filter(function (i) { return !i.removed_date; });
    var removed = allInstalls.filter(function (i) { return !!i.removed_date; });
    if (query.trim()) {
        var q = query.toLowerCase();
        active = active.filter(function (i) { return i.parts && i.parts.name && i.parts.name.toLowerCase().includes(q); });
        removed = removed.filter(function (i) { return i.parts && i.parts.name && i.parts.name.toLowerCase().includes(q); });
    }
    el.innerHTML = renderPartsTabContent(active, removed);
}

var _installedPartsCache = [];

function renderPartsTabContent(active, removed) {
    _installedPartsCache = [].concat(active, removed);
    var html = '';
    if (active.length === 0 && removed.length === 0) return '<div class="empty-state"><div class="empty-icon">&#x1F529;</div><p>No parts logged yet</p></div>';

    function safeId(k) { return (k || '').replace(/[^a-z0-9]/gi, '_'); }

    if (active.length > 0) {
        // Group by catalog category
        var groups = {};
        active.forEach(function (i) {
            var catName = 'Other';
            if (i.parts && i.parts.catalog_part_id) {
                var cp = _catalog.find(function (p) { return p.id === i.parts.catalog_part_id; });
                if (cp) catName = cp.cat;
            }
            if (!groups[catName]) groups[catName] = [];
            groups[catName].push(i);
        });
        // Sort categories alphabetically, put Other last
        var cats = Object.keys(groups).sort(function (a, b) {
            if (a === 'Other') return 1;
            if (b === 'Other') return -1;
            return a.localeCompare(b);
        });
        cats.forEach(function (cat) {
            var icon = CAT_ICONS[cat] || '&#x1F527;';
            html += '<div style="margin-bottom:16px">';
            html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">' + icon + ' ' + esc(cat) + '</div>';
            groups[cat].forEach(function (i) {
                var gid = 'grp_' + safeId(i.parts ? i.parts.name : 'unk') + '_' + i.id.substring(0, 8);
                html += '<div class="install-row" style="cursor:pointer;margin-bottom:4px" onclick="toggleInstallHistory(\'' + gid + '\')">';
                var cpId = (i.parts && i.parts.catalog_part_id) ? i.parts.catalog_part_id : null;
                html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">';
                html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
                if (cpId) {
                    html += '<strong style="font-size:13px;cursor:pointer;color:var(--accent);text-decoration:underline dotted;text-underline-offset:3px" onclick="event.stopPropagation();showPartProfilePopup(\'' + cpId + '\')">' + esc(i.parts.name) + '</strong>';
                } else {
                    html += '<strong style="font-size:13px">' + esc(i.parts ? i.parts.name : 'Unknown') + '</strong>';
                }
                html += '<span class="badge badge-ok" style="font-size:10px">Active</span>';
                html += '<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 7px;line-height:1.4" title="Swap this part — marks this one removed and logs a fresh install in its place" onclick="event.stopPropagation();showSwapPartModal(\'' + i.id + '\',\'' + (cpId || '') + '\',\'' + esc(i.parts ? (i.parts.name || '') : '').replace(/\'/g, '&#39;') + '\')">&#x1F504; Swap</button>';
                html += '</div>';
                html += '<span style="font-size:11px;color:var(--text-muted)">' + (i.installed_date ? fmtDate(i.installed_date) : '-') + ' &#x25BC;</span>';
                html += '</div>';
                html += '<div id="' + gid + '" style="display:none;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;font-size:12px" onclick="event.stopPropagation()">';
                if (i.installed_mileage) html += '<div style="color:var(--text-muted)">@ ' + i.installed_mileage.toLocaleString() + ' mi</div>';
                if (i.parts) html += '<div style="color:var(--text-muted)">Condition: ' + esc(i.parts.condition || '-') + '  Part #: ' + esc(i.parts.part_number || '-') + '</div>';
                if (i.time_taken) html += '<div style="color:var(--text-muted)">Time taken: ' + esc(i.time_taken) + '</div>';
                if (i.notes) html += '<div style="color:var(--text-muted);margin-top:4px">' + esc(i.notes) + '</div>';
                if (!i.removed_date) {
                    html += '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">';
                    html += '<button class="btn btn-secondary btn-sm" title="Keeps this in your records — just marks the part as no longer active on this vehicle" onclick="event.stopPropagation();showRemovePartModal(\'' + i.id + '\')">Mark Removed</button>';
                    html += '<button class="btn btn-ghost btn-sm" title="Permanently delete this installation record — cannot be undone" onclick="event.stopPropagation();deleteInstallRecord(\'' + i.id + '\')">&#x1F5D1;&#xFE0F;</button>';
                    html += '</div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
        });
    }

    if (removed.length > 0) {
        html += '<div style="margin-top:16px">';
        html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted);margin-bottom:8px">Previously Installed (' + removed.length + ')</div>';
        removed.forEach(function (i) {
            var rid = 'rmv_' + i.id.substring(0, 8);
            html += '<div class="install-row" style="opacity:.6;cursor:pointer;margin-bottom:4px" onclick="toggleInstallHistory(\'' + rid + '\')">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center">';
            html += '<strong style="font-size:13px">' + esc(i.parts ? i.parts.name : 'Unknown') + '</strong>';
            html += '<span style="font-size:11px;color:var(--text-muted)">' + (i.removed_date ? fmtDate(i.removed_date) : '-') + ' &#x25BC;</span>';
            html += '</div>';
            html += '<div id="' + rid + '" style="display:none;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;font-size:12px" onclick="event.stopPropagation()">';
            html += '<div>Installed: ' + fmtDate(i.installed_date) + (i.installed_mileage ? ' @ ' + i.installed_mileage.toLocaleString() + ' mi' : '') + '</div>';
            html += '<div style="color:var(--danger)">Removed: ' + fmtDate(i.removed_date) + (i.removal_reason ? ' — ' + esc(i.removal_reason) : '') + '</div>';
            if (i.time_taken) html += '<div style="color:var(--text-muted)">Time: ' + esc(i.time_taken) + '</div>';
            html += '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" title="Permanently delete this installation record — cannot be undone" onclick="event.stopPropagation();deleteInstallRecord(\'' + i.id + '\')">&#x1F5D1;&#xFE0F; Delete Record</button></div>';
            html += '</div></div>';
        });
        html += '</div>';
    }
    return html;
}


function toggleInstallHistory(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function renderRemindersTab(reminders, vehicle, vehicleId) {
    var today = new Date();
    var html = '<div class="no-print" style="margin-bottom:14px;display:flex;gap:8px;align-items:center">';
    html += '<input type="text" class="form-control" id="rem-search" placeholder="&#x1F50D; Search reminders..." style="flex:1;font-size:13px" oninput="filterReminders(this.value)">';
    html += '<button class="btn btn-primary btn-sm" title="One-time task. When marked Done it logs a comment and removes from list." onclick="showReminderModal(_currentVehicleProfile.id,\'follow_up\')">+ Follow-up</button>';
    html += '<button class="btn btn-primary btn-sm" title="Repeating maintenance. When marked Done it recalculates next due date and stays on the list." onclick="showReminderModal(_currentVehicleProfile.id,\'routine\')">+ Routine</button>';
    html += '</div>';

    if (!reminders || reminders.length === 0) {
        return html + '<div class="empty-state"><div class="empty-icon">&#x23F0;</div><p>No maintenance reminders</p></div>';
    }

    // Split into Routine (auto + repeating) and Planned (one-off, follow-ups)
    var routine = reminders.filter(function (r) { return r.is_auto || r.is_routine; });
    var planned = reminders.filter(function (r) { return !r.is_auto && !r.is_routine; });

    function renderReminderCard(r) {
        var snoozed = r.snoozed_until_date && new Date(r.snoozed_until_date) > today;
        var overdue = !snoozed && ((r.next_due_date && new Date(r.next_due_date) <= today) || (r.next_due_mileage && (vehicle.current_mileage || 0) >= r.next_due_mileage));
        var cls = overdue ? 'overdue' : '';
        var sb = '';
        if (snoozed) sb = '<span class="badge badge-snoozed">Snoozed</span>';
        else if (overdue) sb = '<span class="badge badge-overdue">Overdue</span>';
        else if (r.next_due_date) {
            var d = (new Date(r.next_due_date) - today) / 86400000;
            if (d <= 30) { cls = 'due-soon'; sb = '<span class="badge badge-fair">Due in ' + Math.ceil(d) + 'd</span>'; }
        }

        // Frequency tooltip text for the info icon
        var freqText = '';
        if (r.interval_miles && r.interval_days) freqText = 'Every ' + r.interval_miles.toLocaleString() + ' mi or ' + r.interval_days + ' days';
        else if (r.interval_miles) freqText = 'Every ' + r.interval_miles.toLocaleString() + ' mi';
        else if (r.interval_days) freqText = 'Every ' + r.interval_days + ' days';
        else freqText = 'One-time';

        var c = '<div class="reminder-card ' + cls + '">';
        c += '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div style="flex:1">';
        c += '<div style="font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
        c += esc(r.title);
        c += '<span title="' + esc(freqText) + '" style="cursor:help;color:var(--text-muted);font-size:11px;border-bottom:1px dotted var(--text-muted);margin-left:2px">freq</span>';
        c += ' ' + sb + '</div>';
        if (r.description) c += '<div style="font-size:12px;color:var(--ku-blue);margin-top:4px">' + esc(r.description) + '</div>';

        // Days Until line + previous install date
        var daysUntilLine = '';
        if (r.next_due_date) {
            var diff = Math.ceil((new Date(r.next_due_date) - today) / 86400000);
            var color = diff < 0 ? '#cc2200' : (diff < 14 ? 'var(--warning)' : 'var(--text-muted)');
            daysUntilLine = '<span style="color:' + color + ';font-weight:600">Days Until: ' + diff + '</span> <span style="color:var(--text-muted)">(' + fmtDate(r.next_due_date) + ')</span>';
        } else if (r.next_due_mileage) {
            var mDiff = r.next_due_mileage - (vehicle.current_mileage || 0);
            var mColor = mDiff < 0 ? 'var(--danger)' : (mDiff < 500 ? 'var(--warning)' : 'var(--text-muted)');
            daysUntilLine = '<span style="color:' + mColor + ';font-weight:600">Miles Until: ' + mDiff.toLocaleString() + '</span>';
        }
        if (r.last_done_date) {
            daysUntilLine += (daysUntilLine ? ' &middot; ' : '') + '<span style="color:#5b8dd9">Last done: ' + fmtDate(r.last_done_date) + '</span>';
        }
        if (daysUntilLine) c += '<div style="font-size:12px;margin-top:6px">' + daysUntilLine + '</div>';

        c += '</div>';
        c += '<div class="flex-row no-print" style="flex-wrap:wrap;gap:4px">';
        c += '<button class="btn btn-secondary btn-sm" title="Delay this reminder until a later date or mileage" onclick="showSnoozeModal(\'' + r.id + '\',\'' + esc(r.title).replace(/\'/g, "&#39;") + '\')">Snooze</button>';
        c += '<button class="btn btn-secondary btn-sm" title="Mark as completed. Routine reminders will recur; follow-ups will be removed." onclick="markReminderDone(\'' + r.id + '\',_currentVehicleProfile.id,' + (vehicle.current_mileage || 0) + ')">Done</button>';
        c += '<button class="btn btn-ghost btn-sm" title="Permanently delete this reminder (cannot be undone)" onclick="deleteReminder(\'' + r.id + '\')">Del</button>';
        c += '</div></div></div>';
        return c;
    }

    // Routine section
    html += '<div style="margin-bottom:24px">';
    html += '<div class="stat-label" style="margin-bottom:10px;color:var(--accent);cursor:pointer;user-select:none" onclick="toggleSection(\'routine-section\')" title="Click to collapse/expand">&#x1F504; Routine (' + routine.length + ') <span id="routine-arrow" style="font-size:12px">&#x25BC;</span></div>';
    html += '<div id="routine-section">';
    if (routine.length === 0) {
        html += '<div style="font-size:13px;color:var(--text-muted);font-style:italic;padding:8px">No routine maintenance set up</div>';
    } else {
        routine.forEach(function (r) { html += renderReminderCard(r); });
    }
    html += '</div></div>';

    // Planned section
    html += '<div>';
    html += '<div class="stat-label" style="margin-bottom:10px;color:var(--info);cursor:pointer;user-select:none" onclick="toggleSection(\'planned-section\')" title="Click to collapse/expand">&#x1F4CC; Planned / Follow-ups (' + planned.length + ') <span id="planned-arrow" style="font-size:12px">&#x25BC;</span></div>';
    html += '<div id="planned-section">';
    if (planned.length === 0) {
        html += '<div style="font-size:13px;color:var(--text-muted);font-style:italic;padding:8px">No follow-ups planned</div>';
    } else {
        planned.forEach(function (r) { html += renderReminderCard(r); });
    }
    html += '</div></div>';

    return html;
}


async function printVehicleProfile(vehicleId) {
    // Prevent hashchange from navigating away while print tab is open
    _navigating = true;
    setTimeout(function () { _navigating = false; }, 2000);
    var { data: v } = await db.from('vehicles').select('*').eq('id', vehicleId).single();
    var [{ data: services }, { data: installs }] = await Promise.all([
        db.from('service_history').select('*').eq('vehicle_id', vehicleId).order('performed_date', { ascending: false }),
        db.from('part_installations').select('*,parts(name,part_number,condition,source,oem_part_number,price_paid)').eq('vehicle_id', vehicleId).order('installed_date', { ascending: false })
    ]);
    var active = (installs || []).filter(function (i) { return !i.removed_date; });

    // Extract specs from notes field (Engine, Transmission, Interior)
    var notes = v.notes || '';
    var engineMatch = notes.match(/Engine:\s*([^.,\n]+)/i);
    var transMatch = notes.match(/Trans(?:mission)?:\s*([^.,\n]+)/i);
    var interiorMatch = notes.match(/([A-Za-z]+)\s+interior/i);
    var engine = engineMatch ? engineMatch[1].trim() : '-';
    var transmission = transMatch ? transMatch[1].trim() : '-';
    var interior = interiorMatch ? interiorMatch[1] : '-';

    var w = window.open('', '_blank');
    w.document.write(`<html><head><title>${v.year} ${v.make} ${v.model} Profile</title>
<style>
body{font-family:Arial,sans-serif;padding:30px;color:#111;font-size:13px}
h1{font-size:24px;margin:0 0 4px;color:#0051BA}
h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #0051BA;padding-bottom:4px;margin:20px 0 12px;color:#0051BA}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;color:#111;border-bottom:1px solid #ddd;padding:5px 8px}
td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;color:#111}
.specs-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:16px}
.spec-item{font-size:12px}
.spec-label{font-size:10px;text-transform:uppercase;color:#666;letter-spacing:1px}
.footer{margin-top:30px;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:10px}
</style></head><body>
<div style="position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
<span style="font-size:11px;color:#666">Click Print, then close this tab</span>
<button onclick="window.print()" style="padding:8px 20px;background:#0051BA;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer;font-weight:600">🖨️ Print This</button>
</div>
<h1>🚗 ${v.year} ${v.make} ${v.model}${v.trim ? ' ' + v.trim : ''}</h1>
<div style="color:#E8000D;font-size:13px;margin-bottom:16px;font-weight:600">${[v.color, v.vin ? 'VIN: ' + v.vin : null].filter(Boolean).join(' · ')}</div>
<h2>Specs</h2>
<div class="specs-grid">
  <div class="spec-item"><div class="spec-label">Engine</div><div>${engine}</div></div>
  <div class="spec-item"><div class="spec-label">Transmission</div><div>${transmission}</div></div>
  <div class="spec-item"><div class="spec-label">Interior Color</div><div>${interior}</div></div>
  <div class="spec-item"><div class="spec-label">Current Mileage</div><div>${v.current_mileage ? v.current_mileage.toLocaleString() + ' mi' : '-'}</div></div>
</div>
<h2>Currently Installed Parts (${active.length})</h2>
${active.length === 0 ? '<p style="color:#999">None recorded</p>' : `
<table><thead><tr>
<th>Part</th><th>Part #</th><th>Condition</th><th>Installed</th><th>Mileage</th><th>Cost</th>
</tr></thead><tbody>
${active.map(function (i) { return '<tr><td><strong>' + (i.parts ? i.parts.name : 'Unknown') + '</strong></td><td>' + (i.parts && i.parts.part_number ? i.parts.part_number : '-') + '</td><td>' + (i.parts && i.parts.condition ? i.parts.condition : '-') + '</td><td>' + (i.installed_date ? new Date(i.installed_date + 'T12:00:00').toLocaleDateString() : '-') + '</td><td>' + (i.installed_mileage ? i.installed_mileage.toLocaleString() + ' mi' : '-') + '</td><td>' + (i.parts && i.parts.price_paid ? '$' + i.parts.price_paid : '-') + '</td></tr>'; }).join('')}
</tbody></table>`}
<h2>Service History (${(services || []).length} records)</h2>
${(!services || services.length === 0) ? '<p style="color:#999">None recorded</p>' : `
<table><thead><tr><th>Service</th><th>Date</th><th>Mileage</th><th>By</th></tr></thead><tbody>
${services.map(function (s) { return '<tr><td><strong>' + (s.service_type || '-') + '</strong></td><td>' + (s.performed_date ? new Date(s.performed_date + 'T12:00:00').toLocaleDateString() : '-') + '</td><td>' + (s.mileage_at_service ? s.mileage_at_service.toLocaleString() + ' mi' : '-') + '</td><td>' + (s.performed_by || '-') + '</td></tr>'; }).join('')}
</tbody></table>`}
<div class="footer">🐔 Chicken Zone Inventory Manager · ${new Date().toLocaleDateString()}</div>
</body></html>`);
    // Manual print via button — auto-print could freeze the parent window
}
