// ─── CHICKEN ZONE — parts.js — Auto Parts Page, Part Profile, Location Modal, Install Flow ──────
// Depends on: app.js

// ─── PART PROFILE - FULL PAGE VIEW ───────────────────────────────────────────
// (declared in foundation)

// Legacy wrapper so existing calls to showPartProfile still work
async function showPartProfile(id, type) {
    await showView('part-profile', { id: id, type: type || 'catalog' });
}


// Called from Compatible Vehicles tag click on part profile
// Finds oldest inventory item of this part and opens install modal for the given vehicle
async function startInstallForVehicle(vehicleId, cpId) {
    // Find inventory items for this catalog part, sorted oldest first
    var items = (_session.inventory || []).filter(function (p) { return p.catalog_part_id === cpId && p.quantity > 0; });
    items.sort(function (a, b) { return (a.date_acquired || '').localeCompare(b.date_acquired || ''); });
    if (items.length === 0) {
        toast('No inventory of this part to install - add one first', 'error');
        return;
    }
    var first = items[0];
    var cp = _catalog.find(function (p) { return p.id === cpId; });
    await showInstallPartModal(first.id, cpId, cp ? cp.name : first.name, first.condition || '', first.shelf_location || '');
    // Pre-select the vehicle after modal opens
    setTimeout(function () {
        var sel = document.getElementById('ip-vehicle');
        if (sel) sel.value = vehicleId;
    }, 100);
}

async function renderPartProfile(arg) {
    var myToken = Date.now();
    const el = document.getElementById('view-part-profile');
    if (!el) return;
    el.innerHTML = viewLoading('Loading part...');
    el.dataset.renderToken = myToken;

    const id = arg?.id;
    const type = arg?.type || 'catalog';
    _currentPartProfile = { id, name: _catalog.find(p => p.id === id)?.name || id, type };

    let cp = null, inv = [];
    if (type === 'catalog') {
        cp = _catalog.find(p => p.id === id);
        inv = dbInventory.filter(p => p.catalog_part_id === id);
    } else {
        const p = dbInventory.find(p => p.id === id);
        if (p) {
            cp = { id: p.id, name: p.name, cat: p.source || 'Custom', sub: '', oem: p.part_number || '', afm: p.oem_part_number || '', rank: 999, fits: 'all', desc: p.notes || '' };
            inv = [p];
        }
    }
    if (!cp) {
        el.innerHTML = '<div style="padding:60px;text-align:center;color:var(--danger)">Part not found. <button class="btn btn-secondary btn-sm" onclick="showView(\'parts\')">← Back to Parts</button></div>';
        return;
    }

    const realInv = inv.filter(function (p) { return !p.is_historical; });
    const totalQty = realInv.reduce((sum, p) => sum + p.quantity, 0);
    const topInv = inv.find(function (i) { return !i.is_historical && i.quantity > 0; }) || inv.find(function (i) { return !i.is_historical; }) || null;

    // Fetch installation history
    let installs = [];
    try {
        const r = await withTimeout(db.from('part_installations').select('*,vehicles(id,year,make,model,notes)').in('part_id', inv.length ? inv.map(p => p.id) : ['00000000-0000-0000-0000-000000000000']).order('installed_date', { ascending: false }));
        installs = r.data || [];
    } catch (e) { installs = []; }

    // Compatible vehicles - need to look them up from DB
    let vehiclesList = [];
    try {
        const rv = await withTimeout(db.from('vehicles').select('id,year,make,model,trim,notes').order('year'));
        vehiclesList = rv.data || [];
    } catch (e) { vehiclesList = []; }

    // Determine which actual vehicles are compatible
    const compatVehicles = vehiclesList.filter(v => {
        if (cp.fits === 'all') return true;
        if (cp.fits === 'esc') return v.make === 'Cadillac';
        if (cp.fits === 'yk') return v.make === 'GMC';
        return false;
    });

    const qrData = encodeURIComponent('CHICKEN ZONE\n' + cp.name + '\nOEM:' + (cp.oem || 'N/A') + '\nLoc:' + (topInv?.shelf_location || 'N/A'));
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=0f0f0f&color=FFD700&data=' + qrData;

    // Amazon search - detailed like YouTube
    const amazonQ = encodeURIComponent(cp.name + ' ' + (cp.oem || '') + ' GMT800 ' + (cp.fits === 'esc' ? 'Cadillac Escalade' : 'GMC Yukon Denali') + ' ' + cp.cat);
    const youtubeQ = encodeURIComponent(cp.name + ' GMT800 replacement install');

    // Get detail data (tools/hardware/time/tip) and extract any failure hints from description
    const pd = getPartDetail(cp.id) || null;

    // Extract common errors from description (the "X = bad Y" patterns)
    let commonErrors = [];
    if (cp.desc) {
        const hintRegex = /([^.]*=[^.]*\.)/g;
        const matches = cp.desc.match(hintRegex) || [];
        commonErrors = matches.map(m => m.trim()).filter(m => m.length > 5);
    }
    // Clean description without the hints
    let cleanDesc = cp.desc || '';
    commonErrors.forEach(e => { cleanDesc = cleanDesc.replace(e, '').trim(); });

    let html = '';

    // Hero section - dark banner like before but full-width
    html += '<div style="background:linear-gradient(135deg,#0a0a1a 0%,#151525 100%);margin:-32px -32px 24px -32px;padding:28px 32px;border-bottom:2px solid var(--accent)">';
    html += '<button class="btn btn-ghost btn-sm" onclick="showView(\'parts\')" style="margin-bottom:12px">← Back to Parts</button>';
    html += '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">';

    // Part photo / placeholder as button
    const photoBtnId = 'photo-btn-' + (topInv?.id || 'noinv');
    const photoInputId = 'photo-input-' + (topInv?.id || 'noinv');
    if (topInv?.id) {
        html += '<div id="' + photoBtnId + '" class="ms-pic" style="cursor:pointer" onclick="document.getElementById(\'' + photoInputId + '\').click()">';
        if (topInv.image_url) {
            html += '<img src="' + topInv.image_url + '" alt="part">';
        } else {
            html += '<div style="text-align:center;padding:10px"><div style="font-size:28px;opacity:.3">' + (CAT_ICONS[cp.cat] || '🔧') + '</div><div style="font-size:26px;color:var(--accent);line-height:1">+</div><div style="font-size:10px;color:var(--text-muted);font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Photo</div></div>';
        }
        html += '</div>';
        html += '<input type="file" id="' + photoInputId + '" accept="image/*" style="display:none" onchange="uploadPartPhotoFromProfile(\'' + topInv.id + '\',\'' + cp.id + '\',this.files[0])">';
    } else {
        html += '<div class="ms-pic" style="cursor:pointer" onclick="toast(\'Add this part to inventory first, then you can attach a photo\',\'info\')" title="Add part to inventory first">';
        html += '<div style="text-align:center;padding:10px"><div style="font-size:28px;opacity:.3">' + (CAT_ICONS[cp.cat] || '🔧') + '</div><div style="font-size:26px;color:var(--accent);line-height:1;opacity:.5">+</div><div style="font-size:10px;color:var(--text-muted);font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Photo</div></div>';
        html += '</div>';
    }

    html += '<div style="flex:1;min-width:250px">';
    html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
    html += '<div class="ms-part-name">' + esc(cp.name) + '</div>';
    if (_isAdmin) {
        html += '<button class="btn btn-ghost btn-sm" onclick="showCatalogEditModal(\'' + cp.id + '\')" title="Edit catalog info for this part type (admin only)" style="padding:2px 8px;font-size:11px">✏️ Edit</button>';
    }
    html += '</div>';
    html += '<div class="ms-part-cat">' + esc(cp.cat) + (cp.sub ? ' · ' + esc(cp.sub) : '') + '</div>';
    html += '<div class="ms-status-line">Status: <strong style="color:' + (totalQty > 0 ? 'var(--success)' : 'var(--danger)') + '">' + (totalQty > 0 ? totalQty + ' in stock' : 'Out of stock') + '</strong>';
    if (topInv?.shelf_location) html += ' · 📍 <strong>' + esc(topInv.shelf_location) + '</strong>';
    html += '</div>';
    if (cp.rank < 50) {
        html += '<div class="ms-status-line">Failure Rank: <strong style="color:var(--warning)" title="Parts ranked by how often they are replaced. Lower number = replaced more often. #1 is most common wear item.">#' + cp.rank + '</strong> <span style="font-size:11px;color:var(--text-muted)">(lower = replaced more often)</span></div>';
    }
    if (cleanDesc) html += '<div class="ms-status-line" style="margin-top:8px;font-size:12px;color:var(--text-muted)">' + esc(cleanDesc) + '</div>';
    html += '</div>';

    // Quick links + edit button
    html += '<div class="ms-contact-box" style="min-width:180px">';
    html += '<div class="ms-contact-title">Quick Links</div>';
    html += '<button class="ms-contact-btn" onclick="window.open(\'https://www.youtube.com/results?search_query=' + youtubeQ + '\',\'_blank\')">▶️ YouTube Guide</button>';
    html += '<button class="ms-contact-btn" onclick="window.open(\'https://www.amazon.com/s?k=' + amazonQ + '\',\'_blank\')">🛒 Amazon</button>';
    html += '<button class="ms-contact-btn" onclick="openRockAuto(\'' + cp.cat + '\',\'' + cp.fits + '\')">🔩 RockAuto</button>';
    if (topInv?.shop_url) html += '<button class="ms-contact-btn" onclick="window.open(\'' + topInv.shop_url + '\',\'_blank\')">🔗 Shop Link</button>';
    html += '</div>';
    html += '</div></div>';

    // Two column body — scrollable if content overflows
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:0 4px;max-height:calc(100vh - 320px);overflow-y:auto">';

    // LEFT COLUMN — Inventory Details, Part Numbers
    html += '<div>';

    // Inventory Details (always shown)
    if (inv.length > 0 && totalQty > 0) {
        html += '<div class="ms-box"><div class="ms-box-title">Inventory Details</div><div class="ms-box-body">';
        html += '<div class="ms-field"><span class="ms-field-label">Quantity</span><span class="ms-field-val" style="font-size:24px;font-family:\'Bebas Neue\',sans-serif;color:var(--accent)">' + totalQty + '</span></div>';
        html += '<div class="ms-field"><span class="ms-field-label">Condition</span><span class="ms-field-val">' + condBadge(topInv?.condition) + '</span></div>';
        html += '<div class="ms-field"><span class="ms-field-label">Source</span><span class="ms-field-val">' + esc(topInv?.source || '-') + '</span></div>';
        html += '<div class="ms-field"><span class="ms-field-label">Date Acquired</span><span class="ms-field-val">' + (topInv?.date_acquired ? fmtDate(topInv.date_acquired) : '-') + '</span></div>';
        if (topInv?.price_paid) html += '<div class="ms-field"><span class="ms-field-label">Paid</span><span class="ms-field-val" style="color:var(--success)">$' + topInv.price_paid + '</span></div>';
        if (topInv?.sourced_from_vehicle) html += '<div class="ms-field"><span class="ms-field-label">Intended For</span><span class="ms-field-val">' + esc(topInv.sourced_from_vehicle) + '</span></div>';
        html += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
        if (topInv?.receipt_url) html += '<a href="' + topInv.receipt_url + '" target="_blank" class="btn btn-secondary btn-sm">📄 Receipt</a>';
        html += '<button class="btn btn-secondary btn-sm" onclick="showEditInventoryModal(\'' + (topInv?.id || '') + '\',\'' + cp.id + '\')">✏️ Edit</button>';
        if (topInv?.condition === 'Used - Poor') {
            html += '<button class="btn btn-secondary btn-sm" onclick="wishlistCurrent()">⭐ Wishlist a replacement</button>';
        }
        html += '</div></div></div>';
    } else {
        html += '<div class="ms-box"><div class="ms-box-title">Not In Stock</div><div class="ms-box-body">';
        html += '<div style="color:var(--text-muted);font-size:13px;margin-bottom:12px">This part is not currently in your inventory.</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
        html += '<button class="btn btn-primary btn-sm" onclick="showAddSpecificPart(\'' + cp.id + '\')">+ Add to Inventory</button>';
        html += '<button class="btn btn-secondary btn-sm" onclick="wishlistCurrent()">⭐ Wishlist</button>';
        html += '</div></div></div>';
    }

    // Part Numbers box
    html += '<div class="ms-box"><div class="ms-box-title">Part Numbers</div><div class="ms-box-body">';
    if (cp.oem) {
        html += '<div class="part-num-row"><span class="part-num-type">OEM</span><span style="color:var(--text);font-family:\'Barlow Condensed\',sans-serif;font-size:14px;flex:1">' + esc(cp.oem) + '</span><span style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:' + (totalQty > 0 ? 'var(--success)' : 'var(--text-dim)') + '">×' + totalQty + '</span></div>';
    }
    if (cp.afm) html += '<div class="part-num-row"><span class="part-num-type">Aftermarket Ref</span><span style="color:var(--text-muted);font-size:12px">' + esc(cp.afm) + '</span></div>';
    if (!cp.oem) html += '<div style="color:var(--text-dim);font-size:12px">No OEM # on file</div>';
    html += '</div></div>';

    // Compatible Vehicles
    html += '<div class="ms-box"><div class="ms-box-title">Compatible Vehicles</div><div class="ms-box-body">';
    if (compatVehicles.length > 0) {
        compatVehicles.forEach(function (v) {
            const vName = getVehicleDisplayName(v);
            html += '<span class="compat-tag" style="cursor:pointer" onclick="startInstallForVehicle(\'' + v.id + '\',\'' + cp.id + '\')" title="Install a ' + esc(cp.name) + ' on this vehicle">🚗 ' + esc(vName) + '</span>';
        });
    } else {
        if (cp.fits === 'all') html += '<span class="compat-tag">🚗 All three cars</span>';
        else if (cp.fits === 'esc') html += '<span class="compat-tag">🚗 Jessie\'s Escalade</span>';
        else if (cp.fits === 'yk') html += '<span class="compat-tag">🚗 Both Denalis</span>';
    }
    html += '</div></div>';

    html += '</div>'; // end left column

    // RIGHT COLUMN — What You Need, Stock Locations, Common Errors, Notes, Install History
    html += '<div>';

    // What You Need
    if (pd) {
        html += '<div class="ms-box"><div class="ms-box-title" style="background:#8B0000">🔧 What You Need</div><div class="ms-box-body">';
        if (pd.time) html += '<div class="ms-field"><span class="ms-field-label">Est. Time</span><span class="ms-field-val" style="color:var(--accent)">' + pd.time + '</span></div>';
        if (pd.tools && pd.tools.length) {
            html += '<div style="margin-top:10px"><div style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Tools</div>';
            pd.tools.forEach(function (t) { html += '<div style="font-size:12px;padding:3px 0">• ' + esc(t) + '</div>'; });
            html += '</div>';
        }
        if (pd.hardware && pd.hardware.length) {
            html += '<div style="margin-top:10px"><div style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Also Buy</div>';
            pd.hardware.forEach(function (h) { html += '<div style="font-size:12px;padding:3px 0;color:var(--warning)">• ' + esc(h) + '</div>'; });
            html += '</div>';
        }
        if (pd.tip) html += '<div style="margin-top:12px;padding:10px;background:rgba(255,215,0,.06);border-left:3px solid var(--accent);font-size:12px;color:var(--text-muted)">💡 ' + esc(pd.tip) + '</div>';
        html += '</div></div>';
    }

    // Stock Locations
    if (inv.length > 0 && totalQty > 0) {
        html += '<div class="ms-box"><div class="ms-box-title">Stock Locations</div><div class="ms-box-body">';
        html += renderInvLocations(inv, cp.name, cp.oem || '');
        html += '</div></div>';
    }

    // Common Errors / Symptoms
    if (commonErrors.length > 0) {
        html += '<div class="ms-box"><div class="ms-box-title" style="background:#5a4a0a">⚠️ Common Errors / Symptoms</div><div class="ms-box-body">';
        commonErrors.forEach(function (e) {
            html += '<div style="font-size:12px;padding:4px 0;color:var(--text)">• ' + esc(e) + '</div>';
        });
        html += '</div></div>';
    }

    // Notes
    if (topInv?.notes) {
        html += '<div class="ms-box"><div class="ms-box-title">Notes</div><div class="ms-box-body" style="font-size:13px;color:var(--text-muted)">' + esc(topInv.notes) + '</div></div>';
    }

    // Installation History
    if (installs && installs.length > 0) {
        html += '<div class="ms-box"><div class="ms-box-title">Installation History</div><div class="ms-box-body">';
        installs.forEach(function (i) {
            html += '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">';
            html += '<div style="font-weight:600;color:var(--text)">' + (i.vehicles ? esc(getVehicleDisplayName(i.vehicles)) : 'Unknown Vehicle') + '</div>';
            html += '<div style="color:var(--text-muted)">Installed: ' + (i.installed_date ? fmtDate(i.installed_date) : '-') + (i.installed_mileage ? ' @ ' + i.installed_mileage.toLocaleString() + ' mi' : '') + (i.removed_date ? ' · Removed: ' + fmtDate(i.removed_date) : ' <span class="badge badge-ok" style="font-size:10px;margin-left:4px">Active</span>') + '</div>';
            if (i.removal_reason) html += '<div style="color:var(--danger);font-size:11px">' + esc(i.removal_reason) + '</div>';
            html += '</div>';
        });
        html += '</div></div>';
    }

    html += '</div>'; // end right column
    html += '</div>'; // end grid

    // Comments — full width below the grid
    html += '<div style="margin-top:24px;padding:0 4px" id="comments-part-' + id + '"></div>';

    if (String(el.dataset.renderToken) !== String(myToken)) return;
    el.innerHTML = html;
    renderComments('part', id, 'comments-part-' + id);
}

// Get display name for a vehicle from notes field (Driver: X format)
function addToWishlistQ(catalogId, evt) {
    const name = (evt?.target || event.target).closest('[data-name]')?.dataset?.name
        || _catalog.find(p => p.id === catalogId)?.name || 'Unknown Part';
    addToWishlistFromProfile(catalogId, name);
}
function goToVehicles() { closeModal(); showView('vehicles'); }
function wishlistCurrent() {
    // Open the wishlist modal pre-filled with the current part's info
    const cp = _catalog.find(function (p) { return p.id === _currentPartProfile.id; });
    addToWishlistFromProfile(_currentPartProfile.id, _currentPartProfile.name, cp);
}
async function addToWishlistFromProfile(catalogId, name, cp) {
    // Show the full wishlist modal pre-populated with catalog part data
    // Don't save silently - let the user set priority and destination
    const prefilledItem = {
        id: null, // new item
        name: name || cp?.name || '',
        part_number: cp?.oem || '',
        priority: '',
        compatible_vehicles: '',
        notes: 'Added from parts catalog'
    };
    // Temporarily stash pre-fill so showWishlistModal can use it
    window._wishlistPrefill = prefilledItem;
    // Open modal (no id = new item, but prefill will override)
    await showWishlistModalPrefilled(prefilledItem);
}

// Variant that takes an in-memory prefill object rather than fetching from DB
async

// ─── CUSTOM "ADD TO WISHLIST" PROMPT ────────────────────────────────────────────────────────
var _wishlistPromptName = '';
function showAddToWishlistPrompt(partName) {
    _wishlistPromptName = partName;
    var safeDisplay = esc(partName);
    showModal(
        '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
        '<div class="modal" style="max-width:400px">' +
        '<div class="modal-header"><div class="modal-title">Last One Used</div></div>' +
        '<div class="modal-body" style="padding:20px;text-align:center">' +
        '<div style="font-size:14px;line-height:1.5">You just installed your last <strong>' + safeDisplay + '</strong>.</div>' +
        '<div style="font-size:13px;color:var(--text-muted);margin-top:10px">Add it to your wishlist to remember to restock?</div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">No</button>' +
        '<button class="btn btn-primary" onclick="confirmAddToWishlist()">Yes, Add to Wishlist</button>' +
        '</div></div></div>'
    );
}

function confirmAddToWishlist() {
    var name = _wishlistPromptName;
    closeModal();
    showWishlistModalPrefilled({
        id: null, name: name, part_number: null,
        priority: 'High', compatible_vehicles: '',
        notes: 'Restocking - last unit installed'
    });
}

function showWishlistModalPrefilled(item) {
    const catalogNames = _catalog.map(function (p) { return p.name; });
    const customNames = (dbInventory || []).map(function (p) { return p.name; }).filter(function (n) { return n && !catalogNames.includes(n); });
    const allNames = catalogNames.concat(customNames);

    let html = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px">';
    html += '<div class="modal-header"><div class="modal-title">Add to Wishlist</div><button class="close-btn" onclick="closeModal()">×</button></div>';
    html += '<div class="modal-body">';
    html += '<div class="form-group"><label>Part Name *</label>';
    html += '<input type="text" class="form-control" id="w-name" value="' + esc(item.name || '') + '" list="w-name-list" oninput="onWishlistNameInput(this.value)" autocomplete="off">';
    html += '<datalist id="w-name-list">';
    allNames.forEach(function (n) { html += '<option value="' + esc(n) + '">'; });
    html += '</datalist></div>';
    html += '<div class="grid-2">';
    html += '<div class="form-group"><label>Part Number / OEM</label><input type="text" class="form-control" id="w-num" value="' + esc(item.part_number || '') + '"></div>';
    html += '<div class="form-group"><label>Priority *</label><select class="form-control" id="w-prio">';
    html += '<option value="">Choose...</option>';
    html += '<option value="High">🔴 High</option>';
    html += '<option value="Medium">🟡 Medium</option>';
    html += '<option value="Low">🟢 Low</option>';
    html += '</select></div>';
    html += '</div>';
    html += '<div class="form-group"><label>Destination *</label><select class="form-control" id="w-dest">';
    html += '<option value="">Choose...</option>';
    const dests = ["Nathan\'s 2004 Denali", "Cammy\'s 2005 Denali", "Jessie\'s 2004 Escalade", "Stock"];
    dests.forEach(function (d) {
        html += '<option value="' + d + '">' + (d === 'Stock' ? '📦 General Stock' : '🚗 ' + d) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-group"><label>Notes</label><textarea class="form-control" id="w-notes" rows="2">' + esc(item.notes || '') + '</textarea></div>';
    html += '</div>';
    html += '<div class="modal-footer">';
    html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="saveWishlistItem(null)">Add to Wishlist</button>';
    html += '</div></div></div>';
    showModal(html);
}
async function uploadPartPhotoFromProfile(invId, cpId, file) {
    if (!file) return;
    if (!invId) {
        // No inventory record yet - offer to add
        if (confirm('This part is not in your inventory yet. Add it to inventory first?')) {
            showAddSpecificPart(cpId);
        }
        return;
    }
    toast('Uploading...', 'info');
    try {
        const url = await uploadFile('parts-images', file);
        await db.from('parts').update({ image_url: url }).eq('id', invId);
        // Refresh inventory cache
        const { data: inv } = await db.from('parts').select('*');
        dbInventory = inv || [];
        toast('Photo saved!', 'success');
        // Re-render the full-page part profile
        await renderPartProfile({ id: cpId, type: 'catalog' });
    } catch (e) { toast('Upload error: ' + e.message, 'error'); }
}
function showCatalogEditModal(cpId) {
    const cp = _catalog.find(p => p.id === cpId) || {};
    const pd = getPartDetail(cpId) || { tools: [], hardware: [], time: '', tip: '' };
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:580px">
    <div class="modal-header"><div class="modal-title">✏️ Edit Part Info</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="alert alert-warning" style="margin-bottom:16px">⚠️ This is a <strong>universal change</strong>  -  updates this part type for all vehicles and all users.</div>
      <div class="grid-2">
        <div class="form-group"><label>Category</label><select class="form-control" id="ce-cat">${getCategories().map(c => `<option value="${esc(c)}" ${cp.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new__">+ New Category...</option></select></div>
        <div class="form-group"><label>Part Name</label><input class="form-control" id="ce-partname" value="${esc(cp.name || '')}"></div>
      </div>
      <div class="form-group"><label>Description</label><textarea class="form-control" id="ce-desc" rows="2">${esc(cp.desc || '')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label>OEM Part Number</label><input class="form-control" id="ce-oem" value="${esc(cp.oem || '')}"></div>
        <div class="form-group"><label>Aftermarket Reference</label><input class="form-control" id="ce-afm" value="${esc(cp.afm || '')}"></div>
      </div>
      <div class="form-group"><label>Estimated Swap Time</label><input class="form-control" id="ce-time" value="${esc(pd.time || '')}" placeholder="e.g. 1-2 hrs"></div>
      <div class="form-group"><label>Tools Needed (one per line)</label><textarea class="form-control" id="ce-tools" rows="4">${(pd.tools || []).join('\n')}</textarea></div>
      <div class="form-group"><label>Hardware / Also Buy (one per line)</label><textarea class="form-control" id="ce-hardware" rows="3">${(pd.hardware || []).join('\n')}</textarea></div>
      <div class="form-group"><label>Pro Tip</label><textarea class="form-control" id="ce-tip" rows="2">${esc(pd.tip || '')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCatalogEdit('${cpId}')">Save Changes</button>
    </div>
  </div></div>`);
}
async function saveCatalogEdit(cpId) {
    const cp = _catalog.find(p => p.id === cpId); if (!cp) return;
    cp.desc = document.getElementById('ce-desc').value.trim();
    cp.oem = document.getElementById('ce-oem').value.trim();
    cp.afm = document.getElementById('ce-afm').value.trim();
    // Handle category change (new category text or existing)
    var catSel = document.getElementById('ce-cat');
    if (catSel) {
        var newCat = catSel.value;
        if (newCat === '__new__') {
            var customCat = prompt('Enter new category name:');
            if (customCat && customCat.trim()) newCat = customCat.trim();
            else newCat = cp.cat; // cancelled — keep original
        }
        if (newCat) cp.cat = newCat;
    }
    var newName = document.getElementById('ce-partname') && document.getElementById('ce-partname').value.trim();
    if (newName) cp.name = newName;
    // Persist to Supabase
    await db.from('catalog_parts').update({ category: cp.cat, name: cp.name, description: cp.desc, oem_number: cp.oem, aftermarket_ref: cp.afm }).eq('id', cpId);
    invalidateCatalog();
    const tools = document.getElementById('ce-tools').value.split('\n').map(t => t.trim()).filter(Boolean);
    const hardware = document.getElementById('ce-hardware').value.split('\n').map(h => h.trim()).filter(Boolean);
    _partDetails[cpId] = { tools: tools, hardware: hardware, time: document.getElementById('ce-time').value.trim(), tip: document.getElementById('ce-tip').value.trim() };
    toast('Part info updated! (Changes last until page refresh - database persistence coming later)', 'success');
    closeModal();
    await renderPartProfile({ id: cpId, type: 'catalog' });
}
function openRockAuto(cat, fits) {
    const urls = { esc: 'https://www.rockauto.com/en/catalog/cadillac,2004,escalade,6.0l+v8', yk: 'https://www.rockauto.com/en/catalog/gmc,2005,yukon+denali,6.0l+v8', all: 'https://www.rockauto.com/en/catalog/gmc,2005,yukon+denali,6.0l+v8' };
    const catMap = { Engine: 'engine+%26+engine+cooling', Brakes: 'brakes+%26+traction+control', Suspension: 'steering+%26+suspension', Electrical: 'electrical', HVAC: 'heat+%26+air+conditioning', Transmission: 'transmission+%26+drivetrain', Maintenance: 'maintenance' };
    const base = urls[fits] || urls.all;
    window.open(base + (catMap[cat] ? ',' + catMap[cat] : ''), '_blank');
}
// ─── INVENTORY LOCATION RENDERER ─────────────────────────────────────────────
function renderInvLocations(inv, partName, partOem) {
    if (!inv || !inv.length) return "";
    var Q = String.fromCharCode(39); // single quote character
    return inv.map(function (item) {
        var hasLoc = !!item.shelf_location;
        var qrData = encodeURIComponent("CHICKEN ZONE\n" + partName + "\nOEM:" + (partOem || "N/A") + "\nLoc:" + (item.shelf_location || "N/A"));
        var qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=120x120&bgcolor=0f0f0f&color=FFD700&data=" + qrData;
        var html = "<div style=\"padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)\">";
        html += "<div style=\"display:flex;align-items:center;gap:8px;margin-bottom:6px\">";
        html += "<span style=\"font-family:Bebas Neue,sans-serif;font-size:20px;color:var(--accent)\">x" + item.quantity + "</span>";
        html += "<span style=\"flex:1;font-size:12px;color:var(--text-muted)\">" + (item.condition || "") + "</span>";
        if (hasLoc) {
            html += "<span style=\"font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:700;color:var(--text)\">&#x1F4CD; " + esc(item.shelf_location) + "</span>";
        } else {
            html += "<span style=\"font-size:12px;color:var(--danger)\">No location set</span>";
        }
        html += "</div>";
        html += "<div style=\"display:flex;gap:6px;flex-wrap:wrap\">";
        html += "<button class=\"btn btn-secondary btn-sm\" onclick=\"showLocationModal(" + Q + item.id + Q + ")\">&#x1F4CD; Set Location</button>";
        if (hasLoc) {
            html += "<a href=\"" + qrUrl + "\" download=\"part-label.png\" class=\"btn btn-ghost btn-sm\">&#x2B07;&#xFE0F; QR</a>";
            html += "<button class=\"btn btn-ghost btn-sm\" onclick=\"printPartLabel(" + Q + esc(partName).replace(/'/g, "&#39;") + Q + "," + Q + qrUrl + Q + "," + Q + esc(partOem) + Q + "," + Q + esc(item.shelf_location || "") + Q + ")\">&#x1F5A8;&#xFE0F; Print</button>";
        }
        if (item.quantity > 0) {
            html += "<button class=\"btn btn-primary btn-sm\" onclick=\"showInstallPartModal(" + Q + item.id + Q + ",null," + Q + esc(partName || "").replace(/'/g, "&#39;") + Q + "," + Q + esc(item.condition || "").replace(/'/g, "&#39;") + Q + "," + Q + esc(item.shelf_location || "").replace(/'/g, "&#39;") + Q + ")\" style=\"margin-top:4px;width:100%\">&#x1F527; Install on a Car</button>";
        }
        html += "</div></div>";
        return html;
    }).join("");
}

// ─── LOCATION MODAL ───────────────────────────────────────────────────────────
function showLocationModal(partId) {
    const locs = getLocations();
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div class="modal-title">Set Shelf Location</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="flex-row" style="gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="loc-option" onclick="showQRScanner('${partId}')"><div class="lo-icon">📷</div><div class="lo-label">Scan QR Label</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Brother label maker QR</div></div>
        <div class="loc-option" onclick="document.getElementById('loc-select-section').style.display='block'"><div class="lo-icon">📋</div><div class="lo-label">Select / Type</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Pick or enter location</div></div>
      </div>
      <div id="qr-section" style="display:none;margin-bottom:16px">
        <video id="qr-video" autoplay playsinline></video>
        <div id="qr-status" style="font-size:12px;color:var(--text-muted);margin-top:6px;text-align:center">Point camera at QR code on shelf label...</div>
        <canvas id="qr-canvas" style="display:none"></canvas>
      </div>
      <div id="loc-select-section" style="display:none">
        <div class="form-group">
          <label>Select Existing Location</label>
          <select class="form-control" id="loc-input">
            <option value="">Choose a location...</option>
            ${locs.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Don't see the right location? Use the QR scan option to scan a label from your Brother printer, which will add it automatically.</div>
        <button class="btn btn-primary" onclick="saveLocation('${partId}',document.getElementById('loc-input').value)">Save Location</button>
      </div>
    </div>
  </div></div>`);
}

async function showQRScanner(partId) {
    document.getElementById('qr-section').style.display = 'block';
    document.getElementById('loc-select-section').style.display = 'none';
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('qr-video');
        video.srcObject = cameraStream;
        scanQRLoop(partId);
    } catch (e) { document.getElementById('qr-status').textContent = 'Camera not available. Please use the select option.'; document.getElementById('loc-select-section').style.display = 'block' }
}

function scanQRLoop(partId) {
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    if (!canvas || !video || !cameraStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR && jsQR(img.data, img.width, img.height);
        if (code && code.data) {
            stopCamera();
            const loc = code.data.trim();
            document.getElementById('qr-status').textContent = `✅ Scanned: "${loc}"`;
            setTimeout(() => saveLocation(partId, loc), 600);
            return;
        }
    }
    requestAnimationFrame(() => scanQRLoop(partId));
}

async function saveLocation(partId, location) {
    if (!location) return toast('Please enter a location', 'error');
    const locs = getLocations(); if (!locs.includes(location)) { locs.push(location); saveLocations(locs) }
    const { error } = await db.from('parts').update({ shelf_location: location, scanned_to_location_at: new Date().toISOString() }).eq('id', partId);
    if (error) { toast(error.message, 'error'); return }
    toast('Location saved!', 'success'); closeModal();
    invalidate();
    getInventory().then(inv => { dbInventory = inv; renderPartsList(); });
}

function showAddLocationPrompt() {
    const name = prompt('Enter new location name (e.g. "Shelf C Bin 4"):');
    if (!name) return; const locs = getLocations(); if (!locs.includes(name)) { locs.push(name); saveLocations(locs) }
    const el = document.getElementById('loc-input'); if (el) el.value = name;
    const dl = document.getElementById('loc-list'); if (dl) dl.innerHTML = getLocations().map(l => `<option value="${esc(l)}">`).join('');
    toast('Location added!', 'success');
}

function showManageLocations() {
    const locs = getLocations();
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px">
    <div class="modal-header"><div class="modal-title">Shelf Locations</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">These are the shelf locations in the Chicken Zone. Add locations matching your Brother label maker QR codes.</p>
      ${locs.length === 0 ? '<div style="color:var(--text-dim);font-size:13px">No locations defined yet.</div>' : locs.map((l, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-family:\'Barlow Condensed\',sans-serif;font-size:15px">${esc(l)}</span><button class="btn btn-ghost btn-sm" onclick="deleteLocation(${i})">🗑️</button></div>`).join('')}
      <div style="margin-top:16px;display:flex;gap:8px">
        <input type="text" class="form-control" id="new-loc-input" placeholder="e.g. Shelf A Bin 1" style="flex:1">
        <button class="btn btn-primary btn-sm" onclick="addNewLoc()">Add</button>
      </div>
    </div>
  </div></div>`);
}
function addNewLoc() { const v = val('new-loc-input'); if (!v) return; const locs = getLocations(); if (!locs.includes(v)) { locs.push(v); saveLocations(locs) } toast('Location added', 'success'); showManageLocations() }
function deleteLocation(i) { const locs = getLocations(); locs.splice(i, 1); saveLocations(locs); showManageLocations() }

// ─── ADD PART CHOICE ──────────────────────────────────────────────────────────
function showAddPartChoice() {
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:460px">
    <div class="modal-header"><div class="modal-title">Add New Part to Inventory</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px">How would you like to add this part?</p>
      <div class="cat-grid">
        <div class="cat-btn" onclick="startAIScan()">
          <div class="cat-icon">🤖</div>
          <div class="cat-name">AI Scan</div>
          <div class="cat-count">Upload a receipt or photo  -  AI fills in the details</div>
        </div>
        <div class="cat-btn" onclick="startManualWizard()">
          <div class="cat-icon">🔍</div>
          <div class="cat-name">Manual Select</div>
          <div class="cat-count">Browse the GMT800 catalog by category and failure rate</div>
        </div>
      </div>
    </div>
  </div></div>`);
}

// ─── AI SCAN ──────────────────────────────────────────────────────────────────
function startAIScan() {
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><div class="modal-title">🤖 AI Receipt Scan</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px">Upload a photo of your receipt or enter the URL where you ordered the part. AI will extract the part name, number, price, and source automatically.</p>
      <div class="form-group"><label>Receipt Photo</label><input type="file" class="form-control" id="ai-receipt-file" accept="image/*,.pdf"></div>
      <div style="text-align:center;color:var(--text-dim);margin:8px 0"> -  or  - </div>
      <div class="form-group"><label>Order URL (Amazon, RockAuto, etc.)</label><input type="text" class="form-control" id="ai-url" placeholder="https://www.amazon.com/dp/..."></div>
      <div id="ai-status" style="display:none" class="alert alert-success">Analyzing receipt...</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="runAIScan()">🤖 Analyze</button>
    </div>
  </div></div>`);
}

async function runAIScan() {
    const file = document.getElementById('ai-receipt-file').files[0];
    const url = val('ai-url');
    if (!file && !url) return toast('Please upload a receipt or enter a URL', 'error');
    const statusEl = document.getElementById('ai-status');
    statusEl.style.display = 'block'; statusEl.textContent = '🤖 Analyzing receipt...';

    try {
        let imageData = null;
        if (file) {
            imageData = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file) });
        }
        const prompt = file ? `You are analyzing a parts receipt photo. Extract information and respond ONLY with valid JSON (no markdown, no backticks):
{"part_name":"","part_number":"","source":"","price":"","date_purchased":"","notes":""}
If you cannot determine a value, use empty string. Be concise.`
            : `The user ordered a part from this URL: ${url}
Extract any part info and respond ONLY with valid JSON (no markdown):
{"part_name":"","part_number":"","source":"","price":"","date_purchased":"","notes":""}`;

        const messages = [{ role: 'user', content: imageData ? [{ type: 'image', source: { type: 'base64', media_type: file.type, data: imageData } }, { type: 'text', text: prompt }] : [{ type: 'text', text: prompt }] }];
        const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages }) });
        const data = await resp.json();
        const raw = data.content?.[0]?.text || '{}';
        const extracted = JSON.parse(raw.replace(/```json?|```/g, '').trim());
        statusEl.textContent = '✅ Done! Review and complete the details below.';
        showAIConfirmForm(extracted, file);
    } catch (e) {
        statusEl.style.display = 'none';
        // Fallback: open manual form
        toast('AI scan unavailable  -  using manual form instead', 'info');
        startManualWizard();
    }
}

function showAIConfirmForm(extracted, receiptFile) {
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><div class="modal-title">✅ Review & Confirm</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="alert alert-success" style="margin-bottom:16px">AI extracted the details below  -  review and fill in anything missing.</div>
      <div class="grid-2">
        <div class="form-group" style="grid-column:1/-1"><label>Part Name *</label><input type="text" class="form-control" id="cf-name" value="${esc(extracted.part_name || '')}"></div>
        <div class="form-group"><label>Part Number</label><input type="text" class="form-control" id="cf-num" value="${esc(extracted.part_number || '')}"></div>
        <div class="form-group"><label>Price Paid</label><input type="text" class="form-control" id="cf-price" value="${esc(extracted.price || '')}"></div>
        <div class="form-group"><label>Source / Vendor</label><input type="text" class="form-control" id="cf-src" value="${esc(extracted.source || '')}"></div>
        <div class="form-group"><label>Date Purchased</label><input type="date" class="form-control" id="cf-date" value="${extracted.date_purchased || ''}"></div>
      </div>
      <div class="divider"></div>
      <div class="grid-2">
        <div class="form-group"><label>Condition *</label>
          <select class="form-control" id="cf-cond"><option value="">Select...</option><option>New</option><option>Used - Good</option><option>Used - Fair</option><option>Used - Poor</option></select>
        </div>
        <div class="form-group"><label>Quantity *</label><input type="number" class="form-control" id="cf-qty" value="1" min="1"></div>
      </div>
      <div class="form-group"><label>Additional Notes</label><textarea class="form-control" id="cf-notes" placeholder="Installation notes, observations, etc.">${esc(extracted.notes || '')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="showLowStockPrompt(null,'cf')">Next →</button>
    </div>
  </div></div>`);
    window._aiReceiptFile = receiptFile;
}

// ─── MANUAL WIZARD ────────────────────────────────────────────────────────────
function startManualWizard() { wizardStep = 1; wizardVehicle = null; wizardCat = null; wizardPart = null; renderWizard() }

function renderWizard() {
    const steps = ['Vehicle', 'Category', 'Part', 'Details'];
    const progress = steps.map((s, i) => `<div class="wizard-dot ${i < wizardStep ? 'done' : ''}"></div>`).join('');

    let body = '', footer = '';

    if (wizardStep === 1) {
        body = `<div class="wizard-step">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Which vehicle is this part for? (or select Any for all GMT800)</p>
      <div class="cat-grid">
        <div class="cat-btn ${wizardVehicle === 'all' ? 'sel' : ''}" onclick="wizardSelectVehicle('all')"><div class="cat-icon">🚗</div><div class="cat-name">All GMT800</div><div class="cat-count">All compatible parts</div></div>
        <div class="cat-btn ${wizardVehicle === 'esc' ? 'sel' : ''}" onclick="wizardSelectVehicle('esc')"><div class="cat-icon">👼</div><div class="cat-name">Jessie's Escalade</div><div class="cat-count">2004 Cadillac</div></div>
        <div class="cat-btn ${wizardVehicle === 'yk1' ? 'sel' : ''}" onclick="wizardSelectVehicle('yk1')"><div class="cat-icon">🤴</div><div class="cat-name">Nathan's Denali</div><div class="cat-count">2004 GMC</div></div>
        <div class="cat-btn ${wizardVehicle === 'yk2' ? 'sel' : ''}" onclick="wizardSelectVehicle('yk2')"><div class="cat-icon">👸</div><div class="cat-name">Cammy's Denali</div><div class="cat-count">2005 GMC</div></div>
      </div>
    </div>`;
        footer = `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" ${!wizardVehicle ? 'disabled' : ''} onclick="wizardStep=2;renderWizard()">Next →</button>`;
    }
    else if (wizardStep === 2) {
        const filteredCats = getCategories().filter(cat => { const parts = _catalog.filter(p => p.cat === cat && (wizardVehicle === 'all' || p.fits === 'all' || p.fits === (wizardVehicle === 'yk1' || wizardVehicle === 'yk2' ? 'yk' : wizardVehicle))); return parts.length > 0 });
        body = `<div class="wizard-step">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Select a part category:</p>
      <div class="cat-grid" style="max-height:360px;overflow-y:auto">
        ${filteredCats.map(cat => {
            const count = _catalog.filter(p => p.cat === cat && (wizardVehicle === 'all' || p.fits === 'all' || p.fits === (wizardVehicle === 'yk1' || wizardVehicle === 'yk2' ? 'yk' : wizardVehicle))).length;
            return `<div class="cat-btn ${wizardCat === cat ? 'sel' : ''}" onclick="wizardSelectCat('${cat}')"><div class="cat-icon">${CAT_ICONS[cat] || '🔧'}</div><div class="cat-name">${cat}</div><div class="cat-count">${count} parts</div></div>`;
        }).join('')}
      </div>
    </div>`;
        footer = `<button class="btn btn-secondary" onclick="wizardStep=1;renderWizard()">← Back</button><button class="btn btn-primary" ${!wizardCat ? 'disabled' : ''} onclick="wizardStep=3;renderWizard()">Next →</button>`;
    }
    else if (wizardStep === 3) {
        let catParts = _catalog.filter(p => p.cat === wizardCat && (wizardVehicle === 'all' || p.fits === 'all' || p.fits === (wizardVehicle === 'yk1' || wizardVehicle === 'yk2' ? 'yk' : wizardVehicle))).sort((a, b) => a.rank - b.rank);
        body = `<div class="wizard-step">
      <input type="text" class="search-input" id="wiz-search" placeholder="🔍 Search ${wizardCat} parts..." oninput="filterWizardParts(this.value)" style="width:100%;margin-bottom:14px">
      <div id="wiz-parts" style="max-height:340px;overflow-y:auto">
        ${catParts.map(p => `<div class="part-suggestion ${wizardPart?.id === p.id ? 'selected' : ''}" onclick="wizardSelectPart('${p.id}')">
          <div class="ps-name">${esc(p.name)} ${p.rank <= 20 ? `<span class="ps-rank">#${p.rank} most replaced</span>` : ''}</div>
          <div class="ps-meta">OEM: ${esc(p.oem || ' - ')} · ${esc(p.desc ? p.desc.substring(0, 80) + '...' : '')}</div>
        </div>`).join('')}
      </div>
    </div>`;
        footer = `<button class="btn btn-secondary" onclick="wizardStep=2;renderWizard()">← Back</button><button class="btn btn-primary" ${!wizardPart ? 'disabled' : ''} onclick="wizardStep=4;renderWizard()">Next →</button>`;
    }
    else if (wizardStep === 4) {
        body = `<div class="wizard-step">
      <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
        <strong style="color:var(--accent)">${esc(wizardPart?.name)}</strong><br>
        <span style="color:var(--text-muted)">OEM: ${esc(wizardPart?.oem || ' - ')}</span>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Purchased Part # (if different from OEM)</label><input type="text" class="form-control" id="wz-partnum" placeholder="${esc(wizardPart?.oem || '')}"></div>
        <div class="form-group"><label>Alt OEM / Aftermarket Cross Ref</label><input type="text" class="form-control" id="wz-oem2" placeholder="${esc(wizardPart?.afm || '')}"></div>
        <div class="form-group"><label>Condition *</label>
          <select class="form-control" id="wz-cond"><option value="">Select...</option><option>New</option><option>Used - Good</option><option>Used - Fair</option><option>Used - Poor</option></select>
        </div>
        <div class="form-group"><label>Quantity *</label><input type="number" class="form-control" id="wz-qty" value="1" min="1"></div>
        <div class="form-group"><label>Source</label><input type="text" class="form-control" id="wz-src" placeholder="RockAuto, Amazon, Junkyard..."></div>
        <div class="form-group"><label>Date Acquired</label><input type="date" class="form-control" id="wz-date" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group"><label>Price Paid</label><input type="text" class="form-control" id="wz-price" placeholder="$0.00"></div>
        <div class="form-group"><label>Intended For Vehicle</label>
        <select class="form-control" id="wz-from">
          <option value="">Select or leave blank for stock...</option>
          <option value="Nathan's 2004 Denali">Nathan's 2004 Denali</option>
          <option value="Cammy's 2005 Denali">Cammy's 2005 Denali</option>
          <option value="Jessie's 2004 Escalade">Jessie's 2004 Escalade</option>
          <option value="Stock">Add to General Stock</option>
        </select>
      </div>
      </div>
      <div class="form-group"><label>Notes</label><textarea class="form-control" id="wz-notes" placeholder="Any notes about this part..."></textarea></div>
      <div class="form-group"><label>Receipt / Photo</label><input type="file" class="form-control" id="wz-file" accept="image/*,.pdf"></div>
      <div class="form-group"><label>Part Photo</label><input type="file" class="form-control" id="wz-img" accept="image/*"></div>
    </div>`;
        footer = `<button class="btn btn-secondary" onclick="wizardStep=3;renderWizard()">← Back</button><button class="btn btn-primary" onclick="showLowStockPrompt('wizard','wz')">Next →</button>`;
    }

    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:580px">
    <div class="modal-header"><div class="modal-title" style="display:flex;flex-direction:column;gap:2px"><span>Add Part to Inventory</span><span style="font-size:12px;color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">Step ${wizardStep} of 4  -  ${['', 'Vehicle', 'Category', 'Select Part', 'Details'][wizardStep]}</span></div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="wizard-progress">${progress}</div>
      ${body}
    </div>
    <div class="modal-footer">${footer}</div>
  </div></div>`);
}

function wizardSelectVehicle(v) { wizardVehicle = v; renderWizard() }
function wizardSelectCat(c) { wizardCat = c; renderWizard() }
function wizardSelectPart(id) { wizardPart = _catalog.find(p => p.id === id); renderWizard() }
function filterWizardParts(search) {
    const s = search.toLowerCase();
    const container = document.getElementById('wiz-parts');
    if (!container) return;
    const parts = _catalog.filter(p => p.cat === wizardCat && (wizardVehicle === 'all' || p.fits === 'all' || p.fits === (wizardVehicle === 'yk1' || wizardVehicle === 'yk2' ? 'yk' : wizardVehicle)) && (p.name.toLowerCase().includes(s) || p.oem.toLowerCase().includes(s) || p.desc.toLowerCase().includes(s))).sort((a, b) => a.rank - b.rank);
    container.innerHTML = parts.map(p => `<div class="part-suggestion ${wizardPart?.id === p.id ? 'selected' : ''}" onclick="wizardSelectPart('${p.id}')"><div class="ps-name">${esc(p.name)} ${p.rank <= 20 ? `<span class="ps-rank">#${p.rank} most replaced</span>` : ''}</div><div class="ps-meta">OEM: ${esc(p.oem || ' - ')} · ${esc(p.desc ? p.desc.substring(0, 80) + '...' : '')}</div></div>`).join('');
}

// ─── LOW STOCK PROMPT → SAVE ──────────────────────────────────────────────────
function showLowStockPrompt(source, prefix) {
    const name = val(`${prefix}-name`) || wizardPart?.name || '';
    // Snapshot ALL form values before modal is replaced
    window._lsSource = source; window._lsPrefix = prefix;
    window._wizSnap = {
        cond: val('wz-cond'),
        qty: parseInt(document.getElementById('wz-qty')?.value) || 1,
        partnum: val('wz-partnum'),
        oem2: val('wz-oem2'),
        src: val('wz-src'),
        date: val('wz-date'),
        price: val('wz-price'),
        from: val('wz-from'),
        notes: val('wz-notes'),
        cfName: val('cf-name'),
        cfCond: val('cf-cond'),
        cfQty: parseInt(document.getElementById('cf-qty')?.value) || 1,
        cfNum: val('cf-num'),
        cfSrc: val('cf-src'),
        cfDate: val('cf-date'),
        cfPrice: val('cf-price'),
        cfNotes: val('cf-notes'),
    };
    showModal(`<div class="modal-overlay"><div class="modal" style="max-width:400px">
    <div class="modal-header"><div class="modal-title">Low Stock Alert</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Do you want to be notified when <strong style="color:var(--text)">${esc(name)}</strong> runs low?</p>
      <div class="flex-row" style="gap:12px;margin-bottom:20px">
        <div class="loc-option" id="ls-yes" onclick="document.getElementById('ls-qty-row').style.display='flex';this.style.borderColor='var(--accent)';document.getElementById('ls-no').style.borderColor='var(--border)'"><div class="lo-icon">🔔</div><div class="lo-label">Yes, alert me</div></div>
        <div class="loc-option" id="ls-no" onclick="savePartFromWizard(window._lsSource,window._lsPrefix,null)"><div class="lo-icon">🔕</div><div class="lo-label">No alert needed</div></div>
      </div>
      <div id="ls-qty-row" style="display:none;align-items:center;gap:12px">
        <div class="form-group" style="flex:1;margin-bottom:0"><label>Alert when qty reaches</label><input type="number" class="form-control" id="ls-threshold" value="1" min="0"></div>
        <button class="btn btn-primary" style="margin-top:20px" onclick="savePartFromWizard(window._lsSource,window._lsPrefix,parseInt(document.getElementById('ls-threshold').value)||1)">Save Part</button>
      </div>
    </div>
  </div></div>`);
}

async function savePartFromWizard(source, prefix, lowStockThreshold) {
    let data = { created_by: currentUser.id, low_stock_threshold: lowStockThreshold === null ? null : lowStockThreshold };
    let receiptFile = null, imgFile = null;

    const snap = window._wizSnap || {};
    if (source === 'wizard') {
        if (!wizardPart) return toast('No part selected', 'error');
        const cond = snap.cond || val('wz-cond');
        const qty = snap.qty || parseInt(document.getElementById('wz-qty')?.value) || 1;
        if (!cond) return toast('Please select a condition', 'error');
        data = {
            ...data, catalog_part_id: wizardPart.id, name: wizardPart.name,
            part_number: snap.partnum || val('wz-partnum') || wizardPart.oem || null,
            oem_part_number: snap.oem2 || val('wz-oem2') || wizardPart.afm || null,
            condition: cond, quantity: qty,
            source: snap.src || val('wz-src') || null,
            date_acquired: snap.date || val('wz-date') || null,
            price_paid: parseFloat(snap.price || val('wz-price')) || null,
            sourced_from_vehicle: snap.from || val('wz-from') || null,
            notes: snap.notes || val('wz-notes') || null,
            compatible_vehicles: wizardPart.fits === 'all' ? "Nathan's 2004 Denali, Cammy's 2005 Denali, Jessie's 2004 Escalade" : wizardPart.fits === 'esc' ? "Jessie's 2004 Escalade" : "Nathan's 2004 Denali, Cammy's 2005 Denali"
        };
        receiptFile = document.getElementById('wz-file')?.files[0];
        imgFile = document.getElementById('wz-img')?.files[0];
    } else {
        const name = snap.cfName || val('cf-name');
        const cond = snap.cfCond || val('cf-cond');
        const qty = snap.cfQty || parseInt(document.getElementById('cf-qty')?.value) || 1;
        if (!name) return toast('Part name is required', 'error');
        if (!cond) return toast('Please select a condition', 'error');
        data = {
            ...data, name,
            part_number: snap.cfNum || val('cf-num') || null,
            source: snap.cfSrc || val('cf-src') || null,
            date_acquired: snap.cfDate || val('cf-date') || null,
            price_paid: parseFloat(snap.cfPrice || val('cf-price')) || null,
            notes: snap.cfNotes || val('cf-notes') || null,
            condition: cond, quantity: qty
        };
        receiptFile = window._aiReceiptFile;
    }

    try {
        if (receiptFile) data.receipt_url = await uploadFile('receipts', receiptFile);
        if (imgFile) data.image_url = await uploadFile('parts-images', imgFile);
    } catch (e) { toast('Upload error: ' + e.message, 'error'); return }

    const { error } = await db.from('parts').insert(data);
    if (error) { toast(error.message, 'error'); return }
    toast('Part added to inventory! 🎉', 'success');
    window._aiReceiptFile = null;
    closeModal();
    invalidate();
    getInventory().then(inv => { dbInventory = inv; renderPartsList(); });
}

// ─── ADD SPECIFIC PART (from profile) ────────────────────────────────────────
function showAddSpecificPart(catalogId) {
    wizardPart = _catalog.find(p => p.id === catalogId);
    if (!wizardPart) return;
    wizardStep = 4; wizardVehicle = 'all'; wizardCat = wizardPart.cat;
    closeModal(); setTimeout(renderWizard, 50);
}

async function showEditInventoryModal(invId, catalogId) {
    if (!invId) return showAddSpecificPart(catalogId);
    const { data: p } = await db.from('parts').select('*').eq('id', invId).single();
    if (!p) return;
    const cp = _catalog.find(x => x.id === catalogId);
    showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><div class="modal-title">Edit Inventory Record</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="grid-2">
        <div class="form-group"><label>Part Number (Purchased)</label><input type="text" class="form-control" id="ep-num" value="${esc(p.part_number || cp?.oem || '')}"></div>
        <div class="form-group"><label>Alt OEM / Cross Ref</label><input type="text" class="form-control" id="ep-oem2" value="${esc(p.oem_part_number || cp?.afm || '')}"></div>
        <div class="form-group"><label>Condition</label><select class="form-control" id="ep-cond"><option value="">Select...</option>${['New', 'Used - Good', 'Used - Fair', 'Used - Poor'].map(c => `<option ${p.condition === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label>Quantity</label><input type="number" class="form-control" id="ep-qty" value="${p.quantity}" min="0"></div>
        <div class="form-group"><label>Source</label><input type="text" class="form-control" id="ep-src" value="${esc(p.source || '')}"></div>
        <div class="form-group"><label>Price Paid</label><input type="text" class="form-control" id="ep-price" value="${esc(p.price_paid || '')}"></div>
        <div class="form-group"><label>Date Acquired</label><input type="date" class="form-control" id="ep-date" value="${p.date_acquired || ''}"></div>
        <div class="form-group"><label>Low Stock Alert At</label><input type="number" class="form-control" id="ep-low" value="${p.low_stock_threshold || 1}" min="0"></div>
      </div>
      <div class="form-group"><label>Intended For Vehicle</label>
        <select class="form-control" id="ep-from">
          <option value="">General Stock</option>
          <option value="Nathan's 2004 Denali" ${p.sourced_from_vehicle === "Nathan's 2004 Denali" ? 'selected' : ''}>Nathan's 2004 Denali</option>
          <option value="Cammy's 2005 Denali" ${p.sourced_from_vehicle === "Cammy's 2005 Denali" ? 'selected' : ''}>Cammy's 2005 Denali</option>
          <option value="Jessie's 2004 Escalade" ${p.sourced_from_vehicle === "Jessie's 2004 Escalade" ? 'selected' : ''}>Jessie's 2004 Escalade</option>
        </select>
      </div>
      <div class="form-group"><label>Shop URL</label><input type="text" class="form-control" id="ep-shop" value="${esc(p.shop_url || '')}" placeholder="https://..."></div>
      <div class="form-group"><label>Notes</label><textarea class="form-control" id="ep-notes">${esc(p.notes || '')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label>Update Receipt</label><input type="file" class="form-control" id="ep-receipt" accept="image/*,.pdf">${p.receipt_url ? `<a href="${p.receipt_url}" target="_blank" style="font-size:12px;color:var(--accent)">View current</a>` : ''}</div>
        <div class="form-group"><label>Update Part Photo</label><input type="file" class="form-control" id="ep-img" accept="image/*"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger btn-sm" onclick="confirmDeleteInv('${p.id}','${esc(p.name)}')">🗑️ Delete</button>
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditInventory('${p.id}')">Save Changes</button>
    </div>
  </div></div>`);
}

async function saveEditInventory(id) {
    let data = { part_number: val('ep-num') || null, oem_part_number: val('ep-oem2') || null, condition: val('ep-cond') || null, quantity: parseInt(document.getElementById('ep-qty').value) || 0, source: val('ep-src') || null, price_paid: parseFloat(val('ep-price')) || null, date_acquired: val('ep-date') || null, low_stock_threshold: parseInt(document.getElementById('ep-low').value) || 1, sourced_from_vehicle: val('ep-from') || null, shop_url: val('ep-shop') || null, notes: val('ep-notes') || null };
    const rf = document.getElementById('ep-receipt').files[0]; const imgf = document.getElementById('ep-img').files[0];
    try { if (rf) data.receipt_url = await uploadFile('receipts', rf); if (imgf) data.image_url = await uploadFile('parts-images', imgf) } catch (e) { toast('Upload error', 'error'); return }
    const { error } = await db.from('parts').update(data).eq('id', id);
    if (error) { toast(error.message, 'error'); return }
    toast('Updated!', 'success'); closeModal();
    // Update in-memory cache without a new Supabase fetch
    _session.inventory = null; // will re-fetch on next renderPartsPage
    // (cache cleared)
    // (no localStorage cache to clear)
    dbInventory = await getInventory();
    renderPartsList();
}

async function confirmDeleteInv(id, name) {
    if (!confirm('Remove "' + name + '" from inventory?')) return;
    const { error } = await db.from('parts').delete().eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
    // Remove from in-memory cache immediately without hitting Supabase again
    _session.inventory = (_session.inventory || []).filter(function (p) { return p.id !== id; });
    // (cache cleared)
    dbInventory = _session.inventory;
    // Save updated cache to localStorage right away
    try {
        var stored = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        // (no localStorage cache)
    } catch (e) { }
    toast('Removed from inventory', 'success');
    closeModal();
    renderPartsList();
}

function printPartLabel(name, qrUrl, oem, location) {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Label</title><style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;padding:20px;background:#fff}.label{border:2px solid #000;padding:14px;width:280px;text-align:center;border-radius:4px}h2{font-size:14px;margin:8px 0 3px;font-weight:bold}p{font-size:11px;margin:2px 0;color:#444}.footer{font-size:9px;color:#999;margin-top:8px}</style></head><body ><div style="position:fixed;top:10px;right:10px"><button onclick="window.print()" style="padding:6px 14px;background:#0051BA;color:#fff;border:0;border-radius:4px;font-size:12px;cursor:pointer;font-weight:600">🖨️ Print</button></div><div class="label"><img src="${qrUrl}" width="120" height="120"><h2>${name}</h2>${oem ? `<p><strong>OEM:</strong> ${oem}</p>` : ''}${location ? `<p><strong>Loc:</strong> ${location}</p>` : ''}<p class="footer">🐔 Chicken Zone</p></div></body></html>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
