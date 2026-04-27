// ─── CHICKEN ZONE — dashboard.js — Dashboard ────────────────────────────────────────────────────
// Depends on: app.js, feedback.js (announcements)

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function renderDashboard(){
  const el=document.getElementById('view-dashboard');
  if(!el) return;
  // Show loading only on first visit
  if(!_session.inventory) el.innerHTML=viewLoading('Loading dashboard...');
  let totalParts=0,totalVehicles=0,parts=[],reminders=[],stalePhotoVehicles=[];
  try{
    // All data from session cache — no live Supabase calls on dashboard
    var [inv, veh, rems] = await Promise.all([
      getInventory(),
      getVehicles(),
      getReminders()
    ]);
    parts = inv.filter(function(p){ return !p.is_historical; });
    totalParts = parts.reduce(function(sum,p){ return sum + (p.quantity||0); }, 0);
    totalVehicles = veh.length;
    reminders = rems;
    // Stale photos — use cached vehicles, no extra query
    var oneYearAgo=new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear()-1);
    if(_session.photos){
      var seen={};
      (_session.photos||[]).forEach(function(p){
        if(!seen[p.vehicle_id]&&new Date(p.uploaded_at)<oneYearAgo){
          seen[p.vehicle_id]=true;
          stalePhotoVehicles.push(p);
        }
      });
    }
  }catch(err){el.innerHTML=errBox(err.message);console.error('Dashboard error:',err);return;}
  const lowStock=parts.filter(p=>!p.is_historical&&p.low_stock_threshold!==null&&p.low_stock_threshold!==undefined&&p.quantity<=p.low_stock_threshold);
  const today=new Date();
  const upcoming=reminders.filter(r=>{if(r.snoozed_until_date&&new Date(r.snoozed_until_date)>today)return false;if(r.next_due_date){const days=(new Date(r.next_due_date)-today)/86400000;if(days<=30)return true}return false});
  var announcementsCard = await renderAnnouncementsCard();
  el.innerHTML=maybeShowTesterBanner()+`<div class="page-header"><div><div class="page-title">Dashboard</div><div class="page-subtitle">Welcome to the Chicken Zone 🐔</div></div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Parts in Stock</div><div class="stat-value">${totalParts||0}</div><div style="font-size:12px;color:var(--text-muted)">Inventory records</div></div>
    <div class="stat-card"><div class="stat-label">Vehicles</div><div class="stat-value">${totalVehicles||0}</div><div style="font-size:12px;color:var(--text-muted)">Registered</div></div>
    <div class="stat-card"><div class="stat-label">Low Stock</div><div class="stat-value" style="color:${lowStock.length>0?'var(--danger)':'var(--success)'}">${lowStock.length}</div><div style="font-size:12px;color:var(--text-muted)">Need restocking</div></div>
    <div class="stat-card"><div class="stat-label">Upcoming Service</div><div class="stat-value" style="color:${upcoming.length>0?'var(--warning)':'var(--success)'}">${upcoming.length}</div><div style="font-size:12px;color:var(--text-muted)">Due within 30 days</div></div>
  </div>
  ${announcementsCard}
  <div class="card" style="margin-bottom:16px"><div class="stat-label" style="margin-bottom:14px">⏰ Upcoming Maintenance ${upcoming.length>0?`(${upcoming.length})`:''}</div>${upcoming.length>0 ? upcoming.slice(0,5).map(r=>`<div class="alert alert-warning"><strong>${esc(r.title)}</strong>  -  ${r.vehicles?`${r.vehicles.year} ${r.vehicles.make} ${r.vehicles.model}`:'Unknown'}${r.next_due_date?` · Due ${fmtDate(r.next_due_date)}`:''}</div>`).join('') : '<div style="font-size:13px;color:var(--text-muted);font-style:italic;padding:8px">No maintenance due soon. \u{1F44D}</div>'}</div>
  ${lowStock.length>0?`<div class="card"><div class="stat-label" style="margin-bottom:14px">🔴 Low Stock / Restock Alerts</div>${lowStock.slice(0,8).map(p=>`<div class="alert alert-danger"><strong>${esc(p.name)}</strong>${p.part_number?` · #${esc(p.part_number)}`:''}  -  <strong>${p.quantity}</strong> remaining</div>`).join('')}</div>`:''}
  ${stalePhotoVehicles.length>0?`<div class="card"><div class="stat-label" style="margin-bottom:14px">📸 Vehicle Photos Need Updating</div>${stalePhotoVehicles.map(p=>`<div class="alert alert-warning" style="cursor:pointer" onclick="showView('vehicle-profile',{id:'${p.vehicle_id}',tab:'photos'})"><strong>${p.vehicles?getVehicleDisplayName(p.vehicles):'Vehicle'}</strong> · Photos not updated in over a year — tap to update 📷</div>`).join('')}</div>`:''}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PARTS PAGE ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function renderPartsPage(){
  var el=document.getElementById('view-parts');
  if(!el){ console.error('view-parts element missing'); return; }
  // Only show loading spinner if we have nothing cached yet
  if(!_session.inventory) el.innerHTML=viewLoading('Loading parts...');
  try{
    dbInventory = await getInventory();
    renderPartsList(el);
  }catch(err){
    el.innerHTML=errBox(err.message, err.stack);
    console.error('renderPartsPage error:', err);
  }
}

function renderPartsList(el){
  if(!el) el=document.getElementById('view-parts');
  try{
  // Use cache as source of truth - dbInventory may be stale
  const allInv = _session.inventory || dbInventory || [];
  const invSource = allInv.filter(function(p){ return !p.is_historical; });
  dbInventory = invSource;
  // Build combined list: GMT800 catalog + custom DB parts not in catalog
  const catalogIds=new Set(_catalog.map(p=>p.id));
  const customParts=invSource.filter(p=>!p.catalog_part_id||!catalogIds.has(p.catalog_part_id));

  // For each catalog part, find matching inventory
  let combined=_catalog.map(cp=>{
    const inv=dbInventory.filter(p=>p.catalog_part_id===cp.id);
    const qty=inv.reduce((sum,p)=>sum+p.quantity,0);
    return{...cp,_type:'catalog',_inv:inv,_qty:qty};
  });

  // Add custom parts
  customParts.forEach(p=>{combined.push({id:p.id,name:p.name,cat:p.source||'Custom',sub:'',oem:p.part_number||'',rank:999,_type:'custom',_inv:[p],_qty:p.quantity})});

  // Filter
  if(partSearch){const s=partSearch.toLowerCase();combined=combined.filter(p=>p.name.toLowerCase().includes(s)||p.cat.toLowerCase().includes(s)||p.sub.toLowerCase().includes(s)||p.oem.toLowerCase().includes(s))}

  // Apply qty filter
  if(partsQtyFilter==='instock') combined=combined.filter(p=>p._qty>0);
  else if(partsQtyFilter==='outstock') combined=combined.filter(p=>p._qty===0);

  // Sort - when 'all' is active, pin in-stock items above out-of-stock within the sort
  const dir=partsSortDir;
  function innerSort(a,b){
    if(partsSort==='alpha') return dir*a.name.localeCompare(b.name);
    if(partsSort==='cat') return dir*(a.cat.localeCompare(b.cat)||a.name.localeCompare(b.name));
    if(partsSort==='freq') return dir*(a.rank-b.rank);
    if(partsSort==='qty') return dir*(b._qty-a._qty);
    if(partsSort==='loc') return dir*(a._inv[0]?.shelf_location||'zzz').localeCompare(b._inv[0]?.shelf_location||'zzz');
    if(partsSort==='cond') return dir*((a._inv[0]?.condition||'').localeCompare(b._inv[0]?.condition||''));
    if(partsSort==='oem') return dir*(a.oem||'').localeCompare(b.oem||'');
    return dir*a.name.localeCompare(b.name);
  }
  combined.sort(function(a,b){
    // Pin qty>0 above qty=0 when viewing all
    if(partsQtyFilter==='all'){
      const aHas = a._qty>0 ? 0 : 1;
      const bHas = b._qty>0 ? 0 : 1;
      if(aHas !== bHas) return aHas - bHas;
    }
    return innerSort(a,b);
  });

  const total=combined.length, inStock=combined.filter(p=>p._qty>0).length;

  var _viewerBannerParts = maybeShowTesterBanner();
  el.innerHTML=_viewerBannerParts+`
    <div class="page-header"><div><div class="page-title">Auto Parts</div><div class="page-subtitle">${inStock} of ${total} parts in stock</div></div>
      <button class="btn btn-primary" onclick="showAddPartChoice()">+ Add New Part to Inventory</button>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div style="position:relative;display:flex;align-items:center;flex:1">
        <input type="text" class="search-input" id="parts-search" style="flex:1;padding-right:32px" placeholder="🔍  Search name, category, part number..." value="${esc(partSearch)}" oninput="onPartsSearch(this.value)">
        <button onclick="document.getElementById('parts-search').value='';partSearch='';renderPartsList();" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;line-height:1;padding:0" title="Clear search">&#x2715;</button>
        </div>
        <div class="flex-row" style="gap:4px">
          <button class="sort-btn ${partsQtyFilter==='all'?'active':''}" onclick="setPartsQtyFilter('all')">All</button>
          <button class="sort-btn ${partsQtyFilter==='instock'?'active':''}" onclick="setPartsQtyFilter('instock')">In Stock</button>
          <button class="sort-btn ${partsQtyFilter==='outstock'?'active':''}" onclick="setPartsQtyFilter('outstock')">Out of Stock</button>
        </div>
      </div>
      <table>
        <thead><tr>
          <th onclick="setPartsSort('alpha')" style="cursor:pointer;white-space:nowrap">Part Name ${partsSort==='alpha'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('cat')" style="cursor:pointer;white-space:nowrap">Category ${partsSort==='cat'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('oem')" style="cursor:pointer;white-space:nowrap">OEM # ${partsSort==='oem'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('cond')" style="cursor:pointer;white-space:nowrap">Condition ${partsSort==='cond'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('loc')" style="cursor:pointer;white-space:nowrap">Location ${partsSort==='loc'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('freq')" style="cursor:pointer;text-align:center;white-space:nowrap" title="How often this part typically fails across all GMT800 vehicles. #1 is the most commonly replaced part. Lower numbers = replaced more often. Color coding: red=top 10, yellow=top 25.">Fail Rank ℹ️ ${partsSort==='freq'?(partsSortDir>0?'▲':'▼'):''}</th>
          <th onclick="setPartsSort('qty')" style="cursor:pointer;text-align:right;white-space:nowrap">Qty ${partsSort==='qty'?(partsSortDir>0?'▲':'▼'):''}</th>
        </tr></thead>
        <tbody>
          ${combined.map(p=>{
            const qty=p._qty;
            const isZero=qty===0;
            const topInv=p._inv.find(function(i){ return !i.is_historical && i.quantity>0; })||p._inv.find(function(i){ return !i.is_historical; })||null;
            const cond=topInv?.condition||'';
            const loc=topInv?.shelf_location||'';
            const failRank=p.rank<999?p.rank:'';
            return`<tr class="tr-clickable ${isZero?'tr-zero':''}" onclick="showPartProfile('${p.id}','${p._type}')">
              <td><strong>${esc(p.name)}</strong>${p.sub?`<span style="font-size:11px;color:var(--text-muted);margin-left:6px">${esc(p.sub)}</span>`:''}</td>
              <td><span style="font-size:12px;color:var(--text-muted)">${esc(p.cat)}</span></td>
              <td style="font-family:'Barlow Condensed',sans-serif;font-size:13px;color:var(--text-muted)">${esc(p.oem||'-')}</td>
              <td>${cond?condBadge(cond):'<span style="color:var(--text-dim);font-size:12px">-</span>'}</td>
              <td style="font-family:'Barlow Condensed',sans-serif;font-size:13px;color:${loc?'var(--text)':'var(--text-dim)'}">${esc(loc||'-')}</td>
              <td style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:20px;color:${failRank&&failRank<=10?'var(--danger)':failRank<=25?'var(--warning)':'var(--text-muted)'}">${failRank||'-'}</td>
              <td style="text-align:right;font-weight:700;font-size:16px;font-family:'Bebas Neue',sans-serif;color:${isZero?'var(--text-dim)':(topInv?.low_stock_threshold!==null&&topInv?.low_stock_threshold!==undefined&&qty<=topInv.low_stock_threshold)?'var(--danger)':'var(--accent)'}">${qty}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }catch(err){
    console.error('renderPartsList error:',err);
    el.innerHTML='<div style="padding:40px;color:var(--danger)">Error rendering parts: '+err.message+'<br><button class="btn btn-secondary btn-sm" onclick="location.reload()" style="margin-top:10px">Reload</button></div>';
  }
}

function onPartsSearch(v){partSearch=v;clearTimeout(partsTimer);partsTimer=setTimeout(()=>renderPartsList(),300)}
function setPartsSort(s){if(partsSort===s){partsSortDir*=-1;}else{partsSort=s;partsSortDir=1;}renderPartsList()}
function setPartsQtyFilter(f){partsQtyFilter=f;renderPartsList()}

