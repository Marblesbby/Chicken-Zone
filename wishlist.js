// ─── CHICKEN ZONE — wishlist.js — Wishlist, Print, Historical Install ─────────────────────────
// Depends on: app.js

// ─── WISHLIST ─────────────────────────────────────────────────────────────────
// ─── WISHLIST PAGE ───────────────────────────────────────────────────────────
async function renderWishlist(){
  const el=document.getElementById('view-wishlist');
  el.innerHTML=viewLoading();

  let items=[];
  try{
    if(!_session.wishlist) el.innerHTML=viewLoading('Loading wishlist...');
    items=await getWishlist();
  }catch(err){
    el.innerHTML=errBox(err.message, err.stack);
    console.error(err);
    return;
  }

  // Sort: unfound items first, then by priority (High/Medium/Low)
  const prioRank={High:0, Medium:1, Low:2};
  items.sort(function(a,b){
    if(a.found !== b.found) return a.found ? 1 : -1;
    const pa = prioRank[a.priority]!==undefined ? prioRank[a.priority] : 99;
    const pb = prioRank[b.priority]!==undefined ? prioRank[b.priority] : 99;
    return pa - pb;
  });

  let html=maybeShowTesterBanner()+'<div class="page-header"><div><div class="page-title">Wishlist</div><div class="page-subtitle">Find, Buy, Succeed!</div></div><button class="btn btn-primary" onclick="showWishlistModal()">+ Add Item</button></div>';

  if(!items || items.length===0){
    html+='<div class="empty-state"><div class="empty-icon">⭐</div><p>Wishlist is empty</p></div>';
  } else {
    items.forEach(function(item){
      // Figure out if this item matches a catalog part (for clickability)
      const catalogPart = _catalog.find(function(p){
        return p.name===item.name || (item.part_number && (p.oem===item.part_number));
      });
      const oem = item.part_number || catalogPart?.oem || '';
      const dest = item.compatible_vehicles || 'Stock';
      const fits = catalogPart?.fits || 'all';

      html+='<div class="wishlist-item" style="'+(item.found?'opacity:.5':'')+'"><div style="flex:1">';

      // Clickable title if catalog match exists
      const titleStyle = catalogPart ? 'cursor:pointer;color:var(--accent)' : '';
      const titleClick = catalogPart ? 'onclick="showView(\'part-profile\',{id:\''+catalogPart.id+'\',type:\'catalog\'})"' : '';
      html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">';
      html+='<strong style="font-size:15px;'+titleStyle+'" '+titleClick+'>'+esc(item.name)+'</strong>';
      if(item.priority) html+='<span class="badge badge-'+item.priority.toLowerCase()+'">'+item.priority+'</span>';
      if(item.found) html+='<span class="badge badge-ok">✓ Found</span>';
      html+='</div>';

      // OEM under title
      if(oem) html+='<div style="font-size:12px;color:var(--text-muted);font-family:\'Barlow Condensed\',sans-serif">OEM #: '+esc(oem)+'</div>';

      // Only show compatibility note if NOT fits=all (i.e., only when it matters)
      if(catalogPart && fits !== 'all'){
        const compatNote = fits==='esc' ? 'Only fits Jessie\'s Escalade' : fits==='yk' ? 'Only fits the Denalis' : '';
        if(compatNote) html+='<div style="font-size:12px;color:var(--warning);margin-top:3px">⚠️ '+compatNote+'</div>';
      }

      // Destination
      html+='<div style="font-size:12px;color:var(--text-muted);margin-top:3px">📍 For: <strong style="color:var(--text)">'+esc(dest)+'</strong></div>';

      // Notes
      if(item.notes) html+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px;font-style:italic">'+esc(item.notes)+'</div>';

      // Action buttons
      html+='<div class="flex-row" style="margin-top:10px;flex-wrap:wrap;gap:6px">';
      const amzQ = encodeURIComponent(item.name+' '+(oem||'')+' GMT800 '+(fits==='esc'?'Cadillac Escalade':'GMC Yukon Denali'));
      html+='<button class="btn btn-secondary btn-sm" onclick="window.open(\'https://www.amazon.com/s?k='+amzQ+'\',\'_blank\')">🛒 Amazon</button>';
      if(catalogPart){
        html+='<button class="btn btn-secondary btn-sm" onclick="openRockAuto(\''+catalogPart.cat+'\',\''+catalogPart.fits+'\')">🔩 RockAuto</button>';
      } else {
        html+='<button class="btn btn-secondary btn-sm" onclick="openRockAuto(\'\',\'all\')">🔩 RockAuto</button>';
      }
      if(!item.found){
        html+='<button class="btn btn-primary btn-sm" onclick="foundWishlistItem(\''+item.id+'\')">✅ Found It</button>';
      }
      html+='</div></div>';

      // Edit/delete column
      html+='<div class="flex-row" style="flex-direction:column;gap:4px;align-items:flex-end">';
      html+='<button class="btn btn-ghost btn-sm" onclick="showWishlistModal(\''+item.id+'\')" title="Edit">✏️</button>';
      html+='<button class="btn btn-ghost btn-sm" onclick="deleteWishlistItem(\''+item.id+'\')" title="Delete">🗑️</button>';
      html+='</div></div>';
    });
  }

  el.innerHTML=html;
}


// ─── WISHLIST MODAL ──────────────────────────────────────────────────────────

function updateWishlistPartList(){
  var cat = document.getElementById('w-cat') ? document.getElementById('w-cat').value : '';
  var sel = document.getElementById('w-name');
  if(!sel) return;
  if(!cat){
    sel.innerHTML = '<option value="">Select a category first...</option>';
    return;
  }
  var parts = _catalog.filter(function(p){ return p.cat === cat; });
  var opts = '<option value="">Select part...</option>';
  parts.forEach(function(p){
    opts += '<option value="'+esc(p.name)+'" data-oem="'+esc(p.oem)+'">'+esc(p.name)+'</option>';
  });
  sel.innerHTML = opts;
  document.getElementById('w-num').value = '';
}

function updateWishlistOEM(){
  var sel = document.getElementById('w-name');
  var numEl = document.getElementById('w-num');
  if(!sel || !numEl) return;
  var opt = sel.options[sel.selectedIndex];
  if(opt && opt.dataset && opt.dataset.oem){
    numEl.value = opt.dataset.oem;
  }
}

async function showWishlistModal(id){
  let item=null;
  if(id){
    const{data}=await db.from('wishlist').select('*').eq('id',id).single();
    item=data;
  }

  // Build category options
  var cats = getCategories();
  var catOpts = '<option value="">Select a category...</option>';
  cats.forEach(function(c){ catOpts += '<option value="'+esc(c)+'"'+(item && item._cat===c?' selected':'')+'>'+esc(c)+'</option>'; });

  // If editing, find which category the item belongs to
  var itemCat = '';
  if(item && item.name){
    var matchPart = _catalog.find(function(p){ return p.name === item.name; });
    if(matchPart) itemCat = matchPart.cat;
  }

  // Build initial part name options based on category (or all if editing)
  var partOpts = '<option value="">Select a category first...</option>';
  if(itemCat){
    partOpts = '<option value="">Select part...</option>';
    _catalog.filter(function(p){ return p.cat === itemCat; }).forEach(function(p){
      partOpts += '<option value="'+esc(p.name)+'" data-oem="'+esc(p.oem)+'"'+(item && item.name===p.name?' selected':'')+'>'+esc(p.name)+'</option>';
    });
  }

  let html='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px">';
  html+='<div class="modal-header"><div class="modal-title">'+(item?'Edit Wishlist Item':'Add to Wishlist')+'</div><button class="close-btn" onclick="closeModal()">×</button></div>';
  html+='<div class="modal-body">';

  // Part Type dropdown first
  html+='<div class="form-group"><label>Part Type *</label>';
  html+='<select class="form-control" id="w-cat" onchange="updateWishlistPartList()">';
  html+=catOpts+'</select></div>';

  // Part Name dropdown (filtered by type)
  html+='<div class="form-group"><label>Part Name *</label>';
  html+='<select class="form-control" id="w-name" onchange="updateWishlistOEM()">';
  html+=partOpts+'</select></div>';

  // Set initial category value for editing
  if(itemCat) html+='<script>document.getElementById("w-cat").value="'+esc(itemCat)+'";</scr'+'ipt>';

  // Part number (will auto-populate when catalog name picked)
  html+='<div class="grid-2">';
  html+='<div class="form-group"><label>Part Number / OEM</label><input type="text" class="form-control" id="w-num" value="'+esc(item?.part_number||'')+'" placeholder="Auto-filled when you pick a catalog part"></div>';

  // Priority - no default
  html+='<div class="form-group"><label>Priority *</label><select class="form-control" id="w-prio">';
  html+='<option value="">Choose...</option>';
  html+='<option value="High"'+(item?.priority==='High'?' selected':'')+'>🔴 High</option>';
  html+='<option value="Medium"'+(item?.priority==='Medium'?' selected':'')+'>🟡 Medium</option>';
  html+='<option value="Low"'+(item?.priority==='Low'?' selected':'')+'>🟢 Low</option>';
  html+='</select></div>';
  html+='</div>';

  // Destination
  html+='<div class="form-group"><label>Destination *</label><select class="form-control" id="w-dest">';
  html+='<option value="">Choose...</option>';
  const dests=["Nathan's 2004 Denali","Cammy's 2005 Denali","Jessie's 2004 Escalade","Stock"];
  dests.forEach(function(d){
    html+='<option value="'+d+'"'+(item?.compatible_vehicles===d?' selected':'')+'>'+(d==='Stock'?'📦 General Stock':'🚗 '+d)+'</option>';
  });
  html+='</select></div>';

  // Notes
  html+='<div class="form-group"><label>Notes</label><textarea class="form-control" id="w-notes" rows="2">'+esc(item?.notes||'')+'</textarea></div>';

  html+='</div>';
  html+='<div class="modal-footer">';
  html+='<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
  html+='<button class="btn btn-primary" onclick="saveWishlistItem('+(item?"'"+item.id+"'":'null')+')">'+(item?'Save':'Add to Wishlist')+'</button>';
  html+='</div></div></div>';

  showModal(html);
}

// Auto-fill OEM when user picks a catalog part from datalist
function onWishlistNameInput(name){
  if(!name) return;
  const match = _catalog.find(function(p){return p.name===name;});
  if(match){
    const numField = document.getElementById('w-num');
    if(numField && !numField.value) numField.value = match.oem || '';
  }
}


// ─── SAVE WISHLIST ITEM ──────────────────────────────────────────────────────
async function saveWishlistItem(id){
  var nameEl = document.getElementById('w-name');
  const name = nameEl ? (nameEl.tagName === 'SELECT' ? (nameEl.options[nameEl.selectedIndex] ? nameEl.options[nameEl.selectedIndex].value : '') : nameEl.value.trim()) : '';
  if(!name) return toast('Part name required','error');
  const priority = val('w-prio');
  if(!priority) return toast('Please pick a priority','error');
  const dest = val('w-dest');
  if(!dest) return toast('Please pick a destination','error');

  const data = {
    name: name,
    part_number: val('w-num') || null,
    priority: priority,
    compatible_vehicles: dest,
    notes: val('w-notes') || null
  };

  let error;
  if(id){
    ({error} = await db.from('wishlist').update(data).eq('id',id));
  } else {
    data.created_by = currentUser.id;
    ({error} = await db.from('wishlist').insert(data));
  }
  if(error){ toast(error.message,'error'); return; }
  toast(id?'Updated!':'Added to wishlist!','success');
  invalidateWishlist();
  closeModal();
  await renderWishlist();
}


// ─── FOUND IT FLOW - shortened add-to-inventory, then remove from wishlist ──
async function foundWishlistItem(wishlistId){
  // Fetch wishlist item data
  const {data:item} = await db.from('wishlist').select('*').eq('id',wishlistId).single();
  if(!item){ toast('Wishlist item not found','error'); return; }

  // Try to match a catalog part
  const catalogPart = _catalog.find(function(p){
    return p.name===item.name || (item.part_number && p.oem===item.part_number);
  });

  // Store context for the save handler
  window._foundWishlistId = wishlistId;
  window._foundWishlistItem = item;
  window._foundCatalogPart = catalogPart;

  // Build a shortened form - pre-fill with wishlist info, only ask for condition/cost
  let html = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:520px">';
  html += '<div class="modal-header"><div class="modal-title">✅ Found It — Add to Inventory</div><button class="close-btn" onclick="closeModal()">×</button></div>';
  html += '<div class="modal-body">';

  html += '<div class="alert alert-success" style="margin-bottom:16px">Nice find! Fill in the remaining details below. Info from your wishlist has been pre-filled.</div>';

  // Pre-filled info display with edit toggle
  html += '<div id="found-info-display" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:16px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
  html += '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted)">From Your Wishlist</div>';
  html += '<button class="btn btn-ghost btn-sm" onclick="toggleFoundEditMode()" style="padding:2px 6px" title="Edit if anything was filled in wrong">✏️ Edit</button>';
  html += '</div>';
  html += '<div style="font-size:15px;font-weight:600;margin-bottom:4px">'+esc(item.name)+'</div>';
  if(item.part_number) html += '<div style="font-size:12px;color:var(--text-muted)">OEM #: '+esc(item.part_number)+'</div>';
  html += '<div style="font-size:12px;color:var(--text-muted)">For: '+esc(item.compatible_vehicles||'Stock')+'</div>';
  html += '</div>';

  // Editable (hidden by default) fields for the pre-filled info
  html += '<div id="found-info-edit" style="display:none;margin-bottom:16px">';
  html += '<div class="form-group"><label>Part Name</label><input type="text" class="form-control" id="fd-name" value="'+esc(item.name)+'"></div>';
  html += '<div class="grid-2">';
  html += '<div class="form-group"><label>Part Number / OEM</label><input type="text" class="form-control" id="fd-num" value="'+esc(item.part_number||'')+'"></div>';
  html += '<div class="form-group"><label>Destination</label><select class="form-control" id="fd-dest">';
  const dests=["Nathan's 2004 Denali","Cammy's 2005 Denali","Jessie's 2004 Escalade","Stock"];
  dests.forEach(function(d){
    html+='<option value="'+d+'"'+(item.compatible_vehicles===d?' selected':'')+'>'+d+'</option>';
  });
  html += '</select></div>';
  html += '</div>';
  html += '</div>';

  // Required fields - condition + qty + cost
  html += '<div class="grid-2">';
  html += '<div class="form-group"><label>Condition *</label><select class="form-control" id="fd-cond">';
  html += '<option value="">Choose...</option>';
  ['New','Used - Good','Used - Fair','Used - Poor'].forEach(function(c){
    html+='<option>'+c+'</option>';
  });
  html += '</select></div>';
  html += '<div class="form-group"><label>Quantity *</label><input type="number" class="form-control" id="fd-qty" value="1" min="1"></div>';
  html += '</div>';

  html += '<div class="grid-2">';
  html += '<div class="form-group"><label>Price Paid</label><input type="number" step="0.01" class="form-control" id="fd-price" placeholder="0.00"></div>';
  html += '<div class="form-group"><label>Source</label><input type="text" class="form-control" id="fd-src" placeholder="Amazon, RockAuto, Junkyard..."></div>';
  html += '</div>';

  html += '<div class="form-group"><label>Date Acquired</label><input type="date" class="form-control" id="fd-date" value="'+new Date().toISOString().split('T')[0]+'"></div>';

  html += '<div class="form-group"><label>Notes</label><textarea class="form-control" id="fd-notes" rows="2"></textarea></div>';

  html += '</div>';
  html += '<div class="modal-footer">';
  html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
  html += '<button class="btn btn-primary" onclick="saveFoundWishlistItem()">✅ Add & Remove from Wishlist</button>';
  html += '</div></div></div>';

  showModal(html);
}

// Toggle the edit mode on the found-it form
function toggleFoundEditMode(){
  const disp = document.getElementById('found-info-display');
  const edit = document.getElementById('found-info-edit');
  if(disp && edit){
    if(edit.style.display==='none'){ edit.style.display='block'; disp.style.display='none'; }
    else { edit.style.display='none'; disp.style.display='block'; }
  }
}

// Save the found item: add to parts inventory, then delete wishlist entry
async function saveFoundWishlistItem(){
  const item = window._foundWishlistItem;
  const catalogPart = window._foundCatalogPart;
  const wishlistId = window._foundWishlistId;
  if(!item){ toast('Missing wishlist context','error'); return; }

  const cond = val('fd-cond');
  if(!cond){ toast('Please pick a condition','error'); return; }
  const qty = parseInt(document.getElementById('fd-qty').value) || 1;

  // Use edited values if the user toggled edit mode (input fields exist either way)
  const finalName = val('fd-name') || item.name;
  const finalNum = val('fd-num') || item.part_number || catalogPart?.oem || null;
  const finalDest = val('fd-dest') || item.compatible_vehicles || null;

  const data = {
    created_by: currentUser.id,
    name: finalName,
    part_number: finalNum,
    catalog_part_id: catalogPart?.id || null,
    oem_part_number: catalogPart?.afm || null,
    condition: cond,
    quantity: qty,
    source: val('fd-src') || null,
    date_acquired: val('fd-date') || null,
    price_paid: parseFloat(val('fd-price')) || null,
    sourced_from_vehicle: finalDest,
    notes: val('fd-notes') || null,
    low_stock_threshold: null,
    compatible_vehicles: catalogPart && catalogPart.fits==='all' ? "Nathan's 2004 Denali, Cammy's 2005 Denali, Jessie's 2004 Escalade" : (finalDest || null)
  };

  const {error:insErr} = await db.from('parts').insert(data);
  if(insErr){ toast(insErr.message,'error'); return; }

  // Remove from wishlist
  await db.from('wishlist').delete().eq('id',wishlistId);

  toast('Added to inventory & removed from wishlist!','success');
  invalidate('inventory','wishlist','dashboard');
  closeModal();
  await renderWishlist();
}


async function markWishlistFound(id){
  await db.from('wishlist').update({found:true}).eq('id',id);
  toast('Marked as found!','success');
  await renderWishlist();
}

async function deleteWishlistItem(id){
  if(!confirm('Remove from wishlist?')) return;
  await db.from('wishlist').delete().eq('id',id);
  toast('Removed','success');
  invalidateWishlist();
  await renderWishlist();
}