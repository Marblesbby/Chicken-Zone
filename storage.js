// ─── CHICKEN ZONE — storage.js — Storage View & Location Management ──────────
// Depends on: app.js, parts.js (saveLocation, getLocations, saveLocations)

// ─── ZONE DEFINITIONS ─────────────────────────────────────────────────────────
var ZONE_INFO = {
    'WS': { label: 'Wood Shelves',      icon: '🪵', desc: 'Left wall, near door — 2 shelves + floor space under' },
    'BR': { label: 'Black Rack',         icon: '⬛', desc: 'Left wall, toward back — 7 shelves' },
    'GB': { label: 'Gray Rack (Back)',   icon: '🔩', desc: 'Back wall, left side — 7 shelves, touches BR corner' },
    'WB': { label: 'Wire Rack (Back)',   icon: '🔲', desc: 'Back wall, right side — 5 shelves, particle board' },
    'CW': { label: 'Cup Wall',           icon: '🥤', desc: 'Right wall, near door — small and large clear cups' },
    'WR': { label: 'Wire Rack (Right)',  icon: '📦', desc: 'Right wall, toward back — 5 shelves, no wood' }
};

var ZONE_HINTS = {
    'WS': 'WS-TOP · WS-MID · WS-FLOOR (tall items under the shelves)',
    'BR': 'BR-1 (top) through BR-7 (bottom)',
    'GB': 'GB-1 (top) through GB-7 (bottom)',
    'WB': 'WB-1 (top) through WB-5 (bottom)',
    'CW': 'CW-S-R1-01 thru CW-S-R3-12  (small) · CW-L-01 thru CW-L-09  (large)',
    'WR': 'WR-1 (top) through WR-5 (bottom)'
};

// ─── SESSION CACHE ─────────────────────────────────────────────────────────────
// _session.locations is declared in app.js alongside the other session keys

async function getStorageLocations() {
    if (_session.locations) return _session.locations;
    var r = await withTimeout(db.from('storage_locations').select('*').order('zone_code').order('display_order').order('name'));
    if (r.error) throw new Error(r.error.message);
    _session.locations = r.data || [];
    return _session.locations;
}

function invalidateLocations() { _session.locations = null; }

// ─── STORAGE PAGE ─────────────────────────────────────────────────────────────
async function renderStoragePage() {
    var el = document.getElementById('view-storage');
    if (!el) return;
    if (!_session.locations) el.innerHTML = viewLoading('Loading storage...');

    try {
        var results = await Promise.all([getStorageLocations(), getInventory()]);
        var locations = results[0];
        var inv = results[1].filter(function(p) { return !p.is_historical; });

        function partsAt(locName) {
            return inv.filter(function(p) { return p.shelf_location === locName; });
        }

        // Group by zone
        var byZone = {};
        Object.keys(ZONE_INFO).forEach(function(z) { byZone[z] = []; });
        locations.forEach(function(loc) {
            if (!byZone[loc.zone_code]) byZone[loc.zone_code] = [];
            byZone[loc.zone_code].push(loc);
        });

        var usedLocs = locations.filter(function(l) { return partsAt(l.name).length > 0; }).length;
        var role = getEffectiveRole();

        var html = maybeShowTesterBanner();
        html += '<div class="page-header"><div>';
        html += '<div class="page-title">Storage</div>';
        html += '<div class="page-subtitle">' + usedLocs + ' of ' + locations.length + ' locations in use</div>';
        html += '</div>';
        if (role !== 'viewer') {
            html += '<button class="btn btn-primary" onclick="showAddLocationModal()">+ Add Location</button>';
        }
        html += '</div>';

        // ── ZONE CARDS ────────────────────────────────────────────────────────
        Object.keys(ZONE_INFO).forEach(function(zCode) {
            var zone = ZONE_INFO[zCode];
            var locs = byZone[zCode] || [];
            var usedInZone = locs.filter(function(l) { return partsAt(l.name).length > 0; }).length;

            html += '<div class="card" style="margin-bottom:16px">';

            // Zone header row
            html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:' + (locs.length ? '14' : '4') + 'px;flex-wrap:wrap">';
            html += '<div style="font-size:22px">' + zone.icon + '</div>';
            html += '<div style="flex:1;min-width:0">';
            html += '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:var(--text)">' + zCode + ' — ' + zone.label + '</div>';
            html += '<div style="font-size:11px;color:var(--text-muted)">' + zone.desc + '</div>';
            html += '</div>';
            if (locs.length > 0) {
                html += '<div style="font-size:12px;color:var(--text-muted);white-space:nowrap">' + usedInZone + ' / ' + locs.length + ' used</div>';
            }
            if (role !== 'viewer') {
                html += '<button class="btn btn-secondary btn-sm" onclick="showAddLocationModal(\'' + zCode + '\')">+ Slot</button>';
            }
            html += '</div>';

            if (locs.length === 0) {
                html += '<div style="font-size:12px;color:var(--text-dim);font-style:italic">No slots added yet — click + Slot to set one up.</div>';
            } else {
                html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:8px">';
                locs.forEach(function(loc) {
                    var parts = partsAt(loc.name);
                    var hasStuff = parts.length > 0;
                    var totalQty = parts.reduce(function(s, p) { return s + (p.quantity || 0); }, 0);

                    html += '<div style="border:1px solid ' + (hasStuff ? 'rgba(255,215,0,.25)' : 'var(--border)') + ';border-radius:8px;padding:10px 12px;background:' + (hasStuff ? 'rgba(255,215,0,.03)' : 'transparent') + '">';

                    // Location name + actions
                    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:' + (hasStuff ? '8' : '2') + 'px">';
                    html += '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:15px;font-weight:700;color:' + (hasStuff ? 'var(--accent)' : 'var(--text-dim)') + '">' + esc(loc.name) + '</span>';
                    if (loc.display_name) {
                        html += '<span style="font-size:10px;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(loc.display_name) + '">' + esc(loc.display_name) + '</span>';
                    } else {
                        html += '<span style="flex:1"></span>';
                    }
                    if (_isAdmin && getEffectiveRole() === 'admin') {
                        html += '<button onclick="deleteStorageLocation(\'' + loc.id + '\',\'' + esc(loc.name) + '\')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:11px;padding:0;line-height:1;flex-shrink:0" title="Delete location">🗑️</button>';
                    }
                    html += '</div>';

                    // Notes (shown on empty slots)
                    if (!hasStuff && loc.notes) {
                        html += '<div style="font-size:10px;color:var(--text-muted);font-style:italic;margin-bottom:4px">' + esc(loc.notes) + '</div>';
                    }

                    if (hasStuff) {
                        html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:5px">' + parts.length + ' type' + (parts.length !== 1 ? 's' : '') + ' · ' + totalQty + ' total qty</div>';
                        parts.slice(0, 4).forEach(function(p) {
                            var cpId = p.catalog_part_id || p.id;
                            var cpType = p.catalog_part_id ? 'catalog' : 'custom';
                            html += '<div style="font-size:12px;padding:3px 0;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.04)">';
                            html += '<span style="color:var(--text);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px" onclick="showPartProfile(\'' + esc(cpId) + '\',\'' + cpType + '\')" title="' + esc(p.name) + '">' + esc(p.name) + '</span>';
                            html += '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;color:var(--accent);flex-shrink:0;margin-left:6px">×' + p.quantity + '</span>';
                            html += '</div>';
                        });
                        if (parts.length > 4) {
                            html += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">+ ' + (parts.length - 4) + ' more</div>';
                        }
                    } else {
                        html += '<div style="font-size:11px;color:var(--text-dim)">Empty</div>';
                    }

                    html += '</div>';
                });
                html += '</div>';
            }

            html += '</div>';
        });

        // ── UNREGISTERED LOCATIONS ────────────────────────────────────────────
        // Parts that have a shelf_location string not in storage_locations
        var knownNames = {};
        locations.forEach(function(l) { knownNames[l.name] = true; });
        var orphaned = inv.filter(function(p) { return p.shelf_location && !knownNames[p.shelf_location]; });
        if (orphaned.length > 0) {
            var orphanGroups = {};
            orphaned.forEach(function(p) {
                var loc = p.shelf_location;
                if (!orphanGroups[loc]) orphanGroups[loc] = [];
                orphanGroups[loc].push(p);
            });

            html += '<div class="card" style="margin-bottom:16px;border-left:3px solid var(--warning)">';
            html += '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1px;margin-bottom:8px;color:var(--warning)">⚠️ Unregistered Locations</div>';
            html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">These parts have a location that hasn\'t been added to the storage system yet.</div>';
            Object.keys(orphanGroups).forEach(function(locName) {
                var parts = orphanGroups[locName];
                html += '<div style="padding:7px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
                html += '<span style="font-family:\'Barlow Condensed\',sans-serif;font-size:14px;font-weight:700;color:var(--warning);white-space:nowrap">' + esc(locName) + '</span>';
                html += '<span style="font-size:12px;color:var(--text-muted);flex:1">' + parts.map(function(p) { return esc(p.name); }).join(', ') + '</span>';
                if (role !== 'viewer') {
                    html += '<button class="btn btn-secondary btn-sm" style="flex-shrink:0" onclick="showAddLocationModalForName(\'' + esc(locName) + '\')">Register</button>';
                }
                html += '</div>';
            });
            html += '</div>';
        }

        el.innerHTML = html;
    } catch (err) {
        el.innerHTML = errBox(err.message);
        console.error('renderStoragePage error:', err);
    }
}

// ─── ADD LOCATION MODAL ───────────────────────────────────────────────────────

function showAddLocationModal(preselectedZone) {
    _openAddLocationModal(preselectedZone, null);
}

function showAddLocationModalForName(existingName) {
    // Try to auto-detect zone from the name prefix
    var zone = null;
    Object.keys(ZONE_INFO).forEach(function(z) {
        if (existingName && existingName.toUpperCase().startsWith(z)) zone = z;
    });
    _openAddLocationModal(zone, existingName);
}

function _openAddLocationModal(preselectedZone, prefillName) {
    var zoneOpts = Object.keys(ZONE_INFO).map(function(z) {
        return '<option value="' + z + '"' + (z === preselectedZone ? ' selected' : '') + '>' + z + ' — ' + ZONE_INFO[z].label + '</option>';
    }).join('');

    showModal(
        '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:440px">' +
        '<div class="modal-header"><div class="modal-title">Add Storage Location</div><button class="close-btn" onclick="closeModal()">×</button></div>' +
        '<div class="modal-body">' +
        '<div class="form-group"><label>Zone *</label>' +
        '<select class="form-control" id="sl-zone" onchange="updateSlotHint()">' + zoneOpts + '</select></div>' +
        '<div class="form-group"><label>Location Code *</label>' +
        '<input type="text" class="form-control" id="sl-name" value="' + esc(prefillName || '') + '" placeholder="e.g. BR-3" oninput="this.value=this.value.toUpperCase()">' +
        '<div id="sl-hint" style="font-size:11px;color:var(--text-muted);margin-top:5px"></div></div>' +
        '<div class="form-group"><label>Friendly Name <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>' +
        '<input type="text" class="form-control" id="sl-display" placeholder="e.g. Top shelf, left side"></div>' +
        '<div class="form-group"><label>Notes <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>' +
        '<input type="text" class="form-control" id="sl-notes" placeholder="e.g. Fluids only, heavy items"></div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveStorageLocation()">Add Location</button>' +
        '</div></div></div>'
    );

    setTimeout(function() {
        updateSlotHint();
        // Pre-fill code prefix if name field is empty
        if (!prefillName) {
            var nameEl = document.getElementById('sl-name');
            var zoneEl = document.getElementById('sl-zone');
            if (nameEl && zoneEl && !nameEl.value) {
                var z = zoneEl.value;
                var prefixes = { 'WS': 'WS-', 'BR': 'BR-', 'GB': 'GB-', 'WB': 'WB-', 'CW': 'CW-', 'WR': 'WR-' };
                nameEl.value = prefixes[z] || '';
                nameEl.focus();
                var len = nameEl.value.length;
                nameEl.setSelectionRange(len, len);
            }
        }
    }, 50);
}

function updateSlotHint() {
    var zoneEl = document.getElementById('sl-zone');
    var hint = document.getElementById('sl-hint');
    if (!zoneEl || !hint) return;
    hint.textContent = ZONE_HINTS[zoneEl.value] || '';
    // If name is still at prefix-only stage, update it to new zone's prefix
    var nameEl = document.getElementById('sl-name');
    if (nameEl) {
        var prefixes = { 'WS': 'WS-', 'BR': 'BR-', 'GB': 'GB-', 'WB': 'WB-', 'CW': 'CW-', 'WR': 'WR-' };
        var allPrefixes = Object.values(prefixes);
        // Only auto-update if the field is empty or contains only a zone prefix
        if (!nameEl.value || allPrefixes.indexOf(nameEl.value) >= 0) {
            nameEl.value = prefixes[zoneEl.value] || '';
            var len = nameEl.value.length;
            nameEl.setSelectionRange(len, len);
        }
    }
}

async function saveStorageLocation() {
    var zone = val('sl-zone');
    var name = val('sl-name').toUpperCase();
    var display = val('sl-display');
    var notes = val('sl-notes');
    if (!zone) return toast('Select a zone', 'error');
    if (!name) return toast('Location code is required', 'error');
    if (!name.startsWith(zone + '-') && name !== zone + '-') {
        return toast('Location code must start with ' + zone + '- (e.g. ' + zone + '-1)', 'error');
    }

    var existing = (_session.locations || []).find(function(l) { return l.name === name; });
    if (existing) return toast('"' + name + '" already exists', 'error');

    var r = await db.from('storage_locations').insert({
        zone_code: zone, name: name,
        display_name: display || null,
        notes: notes || null,
        display_order: 0,
        created_by: currentUser.id
    }).select().single();

    if (r.error) { toast(r.error.message, 'error'); return; }

    // Keep localStorage in sync so legacy picker still works
    var locs = getLocations();
    if (!locs.includes(name)) { locs.push(name); saveLocations(locs); }

    toast(name + ' added!', 'success');
    invalidateLocations();
    closeModal();
    if (_currentView === 'storage') {
        await renderStoragePage();
    }
}

async function deleteStorageLocation(id, name) {
    var partsHere = (_session.inventory || []).filter(function(p) {
        return p.shelf_location === name && !p.is_historical;
    });
    var msg = partsHere.length > 0
        ? partsHere.length + ' part record(s) are stored at "' + name + '". Delete anyway? Those parts will lose their location.'
        : 'Delete location "' + name + '"?';
    if (!confirm(msg)) return;

    var r = await db.from('storage_locations').delete().eq('id', id);
    if (r.error) { toast(r.error.message, 'error'); return; }

    // Sync localStorage
    var locs = getLocations().filter(function(l) { return l !== name; });
    saveLocations(locs);

    toast('Location deleted', 'success');
    invalidateLocations();
    await renderStoragePage();
}

// ─── UPDATED LOCATION MODAL ───────────────────────────────────────────────────
// This replaces the version defined in parts.js (storage.js loads after, so it wins)
// Now pulls locations from Supabase, grouped by zone

async function showLocationModal(partId) {
    // Show a quick loading state first
    showModal(
        '<div class="modal-overlay"><div class="modal" style="max-width:460px">' +
        '<div class="modal-header"><div class="modal-title">Set Shelf Location</div>' +
        '<button class="close-btn" onclick="closeModal()">×</button></div>' +
        '<div class="modal-body" style="padding:32px;text-align:center;color:var(--text-muted)">Loading locations...</div>' +
        '</div></div>'
    );

    try {
        var locations = await getStorageLocations();

        // Group by zone for the select
        var byZone = {};
        Object.keys(ZONE_INFO).forEach(function(z) { byZone[z] = []; });
        locations.forEach(function(loc) {
            if (!byZone[loc.zone_code]) byZone[loc.zone_code] = [];
            byZone[loc.zone_code].push(loc);
        });

        var optgroups = Object.keys(ZONE_INFO).map(function(z) {
            var locs = byZone[z] || [];
            if (locs.length === 0) return '';
            return '<optgroup label="' + z + ' — ' + ZONE_INFO[z].label + '">' +
                locs.map(function(l) {
                    var label = esc(l.name) + (l.display_name ? ' — ' + esc(l.display_name) : '');
                    return '<option value="' + esc(l.name) + '">' + label + '</option>';
                }).join('') +
                '</optgroup>';
        }).join('');

        var hasLocations = locations.length > 0;

        showModal(
            '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:460px">' +
            '<div class="modal-header"><div class="modal-title">Set Shelf Location</div><button class="close-btn" onclick="closeModal()">×</button></div>' +
            '<div class="modal-body">' +
            '<div class="flex-row" style="gap:12px;margin-bottom:20px;flex-wrap:wrap">' +
            '<div class="loc-option" onclick="showQRScanner(\'' + partId + '\')"><div class="lo-icon">📷</div><div class="lo-label">Scan QR Label</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Point at a shelf QR code</div></div>' +
            '<div class="loc-option" onclick="document.getElementById(\'loc-select-section\').style.display=\'block\'"><div class="lo-icon">📋</div><div class="lo-label">Pick from List</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Choose an existing slot</div></div>' +
            '</div>' +
            '<div id="qr-section" style="display:none;margin-bottom:16px">' +
            '<video id="qr-video" autoplay playsinline></video>' +
            '<div id="qr-status" style="font-size:12px;color:var(--text-muted);margin-top:6px;text-align:center">Point camera at QR code on shelf label...</div>' +
            '<canvas id="qr-canvas" style="display:none"></canvas>' +
            '</div>' +
            '<div id="loc-select-section" style="display:none">' +
            (hasLocations
                ? '<div class="form-group"><label>Select Location</label>' +
                  '<select class="form-control" id="loc-input"><option value="">Choose a location...</option>' + optgroups + '</select></div>' +
                  '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn btn-primary" onclick="saveLocation(\'' + partId + '\',document.getElementById(\'loc-input\').value)">Save Location</button>' +
                  '<button class="btn btn-ghost btn-sm" onclick="showAddLocationModal()">+ New Location</button>' +
                  '</div>'
                : '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">No storage locations set up yet.</div>' +
                  '<button class="btn btn-primary" onclick="showAddLocationModal()">+ Add First Location</button>'
            ) +
            '</div>' +
            '</div></div></div>'
        );
    } catch (e) {
        toast('Could not load locations: ' + e.message, 'error');
        closeModal();
    }
}
