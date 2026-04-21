// NOTE: Run this SQL in Supabase:
// ALTER TABLE part_installations ADD COLUMN IF NOT EXISTS time_taken text;

// ─── CHICKEN ZONE — app.js ────────────────────────────────────────────────────
// Single-page app for GMT800 family parts inventory
// Data layer: Supabase (catalog_parts, part_details, parts, vehicles, wishlist)
// ─────────────────────────────────────────────────────────────────────────────

const {createClient} = supabase;
const SUPABASE_URL = 'https://oqseclogmhqlfhjhxmai.supabase.co';
const SUPABASE_KEY = 'sb_publishable_5v-bGGy8gfVVMQHLbcKmEQ_HB7Y7Lrs';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const ANTHROPIC_KEY = ''; // Optional: paste your Anthropic key here for AI receipt scanning

// ─── CATALOG CACHE ───────────────────────────────────────────────────────────
// Loaded once on login from Supabase. Never re-fetched unless page is refreshed.
// All functions that used GMT800[] and PART_DETAILS{} now read from here.
let _catalog = [];       // normalized catalog parts (same shape as old GMT800 array)
let _partDetails = {};   // keyed by catalog_part_id (same shape as old PART_DETAILS)

// ─── DATA CACHE ───────────────────────────────────────────────────────────────
// Keeps fetched data in memory so tab switches are instant.
// Invalidated by any write operation (add/edit/delete).
const _cache = {
  inventory:  null,   // all parts rows
  vehicles:   null,   // all vehicles rows
  wishlist:   null,   // all wishlist rows
  dashboard:  null,   // {parts, reminders, totalParts, totalVehicles}
};
function invalidate(...keys){
  if(keys.length===0){ Object.keys(_cache).forEach(k=>_cache[k]=null); }
  else keys.forEach(k=>{ _cache[k]=null; });
}

// ─── CAT ICONS (static, no need for DB) ──────────────────────────────────────
const CAT_ICONS = {
  'Maintenance':'🛢','Engine':'⚙️','Cooling':'🌡','Fuel':'⛽',
  'Transmission':'🔄','Transfer Case':'4️⃣','Drivetrain':'🔩','Brakes':'🛑',
  'Suspension':'🔧','Steering':'🎯','Electrical':'⚡','Lighting':'💡',
  'Interior':'🪑','Exterior':'🚗','HVAC':'❄️'
};

// ─── LOAD CATALOG FROM SUPABASE ──────────────────────────────────────────────
async function loadCatalog(){
  try{
    showSpinner('Loading parts catalog...');
    // Fetch catalog parts and details in parallel
    const [catRes, detRes] = await Promise.all([
      db.from('catalog_parts').select('*').order('failure_rank'),
      db.from('part_details').select('*')
    ]);

    if(catRes.error) throw new Error('Catalog: ' + catRes.error.message);

    // Normalize catalog_parts rows to match legacy format used throughout the app
    // (cat, sub, oem, afm, rank, desc instead of Supabase column names)
    _catalog = (catRes.data || []).map(function(row){
      return {
        id:   row.id,
        name: row.name,
        cat:  row.category,
        sub:  row.subcategory || '',
        oem:  row.oem_number || '',
        afm:  row.aftermarket_ref || '',
        rank: row.failure_rank || 999,
        fits: row.fits || 'all',
        desc: row.description || ''
      };
    });

    // Normalize part_details rows to match legacy format (time, tools, hardware, tip)
    _partDetails = {};
    (detRes.data || []).forEach(function(row){
      _partDetails[row.catalog_part_id] = {
        time:     row.estimated_time || '',
        tools:    row.tools || [],
        hardware: row.hardware || [],
        tip:      row.pro_tip || ''
      };
    });

    console.log('Catalog loaded: ' + _catalog.length + ' parts, ' + Object.keys(_partDetails).length + ' detail records');
  } catch(e){
    console.error('Failed to load catalog:', e);
    // Fall through — app still works, just won't show catalog parts
    toast('Could not load parts catalog from Supabase. Check connection.', 'error');
  }
}

// ─── CACHED FETCH HELPERS ────────────────────────────────────────────────────
async function fetchInventory(force){
  if(!force && _cache.inventory) return _cache.inventory;
  const{data,error}=await withTimeout(db.from('parts').select('*'));
  if(error) throw new Error(error.message);
  _cache.inventory = data||[];
  dbInventory = _cache.inventory;
  return _cache.inventory;
}
async function fetchVehicles(force){
  if(!force && _cache.vehicles) return _cache.vehicles;
  const{data,error}=await withTimeout(db.from('vehicles').select('*').order('year',{ascending:false}));
  if(error) throw new Error(error.message);
  _cache.vehicles = data||[];
  return _cache.vehicles;
}
async function fetchWishlist(force){
  if(!force && _cache.wishlist) return _cache.wishlist;
  const{data,error}=await withTimeout(db.from('wishlist').select('*').order('created_at',{ascending:false}));
  if(error) throw new Error(error.message);
  _cache.wishlist = data||[];
  return _cache.wishlist;
}

// Helpers to replace GMT800 and PART_DETAILS references
function getCatalog(){ return _catalog; }
function getPartDetail(id){ return _partDetails[id] || null; }
function getCategories(){ return [...new Set(_catalog.map(function(p){return p.cat;}))].sort(); }

// ─── SPINNER HELPERS ─────────────────────────────────────────────────────────
function showSpinner(msg){
  const el = document.getElementById('app-spinner');
  if(!el) return;
  const label = el.querySelector('.spinner-label');
  if(label && msg) label.textContent = msg;
  el.style.display = 'flex';
}
function hideSpinner(){
  const el = document.getElementById('app-spinner');
  if(el) el.style.display = 'none';
}
function viewLoading(msg){
  return '<div class="view-loading"><div class="egg-spin-sm">🥚</div><div style="font-family:\'Barlow Condensed\',sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase">'+(msg||'Loading...')+'</div></div>';
}


// ─── STATE ──────────────────────────────────────────────────────────────────
let currentUser=null, selectedVehicleId=null, vehicleDetailTab='overview';
let partsSort='alpha', partsSortDir=1, partSearch='', partsTimer=null, partsQtyFilter='all'; // all | instock | outstock
let wizardStep=1, wizardVehicle=null, wizardCat=null, wizardPart=null;
let addMode=''; // 'ai' or 'manual'
let dbInventory=[]; // cached inventory from supabase
let _catalogLoaded=false;

// Shelf locations stored in localStorage
function getLocations(){try{return JSON.parse(localStorage.getItem('cz_locations')||'[]')}catch{return[]}}
function saveLocations(locs){localStorage.setItem('cz_locations',JSON.stringify(locs))}

// ─── COLOR HELPER ─────────────────────────────────────────────────────────────
function colorToCss(name){
  if(!name) return '#888';
  const n=name.toLowerCase().trim();
  const map={black:'#0a0a0a',white:'#eee',silver:'#c0c0c0',gray:'#888',grey:'#888',red:'#cc0000',blue:'#1e4db7',navy:'#001f5a',green:'#2d7a2d',yellow:'#d4b800',orange:'#e67e00',brown:'#5a3a1e',tan:'#c8a876',beige:'#d4c4a8',gold:'#b8860b',maroon:'#800000',purple:'#4b0082',pink:'#e8769e'};
  return map[n]||'#888';
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function val(id){const el=document.getElementById(id);return el?el.value.trim():''}
function fmtDate(d){if(!d)return' - ';const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'})}
function toast(msg,type='info'){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className=`toast toast-${type}`;t.textContent=msg;c.appendChild(t);setTimeout(()=>t.remove(),3800)}
function showModal(html){document.getElementById('modal-container').innerHTML=html}
function closeModal(){document.getElementById('modal-container').innerHTML='';stopCamera()}
function condBadge(c){const m={'New':'badge-new','Used - Good':'badge-good','Used - Fair':'badge-fair','Used - Poor':'badge-poor'};return c?`<span class="badge ${m[c]||''}">${c}</span>`:'<span style="color:var(--text-dim)"> - </span>'}
function prioBadge(p){const m={'High':'badge-high','Medium':'badge-medium','Low':'badge-ok'};return p?`<span class="badge ${m[p]||''}">${p}</span>`:''}
async function uploadFile(bucket,file){const ext=file.name.split('.').pop();const path=`${currentUser.id}/${Date.now()}.${ext}`;const{error}=await db.storage.from(bucket).upload(path,file);if(error)throw error;const{data}=db.storage.from(bucket).getPublicUrl(path);return data.publicUrl}


function toggleSidebar(){const sb=document.getElementById('sidebar');const ov=document.getElementById('sidebar-overlay');const open=sb.classList.toggle('open');ov.classList.toggle('visible',open);}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sidebar-overlay').classList.remove('visible');}
// ─── TIMEOUT HELPER ──────────────────────────────────────────────────────────
function withTimeout(promise, ms=20000){
  const t=new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Request timed out after ${ms/1000}s. Try refreshing the page. If the problem persists, check your internet connection.`)),ms));
  return Promise.race([promise,t]);
}
function errBox(msg){return`<div style="padding:40px 32px"><div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:24px;color:var(--danger);font-size:13px;line-height:1.6"><strong style="font-size:16px;display:block;margin-bottom:8px">⚠️ Could Not Load Data</strong>${msg}<br><br><button class="btn btn-secondary btn-sm" onclick="location.reload()">🔄 Retry</button></div></div>`;}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
db.auth.onAuthStateChange(async(event,session)=>{
  if(session?.user){
    currentUser=session.user;
    document.getElementById('user-email-display').textContent=currentUser.user_metadata?.username||currentUser.email;
    // Load catalog from Supabase (with spinner showing)
    await loadCatalog();
    document.getElementById('app-spinner').style.display='none';
    document.getElementById('auth-screen').style.display='none';
    document.getElementById('app').style.display='flex';
    await showView('dashboard');
  } else {
    currentUser=null;
    document.getElementById('app-spinner').style.display='none';
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').style.display='none';
  }
});
function switchAuthTab(tab){document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));document.getElementById('auth-form-login').style.display=tab==='login'?'block':'none';document.getElementById('auth-form-register').style.display=tab==='register'?'block':'none'}
async function signIn(){
  const input=document.getElementById('login-username').value.trim();
  const password=document.getElementById('login-password').value;
  if(!input||!password){toast('Please enter your username or email and password','error');return;}
  const email=input.includes('@')?input:(input+'@chickzone.internal');
  const result=await db.auth.signInWithPassword({email:email,password:password});
  if(result.error){
    toast('Incorrect credentials. Tip: use your original email address if you registered before the username update.','error');
  }
}
async function signUp(){
  const username=document.getElementById('reg-username').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const email=document.getElementById('reg-email').value.trim();
  const password=document.getElementById('reg-password').value;
  if(!username||!email||!password)return toast('Please fill all fields','error');
  if(username.length<3)return toast('Username must be at least 3 characters','error');
  if(!email.includes('@'))return toast('Please enter a valid email address','error');
  const internalEmail=username+'@chickzone.internal';
  const{data,error}=await db.auth.signUp({email:internalEmail,password,options:{data:{username,real_email:email}}});
  if(error){toast(error.message,'error');return;}
  if(data?.user){
    await db.from('profiles').upsert({id:data.user.id,username,full_name:username,real_email:email}).catch(()=>
      db.from('profiles').upsert({id:data.user.id,full_name:username})
    );
  }
  toast('Account created! Sign in with your username.','success');
  switchAuthTab('login');
  document.getElementById('login-username').value=username;
}
async function signOut(){await db.auth.signOut()}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
async function showView(view, arg){
  if(window.innerWidth<=768) closeSidebar();
  // Only highlight nav for top-level views
  const navView = (view==='part-profile')?'parts':(view==='vehicle-profile')?'vehicles':view;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===navView));
  document.querySelectorAll('#main-content > div').forEach(d=>d.style.display='none');
  const el=document.getElementById('view-'+view);
  if(el) el.style.display='block';
  if(view==='dashboard') await renderDashboard();
  else if(view==='parts') await renderPartsPage();
  else if(view==='part-profile') await renderPartProfile(arg);
  else if(view==='vehicles'){selectedVehicleId=null; await renderVehicles();}
  else if(view==='vehicle-profile') await renderVehicleProfile(arg);
  else if(view==='wishlist') await renderWishlist();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function renderDashboard(){
  const el=document.getElementById('view-dashboard');
  if(!_cache.dashboard) el.innerHTML=viewLoading('Loading dashboard...');
  let totalParts=0,totalVehicles=0,parts=[],reminders=[];
  try{
    // Use cached inventory if available, only re-fetch reminders (time-sensitive)
    let inv = await fetchInventory();
    const remRes = await withTimeout(db.from('maintenance_reminders').select('*,vehicles(year,make,model)').eq('is_active',true));
    parts = inv;
    reminders = remRes.data||[];
    totalParts = inv.length;
    const veh = await fetchVehicles();
    totalVehicles = veh.length;
    _cache.dashboard = {totalParts, totalVehicles, parts, reminders};
  }catch(err){el.innerHTML=errBox(err.message);console.error('Dashboard error:',err);return;}
  const lowStock=parts.filter(p=>p.low_stock_threshold!==null&&p.low_stock_threshold!==undefined&&p.quantity<=p.low_stock_threshold);
  const today=new Date();
  const upcoming=reminders.filter(r=>{if(r.snoozed_until_date&&new Date(r.snoozed_until_date)>today)return false;if(r.next_due_date){const days=(new Date(r.next_due_date)-today)/86400000;if(days<=30)return true}return false});
  el.innerHTML=`<div class="page-header"><div><div class="page-title">Dashboard</div><div class="page-subtitle">Welcome to the Chicken Zone 🐔</div></div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Parts in Stock</div><div class="stat-value">${totalParts||0}</div><div style="font-size:12px;color:var(--text-muted)">Inventory records</div></div>
    <div class="stat-card"><div class="stat-label">Vehicles</div><div class="stat-value">${totalVehicles||0}</div><div style="font-size:12px;color:var(--text-muted)">Registered</div></div>
    <div class="stat-card"><div class="stat-label">Low Stock</div><div class="stat-value" style="color:${lowStock.length>0?'var(--danger)':'var(--success)'}">${lowStock.length}</div><div style="font-size:12px;color:var(--text-muted)">Need restocking</div></div>
    <div class="stat-card"><div class="stat-label">Upcoming Service</div><div class="stat-value" style="color:${upcoming.length>0?'var(--warning)':'var(--success)'}">${upcoming.length}</div><div style="font-size:12px;color:var(--text-muted)">Due within 30 days</div></div>
  </div>
  ${upcoming.length>0?`<div class="card" style="margin-bottom:16px"><div class="stat-label" style="margin-bottom:14px">⚠️ Upcoming Maintenance</div>${upcoming.slice(0,5).map(r=>`<div class="alert alert-warning"><strong>${esc(r.title)}</strong>  -  ${r.vehicles?`${r.vehicles.year} ${r.vehicles.make} ${r.vehicles.model}`:'Unknown'}${r.next_due_date?` · Due ${fmtDate(r.next_due_date)}`:''}</div>`).join('')}</div>`:''}
  ${lowStock.length>0?`<div class="card"><div class="stat-label" style="margin-bottom:14px">🔴 Low Stock / Restock Alerts</div>${lowStock.slice(0,8).map(p=>`<div class="alert alert-danger"><strong>${esc(p.name)}</strong>${p.part_number?` · #${esc(p.part_number)}`:''}  -  <strong>${p.quantity}</strong> remaining</div>`).join('')}</div>`:''}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PARTS PAGE ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function renderPartsPage(){
  const el=document.getElementById('view-parts');
  // Only show loading spinner if we have nothing cached yet
  if(!_cache.inventory) el.innerHTML=viewLoading('Loading parts...');
  try{
    dbInventory=await fetchInventory();
    renderPartsList(el);
  }catch(err){el.innerHTML=errBox(err.message);console.error('Parts error:',err);}
}

function renderPartsList(el){
  if(!el) el=document.getElementById('view-parts');
  // Build combined list: GMT800 catalog + custom DB parts not in catalog
  const catalogIds=new Set(_catalog.map(p=>p.id));
  const customParts=dbInventory.filter(p=>!p.catalog_part_id||!catalogIds.has(p.catalog_part_id));

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

  el.innerHTML=`
    <div class="page-header"><div style="text-align:center;flex:1"><div class="page-title" style="font-size:42px;text-align:center">Auto Parts</div><div class="page-subtitle" style="font-size:12px;text-align:center">${inStock} of ${total} parts in stock</div></div>
      <button class="btn btn-primary" onclick="showAddPartChoice()">+ Add New Part to Inventory</button>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <input type="text" class="search-input" id="parts-search" placeholder="🔍  Search name, category, part number..." value="${esc(partSearch)}" oninput="onPartsSearch(this.value)">
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
            const topInv=p._inv[0];
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
}

function onPartsSearch(v){partSearch=v;clearTimeout(partsTimer);partsTimer=setTimeout(()=>renderPartsList(),300)}
function setPartsSort(s){if(partsSort===s){partsSortDir*=-1;}else{partsSort=s;partsSortDir=1;}renderPartsList()}
function setPartsQtyFilter(f){partsQtyFilter=f;renderPartsList()}

// ─── PART PROFILE - FULL PAGE VIEW ───────────────────────────────────────────
let _currentPartProfile={id:null,name:'',type:'catalog'};

// Legacy wrapper so existing calls to showPartProfile still work
async function showPartProfile(id, type){
  await showView('part-profile', {id:id, type:type||'catalog'});
}

async function renderPartProfile(arg){
  const el=document.getElementById('view-part-profile');
  if(!el) return;
  el.innerHTML=viewLoading('Loading part...');

  const id = arg?.id;
  const type = arg?.type || 'catalog';
  _currentPartProfile={id, name:_catalog.find(p=>p.id===id)?.name||id, type};

  let cp=null, inv=[];
  if(type==='catalog'){
    cp=_catalog.find(p=>p.id===id);
    inv=dbInventory.filter(p=>p.catalog_part_id===id);
  } else {
    const p=dbInventory.find(p=>p.id===id);
    if(p){
      cp={id:p.id, name:p.name, cat:p.source||'Custom', sub:'', oem:p.part_number||'', afm:p.oem_part_number||'', rank:999, fits:'all', desc:p.notes||''};
      inv=[p];
    }
  }
  if(!cp){
    el.innerHTML='<div style="padding:60px;text-align:center;color:var(--danger)">Part not found. <button class="btn btn-secondary btn-sm" onclick="showView(\'parts\')">← Back to Parts</button></div>';
    return;
  }

  const totalQty = inv.reduce((sum,p)=>sum+p.quantity, 0);
  const topInv = inv[0];

  // Fetch installation history
  let installs=[];
  try{
    const r = await withTimeout(db.from('part_installations').select('*,vehicles(id,year,make,model,notes)').in('part_id', inv.length?inv.map(p=>p.id):['00000000-0000-0000-0000-000000000000']).order('installed_date',{ascending:false}));
    installs = r.data || [];
  }catch(e){ installs=[]; }

  // Compatible vehicles - need to look them up from DB
  let vehiclesList=[];
  try{
    const rv = await withTimeout(db.from('vehicles').select('id,year,make,model,trim,notes').order('year'));
    vehiclesList = rv.data || [];
  }catch(e){ vehiclesList=[]; }

  // Determine which actual vehicles are compatible
  const compatVehicles = vehiclesList.filter(v=>{
    if(cp.fits==='all') return true;
    if(cp.fits==='esc') return v.make==='Cadillac';
    if(cp.fits==='yk') return v.make==='GMC';
    return false;
  });

  const qrData = encodeURIComponent('CHICKEN ZONE\n'+cp.name+'\nOEM:'+(cp.oem||'N/A')+'\nLoc:'+(topInv?.shelf_location||'N/A'));
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&bgcolor=0f0f0f&color=FFD700&data='+qrData;

  // Amazon search - detailed like YouTube
  const amazonQ = encodeURIComponent(cp.name+' '+(cp.oem||'')+' GMT800 '+(cp.fits==='esc'?'Cadillac Escalade':'GMC Yukon Denali')+' '+cp.cat);
  const youtubeQ = encodeURIComponent(cp.name+' GMT800 replacement install');

  // Get detail data (tools/hardware/time/tip) and extract any failure hints from description
  const pd = getPartDetail(cp.id) || null;

  // Extract common errors from description (the "X = bad Y" patterns)
  let commonErrors = [];
  if(cp.desc){
    const hintRegex = /([^.]*=[^.]*\.)/g;
    const matches = cp.desc.match(hintRegex) || [];
    commonErrors = matches.map(m=>m.trim()).filter(m=>m.length>5);
  }
  // Clean description without the hints
  let cleanDesc = cp.desc || '';
  commonErrors.forEach(e=>{ cleanDesc = cleanDesc.replace(e,'').trim(); });

  let html = '';

  // Hero section - dark banner like before but full-width
  html += '<div style="background:linear-gradient(135deg,#0a0a1a 0%,#151525 100%);margin:-32px -32px 24px -32px;padding:28px 32px;border-bottom:2px solid var(--accent)">';
  html += '<button class="btn btn-ghost btn-sm" onclick="showView(\'parts\')" style="margin-bottom:12px">← Back to Parts</button>';
  html += '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">';

  // Part photo / placeholder as button
  const photoBtnId = 'photo-btn-'+(topInv?.id||'noinv');
  const photoInputId = 'photo-input-'+(topInv?.id||'noinv');
  if(topInv?.id){
    html += '<div id="'+photoBtnId+'" class="ms-pic" style="cursor:pointer" onclick="document.getElementById(\''+photoInputId+'\').click()">';
    if(topInv.image_url){
      html += '<img src="'+topInv.image_url+'" alt="part">';
    } else {
      html += '<div style="text-align:center;padding:10px"><div style="font-size:28px;opacity:.3">'+(CAT_ICONS[cp.cat]||'🔧')+'</div><div style="font-size:26px;color:var(--accent);line-height:1">+</div><div style="font-size:10px;color:var(--text-muted);font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Photo</div></div>';
    }
    html += '</div>';
    html += '<input type="file" id="'+photoInputId+'" accept="image/*" style="display:none" onchange="uploadPartPhotoFromProfile(\''+topInv.id+'\',\''+cp.id+'\',this.files[0])">';
  } else {
    html += '<div class="ms-pic" style="cursor:pointer" onclick="toast(\'Add this part to inventory first, then you can attach a photo\',\'info\')" title="Add part to inventory first">';
    html += '<div style="text-align:center;padding:10px"><div style="font-size:28px;opacity:.3">'+(CAT_ICONS[cp.cat]||'🔧')+'</div><div style="font-size:26px;color:var(--accent);line-height:1;opacity:.5">+</div><div style="font-size:10px;color:var(--text-muted);font-family:\'Barlow Condensed\',sans-serif;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Photo</div></div>';
    html += '</div>';
  }

  html += '<div style="flex:1;min-width:250px">';
  html += '<div class="ms-part-name">'+esc(cp.name)+'</div>';
  html += '<div class="ms-part-cat">'+esc(cp.cat)+(cp.sub?' · '+esc(cp.sub):'')+'</div>';
  html += '<div class="ms-status-line">Status: <strong style="color:'+(totalQty>0?'var(--success)':'var(--danger)')+'">'+(totalQty>0?totalQty+' in stock':'Out of stock')+'</strong>';
  if(topInv?.shelf_location) html += ' · 📍 <strong>'+esc(topInv.shelf_location)+'</strong>';
  html += '</div>';
  if(cp.rank<50){
    html += '<div class="ms-status-line">Failure Rank: <strong style="color:var(--warning)" title="Parts ranked by how often they are replaced. Lower number = replaced more often. #1 is most common wear item.">#'+cp.rank+'</strong> <span style="font-size:11px;color:var(--text-muted)">(lower = replaced more often)</span></div>';
  }
  if(cleanDesc) html += '<div class="ms-status-line" style="margin-top:8px;font-size:12px;color:var(--text-muted)">'+esc(cleanDesc)+'</div>';
  html += '</div>';

  // Quick links + edit button
  html += '<div class="ms-contact-box" style="min-width:180px">';
  html += '<div class="ms-contact-title" style="display:flex;justify-content:space-between;align-items:center">Quick Links';
  html += '<button class="btn btn-ghost btn-sm" onclick="showCatalogEditModal(\''+cp.id+'\')" title="Edit this part type" style="padding:2px 6px">✏️</button>';
  html += '</div>';
  html += '<button class="ms-contact-btn" onclick="window.open(\'https://www.youtube.com/results?search_query='+youtubeQ+'\',\'_blank\')">▶️ YouTube Guide</button>';
  html += '<button class="ms-contact-btn" onclick="window.open(\'https://www.amazon.com/s?k='+amazonQ+'\',\'_blank\')">🛒 Amazon</button>';
  html += '<button class="ms-contact-btn" onclick="openRockAuto(\''+cp.cat+'\',\''+cp.fits+'\')">🔩 RockAuto</button>';
  if(topInv?.shop_url) html += '<button class="ms-contact-btn" onclick="window.open(\''+topInv.shop_url+'\',\'_blank\')">🔗 Shop Link</button>';
  html += '</div>';
  html += '</div></div>';

  // Two column body
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:0 4px">';

  // LEFT COLUMN
  html += '<div>';

  // Part Numbers box
  html += '<div class="ms-box"><div class="ms-box-title">Part Numbers</div><div class="ms-box-body">';
  if(cp.oem){
    html += '<div class="part-num-row"><span class="part-num-type">OEM</span><span style="color:var(--text);font-family:\'Barlow Condensed\',sans-serif;font-size:14px;flex:1">'+esc(cp.oem)+'</span><span style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:'+(totalQty>0?'var(--success)':'var(--text-dim)')+'">×'+totalQty+'</span></div>';
  }
  if(cp.afm) html += '<div class="part-num-row"><span class="part-num-type">Aftermarket Ref</span><span style="color:var(--text-muted);font-size:12px">'+esc(cp.afm)+'</span></div>';
  if(!cp.oem) html += '<div style="color:var(--text-dim);font-size:12px">No OEM # on file</div>';
  html += '</div></div>';

  // Compatible Vehicles - clickable to specific cars
  html += '<div class="ms-box"><div class="ms-box-title">Compatible Vehicles</div><div class="ms-box-body">';
  if(compatVehicles.length>0){
    compatVehicles.forEach(function(v){
      const vName = getVehicleDisplayName(v);
      html += '<span class="compat-tag" style="cursor:pointer" onclick="showView(\'vehicle-profile\',{id:\''+v.id+'\'})" title="Go to '+esc(vName)+' profile">🚗 '+esc(vName)+'</span>';
    });
  } else {
    // Fallback when no DB vehicles exist yet
    if(cp.fits==='all') html += '<span class="compat-tag">🚗 All three cars</span>';
    else if(cp.fits==='esc') html += '<span class="compat-tag">🚗 Jessie\'s Escalade</span>';
    else if(cp.fits==='yk') html += '<span class="compat-tag">🚗 Both Denalis</span>';
  }
  html += '</div></div>';

  // Stock locations
  if(totalQty>0){
    html += '<div class="ms-box"><div class="ms-box-title">Stock Locations</div><div class="ms-box-body">';
    html += renderInvLocations(inv, cp.name, cp.oem||'');
    html += '</div></div>';
  }

  html += '</div>'; // end left

  // RIGHT COLUMN
  html += '<div>';

  if(totalQty>0){
    html += '<div class="ms-box"><div class="ms-box-title">Inventory Details</div><div class="ms-box-body">';
    html += '<div class="ms-field"><span class="ms-field-label">Quantity</span><span class="ms-field-val" style="font-size:24px;font-family:\'Bebas Neue\',sans-serif;color:var(--accent)">'+totalQty+'</span></div>';
    html += '<div class="ms-field"><span class="ms-field-label">Condition</span><span class="ms-field-val">'+condBadge(topInv?.condition)+'</span></div>';
    html += '<div class="ms-field"><span class="ms-field-label">Source</span><span class="ms-field-val">'+esc(topInv?.source||'-')+'</span></div>';
    html += '<div class="ms-field"><span class="ms-field-label">Date Acquired</span><span class="ms-field-val">'+(topInv?.date_acquired?fmtDate(topInv.date_acquired):'-')+'</span></div>';
    if(topInv?.price_paid) html += '<div class="ms-field"><span class="ms-field-label">Paid</span><span class="ms-field-val" style="color:var(--success)">$'+topInv.price_paid+'</span></div>';
    if(topInv?.sourced_from_vehicle) html += '<div class="ms-field"><span class="ms-field-label">Intended For</span><span class="ms-field-val">'+esc(topInv.sourced_from_vehicle)+'</span></div>';
    html += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
    if(topInv?.receipt_url) html += '<a href="'+topInv.receipt_url+'" target="_blank" class="btn btn-secondary btn-sm">📄 Receipt</a>';
    html += '<button class="btn btn-secondary btn-sm" onclick="showEditInventoryModal(\''+(topInv?.id||'')+'\',\''+cp.id+'\')">✏️ Edit</button>';
    if(topInv?.condition==='Used - Poor'){
      html += '<button class="btn btn-secondary btn-sm" onclick="wishlistCurrent()">⭐ Wishlist a replacement</button>';
    }
    html += '</div></div></div>';
  } else {
    html += '<div class="ms-box"><div class="ms-box-title">Not In Stock</div><div class="ms-box-body">';
    html += '<div style="color:var(--text-muted);font-size:13px;margin-bottom:12px">This part is not currently in your inventory.</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="showAddSpecificPart(\''+cp.id+'\')">+ Add to Inventory</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="wishlistCurrent()">⭐ Wishlist</button>';
    html += '</div></div></div>';
  }

  // What You Need box
  if(pd){
    html += '<div class="ms-box"><div class="ms-box-title" style="background:#8B0000">🔧 What You Need</div><div class="ms-box-body">';
    if(pd.time) html += '<div class="ms-field"><span class="ms-field-label">Est. Time</span><span class="ms-field-val" style="color:var(--accent)">'+pd.time+'</span></div>';
    if(pd.tools && pd.tools.length){
      html += '<div style="margin-top:10px"><div style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Tools</div>';
      pd.tools.forEach(function(t){ html += '<div style="font-size:12px;padding:3px 0">• '+esc(t)+'</div>'; });
      html += '</div>';
    }
    if(pd.hardware && pd.hardware.length){
      html += '<div style="margin-top:10px"><div style="font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">Also Buy</div>';
      pd.hardware.forEach(function(h){ html += '<div style="font-size:12px;padding:3px 0;color:var(--warning)">• '+esc(h)+'</div>'; });
      html += '</div>';
    }
    if(pd.tip) html += '<div style="margin-top:12px;padding:10px;background:rgba(255,215,0,.06);border-left:3px solid var(--accent);font-size:12px;color:var(--text-muted)">💡 '+esc(pd.tip)+'</div>';
    html += '</div></div>';
  }

  // Common Errors / Symptoms box
  if(commonErrors.length>0){
    html += '<div class="ms-box"><div class="ms-box-title" style="background:#5a4a0a">⚠️ Common Errors / Symptoms</div><div class="ms-box-body">';
    commonErrors.forEach(function(e){
      html += '<div style="font-size:12px;padding:4px 0;color:var(--text)">• '+esc(e)+'</div>';
    });
    html += '</div></div>';
  }

  // Notes
  if(topInv?.notes){
    html += '<div class="ms-box"><div class="ms-box-title">Notes</div><div class="ms-box-body" style="font-size:13px;color:var(--text-muted)">'+esc(topInv.notes)+'</div></div>';
  }

  // Installation History
  if(installs && installs.length>0){
    html += '<div class="ms-box"><div class="ms-box-title">Installation History</div><div class="ms-box-body">';
    installs.forEach(function(i){
      html += '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">';
      html += '<div style="font-weight:600;color:var(--text)">'+(i.vehicles?esc(getVehicleDisplayName(i.vehicles)):'Unknown Vehicle')+'</div>';
      html += '<div style="color:var(--text-muted)">Installed: '+(i.installed_date?fmtDate(i.installed_date):'-')+(i.installed_mileage?' @ '+i.installed_mileage.toLocaleString()+' mi':'')+(i.removed_date?' · Removed: '+fmtDate(i.removed_date):' <span class="badge badge-ok" style="font-size:10px;margin-left:4px">Active</span>')+'</div>';
      if(i.removal_reason) html += '<div style="color:var(--danger);font-size:11px">'+esc(i.removal_reason)+'</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  html += '</div>'; // end right
  html += '</div>'; // end grid

  el.innerHTML = html;
}

// Get display name for a vehicle from notes field (Driver: X format)
function getVehicleDisplayName(v){
  if(!v) return 'Unknown';
  const notes = v.notes || '';
  const driverMatch = notes.match(/Driver:\s*([^.,\n]+)/i);
  if(driverMatch){
    const driver = driverMatch[1].trim();
    return driver+"'s "+v.model;
  }
  return v.year+' '+v.make+' '+v.model;
}


function addToWishlistQ(catalogId,evt){
  const name=(evt?.target||event.target).closest('[data-name]')?.dataset?.name
    || _catalog.find(p=>p.id===catalogId)?.name || 'Unknown Part';
  addToWishlistFromProfile(catalogId,name);
}
function goToVehicles(){closeModal();showView('vehicles');}
function wishlistCurrent(){
  // Open the wishlist modal pre-filled with the current part's info
  const cp = _catalog.find(function(p){return p.id===_currentPartProfile.id;});
  addToWishlistFromProfile(_currentPartProfile.id, _currentPartProfile.name, cp);
}
async function addToWishlistFromProfile(catalogId, name, cp){
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
async function showWishlistModalPrefilled(item){
  const catalogNames = _catalog.map(function(p){return p.name;});
  const customNames = (dbInventory||[]).map(function(p){return p.name;}).filter(function(n){return n && !catalogNames.includes(n);});
  const allNames = catalogNames.concat(customNames);

  let html='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px">';
  html+='<div class="modal-header"><div class="modal-title">Add to Wishlist</div><button class="close-btn" onclick="closeModal()">×</button></div>';
  html+='<div class="modal-body">';
  html+='<div class="form-group"><label>Part Name *</label>';
  html+='<input type="text" class="form-control" id="w-name" value="'+esc(item.name||'')+'" list="w-name-list" oninput="onWishlistNameInput(this.value)" autocomplete="off">';
  html+='<datalist id="w-name-list">';
  allNames.forEach(function(n){ html+='<option value="'+esc(n)+'">'; });
  html+='</datalist></div>';
  html+='<div class="grid-2">';
  html+='<div class="form-group"><label>Part Number / OEM</label><input type="text" class="form-control" id="w-num" value="'+esc(item.part_number||'')+'"></div>';
  html+='<div class="form-group"><label>Priority *</label><select class="form-control" id="w-prio">';
  html+='<option value="">Choose...</option>';
  html+='<option value="High">🔴 High</option>';
  html+='<option value="Medium">🟡 Medium</option>';
  html+='<option value="Low">🟢 Low</option>';
  html+='</select></div>';
  html+='</div>';
  html+='<div class="form-group"><label>Destination *</label><select class="form-control" id="w-dest">';
  html+='<option value="">Choose...</option>';
  const dests=["Nathan\'s 2004 Denali","Cammy\'s 2005 Denali","Jessie\'s 2004 Escalade","Stock"];
  dests.forEach(function(d){
    html+='<option value="'+d+'">'+(d==='Stock'?'📦 General Stock':'🚗 '+d)+'</option>';
  });
  html+='</select></div>';
  html+='<div class="form-group"><label>Notes</label><textarea class="form-control" id="w-notes" rows="2">'+esc(item.notes||'')+'</textarea></div>';
  html+='</div>';
  html+='<div class="modal-footer">';
  html+='<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
  html+='<button class="btn btn-primary" onclick="saveWishlistItem(null)">Add to Wishlist</button>';
  html+='</div></div></div>';
  showModal(html);
}
async function uploadPartPhotoFromProfile(invId,cpId,file){
  if(!file) return;
  if(!invId){
    // No inventory record yet - offer to add
    if(confirm('This part is not in your inventory yet. Add it to inventory first?')){
      showAddSpecificPart(cpId);
    }
    return;
  }
  toast('Uploading...','info');
  try{
    const url=await uploadFile('parts-images',file);
    await db.from('parts').update({image_url:url}).eq('id',invId);
    // Refresh inventory cache
    const {data:inv}=await db.from('parts').select('*');
    dbInventory=inv||[];
    toast('Photo saved!','success');
    // Re-render the full-page part profile
    await renderPartProfile({id:cpId, type:'catalog'});
  }catch(e){toast('Upload error: '+e.message,'error');}
}
function showCatalogEditModal(cpId){
  const cp=_catalog.find(p=>p.id===cpId)||{};
  const pd=getPartDetail(cpId)||{tools:[],hardware:[],time:'',tip:''};
  showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:580px">
    <div class="modal-header"><div class="modal-title">✏️ Edit Part Info</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="alert alert-warning" style="margin-bottom:16px">⚠️ This is a <strong>universal change</strong>  -  updates this part type for all vehicles and all users.</div>
      <div class="form-group"><label>Description</label><textarea class="form-control" id="ce-desc" rows="2">${esc(cp.desc||'')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label>OEM Part Number</label><input class="form-control" id="ce-oem" value="${esc(cp.oem||'')}"></div>
        <div class="form-group"><label>Aftermarket Reference</label><input class="form-control" id="ce-afm" value="${esc(cp.afm||'')}"></div>
      </div>
      <div class="form-group"><label>Estimated Swap Time</label><input class="form-control" id="ce-time" value="${esc(pd.time||'')}" placeholder="e.g. 1-2 hrs"></div>
      <div class="form-group"><label>Tools Needed (one per line)</label><textarea class="form-control" id="ce-tools" rows="4">${(pd.tools||[]).join('\n')}</textarea></div>
      <div class="form-group"><label>Hardware / Also Buy (one per line)</label><textarea class="form-control" id="ce-hardware" rows="3">${(pd.hardware||[]).join('\n')}</textarea></div>
      <div class="form-group"><label>Pro Tip</label><textarea class="form-control" id="ce-tip" rows="2">${esc(pd.tip||'')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCatalogEdit('${cpId}')">Save Changes</button>
    </div>
  </div></div>`);
}
async function saveCatalogEdit(cpId){
  const cp=_catalog.find(p=>p.id===cpId);if(!cp)return;
  cp.desc=document.getElementById('ce-desc').value.trim();
  cp.oem=document.getElementById('ce-oem').value.trim();
  cp.afm=document.getElementById('ce-afm').value.trim();
  const tools=document.getElementById('ce-tools').value.split('\n').map(t=>t.trim()).filter(Boolean);
  const hardware=document.getElementById('ce-hardware').value.split('\n').map(h=>h.trim()).filter(Boolean);
  getPartDetail(cpId)={tools,hardware,time:document.getElementById('ce-time').value.trim(),tip:document.getElementById('ce-tip').value.trim()};
  toast('Part info updated! (Changes last until page refresh - database persistence coming later)','success');
  closeModal();
  await renderPartProfile({id:cpId, type:'catalog'});
}
function openRockAuto(cat,fits){
  const urls={esc:'https://www.rockauto.com/en/catalog/cadillac,2004,escalade,6.0l+v8',yk:'https://www.rockauto.com/en/catalog/gmc,2005,yukon+denali,6.0l+v8',all:'https://www.rockauto.com/en/catalog/gmc,2005,yukon+denali,6.0l+v8'};
  const catMap={Engine:'engine+%26+engine+cooling',Brakes:'brakes+%26+traction+control',Suspension:'steering+%26+suspension',Electrical:'electrical',HVAC:'heat+%26+air+conditioning',Transmission:'transmission+%26+drivetrain',Maintenance:'maintenance'};
  const base=urls[fits]||urls.all;
  window.open(base+(catMap[cat]?','+catMap[cat]:''),'_blank');
}
// ─── INVENTORY LOCATION RENDERER ─────────────────────────────────────────────
function renderInvLocations(inv, partName, partOem){
  if(!inv||!inv.length) return "";
  var Q = String.fromCharCode(39); // single quote character
  return inv.map(function(item){
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
    if(item.quantity > 0){
      html += "<button class=\"btn btn-primary btn-sm\" onclick=\"showInstallPartModal(" + Q + item.id + Q + ",null," + Q + esc(partName||"").replace(/'/g,"&#39;") + Q + "," + Q + esc(item.condition||"").replace(/'/g,"&#39;") + Q + "," + Q + esc(item.shelf_location||"").replace(/'/g,"&#39;") + Q + ")\" style=\"margin-top:4px;width:100%\">&#x1F527; Install on a Car</button>";
    }
    html += "</div></div>";
    return html;
  }).join("");
}

// ─── LOCATION MODAL ───────────────────────────────────────────────────────────
let cameraStream=null;
function stopCamera(){if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}}

function showLocationModal(partId){
  const locs=getLocations();
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
            ${locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Don't see the right location? Use the QR scan option to scan a label from your Brother printer, which will add it automatically.</div>
        <button class="btn btn-primary" onclick="saveLocation('${partId}',document.getElementById('loc-input').value)">Save Location</button>
      </div>
    </div>
  </div></div>`);
}

async function showQRScanner(partId){
  document.getElementById('qr-section').style.display='block';
  document.getElementById('loc-select-section').style.display='none';
  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    const video=document.getElementById('qr-video');
    video.srcObject=cameraStream;
    scanQRLoop(partId);
  }catch(e){document.getElementById('qr-status').textContent='Camera not available. Please use the select option.';document.getElementById('loc-select-section').style.display='block'}
}

function scanQRLoop(partId){
  const video=document.getElementById('qr-video');
  const canvas=document.getElementById('qr-canvas');
  if(!canvas||!video||!cameraStream) return;
  if(video.readyState===video.HAVE_ENOUGH_DATA){
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);
    const img=ctx.getImageData(0,0,canvas.width,canvas.height);
    const code=jsQR&&jsQR(img.data,img.width,img.height);
    if(code&&code.data){
      stopCamera();
      const loc=code.data.trim();
      document.getElementById('qr-status').textContent=`✅ Scanned: "${loc}"`;
      setTimeout(()=>saveLocation(partId,loc),600);
      return;
    }
  }
  requestAnimationFrame(()=>scanQRLoop(partId));
}

async function saveLocation(partId,location){
  if(!location)return toast('Please enter a location','error');
  const locs=getLocations();if(!locs.includes(location)){locs.push(location);saveLocations(locs)}
  const{error}=await db.from('parts').update({shelf_location:location,scanned_to_location_at:new Date().toISOString()}).eq('id',partId);
  if(error){toast(error.message,'error');return}
  toast('Location saved!','success');closeModal();
  invalidate('inventory','dashboard');
  fetchInventory(true).then(inv=>{dbInventory=inv;renderPartsList();});
}

function showAddLocationPrompt(){
  const name=prompt('Enter new location name (e.g. "Shelf C Bin 4"):');
  if(!name)return;const locs=getLocations();if(!locs.includes(name)){locs.push(name);saveLocations(locs)}
  const el=document.getElementById('loc-input');if(el)el.value=name;
  const dl=document.getElementById('loc-list');if(dl)dl.innerHTML=getLocations().map(l=>`<option value="${esc(l)}">`).join('');
  toast('Location added!','success');
}

function showManageLocations(){
  const locs=getLocations();
  showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px">
    <div class="modal-header"><div class="modal-title">Shelf Locations</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">These are the shelf locations in the Chicken Zone. Add locations matching your Brother label maker QR codes.</p>
      ${locs.length===0?'<div style="color:var(--text-dim);font-size:13px">No locations defined yet.</div>':locs.map((l,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-family:\'Barlow Condensed\',sans-serif;font-size:15px">${esc(l)}</span><button class="btn btn-ghost btn-sm" onclick="deleteLocation(${i})">🗑️</button></div>`).join('')}
      <div style="margin-top:16px;display:flex;gap:8px">
        <input type="text" class="form-control" id="new-loc-input" placeholder="e.g. Shelf A Bin 1" style="flex:1">
        <button class="btn btn-primary btn-sm" onclick="addNewLoc()">Add</button>
      </div>
    </div>
  </div></div>`);
}
function addNewLoc(){const v=val('new-loc-input');if(!v)return;const locs=getLocations();if(!locs.includes(v)){locs.push(v);saveLocations(locs)}toast('Location added','success');showManageLocations()}
function deleteLocation(i){const locs=getLocations();locs.splice(i,1);saveLocations(locs);showManageLocations()}

// ─── ADD PART CHOICE ──────────────────────────────────────────────────────────
function showAddPartChoice(){
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
function startAIScan(){
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

async function runAIScan(){
  const file=document.getElementById('ai-receipt-file').files[0];
  const url=val('ai-url');
  if(!file&&!url)return toast('Please upload a receipt or enter a URL','error');
  const statusEl=document.getElementById('ai-status');
  statusEl.style.display='block';statusEl.textContent='🤖 Analyzing receipt...';

  try{
    let imageData=null;
    if(file){
      imageData=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file)});
    }
    const prompt=file?`You are analyzing a parts receipt photo. Extract information and respond ONLY with valid JSON (no markdown, no backticks):
{"part_name":"","part_number":"","source":"","price":"","date_purchased":"","notes":""}
If you cannot determine a value, use empty string. Be concise.`
    :`The user ordered a part from this URL: ${url}
Extract any part info and respond ONLY with valid JSON (no markdown):
{"part_name":"","part_number":"","source":"","price":"","date_purchased":"","notes":""}`;

    const messages=[{role:'user',content:imageData?[{type:'image',source:{type:'base64',media_type:file.type,data:imageData}},{type:'text',text:prompt}]:[{type:'text',text:prompt}]}];
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,messages})});
    const data=await resp.json();
    const raw=data.content?.[0]?.text||'{}';
    const extracted=JSON.parse(raw.replace(/```json?|```/g,'').trim());
    statusEl.textContent='✅ Done! Review and complete the details below.';
    showAIConfirmForm(extracted,file);
  }catch(e){
    statusEl.style.display='none';
    // Fallback: open manual form
    toast('AI scan unavailable  -  using manual form instead','info');
    startManualWizard();
  }
}

function showAIConfirmForm(extracted,receiptFile){
  showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><div class="modal-title">✅ Review & Confirm</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="alert alert-success" style="margin-bottom:16px">AI extracted the details below  -  review and fill in anything missing.</div>
      <div class="grid-2">
        <div class="form-group" style="grid-column:1/-1"><label>Part Name *</label><input type="text" class="form-control" id="cf-name" value="${esc(extracted.part_name||'')}"></div>
        <div class="form-group"><label>Part Number</label><input type="text" class="form-control" id="cf-num" value="${esc(extracted.part_number||'')}"></div>
        <div class="form-group"><label>Price Paid</label><input type="text" class="form-control" id="cf-price" value="${esc(extracted.price||'')}"></div>
        <div class="form-group"><label>Source / Vendor</label><input type="text" class="form-control" id="cf-src" value="${esc(extracted.source||'')}"></div>
        <div class="form-group"><label>Date Purchased</label><input type="date" class="form-control" id="cf-date" value="${extracted.date_purchased||''}"></div>
      </div>
      <div class="divider"></div>
      <div class="grid-2">
        <div class="form-group"><label>Condition *</label>
          <select class="form-control" id="cf-cond"><option value="">Select...</option><option>New</option><option>Used - Good</option><option>Used - Fair</option><option>Used - Poor</option></select>
        </div>
        <div class="form-group"><label>Quantity *</label><input type="number" class="form-control" id="cf-qty" value="1" min="1"></div>
      </div>
      <div class="form-group"><label>Additional Notes</label><textarea class="form-control" id="cf-notes" placeholder="Installation notes, observations, etc.">${esc(extracted.notes||'')}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="showLowStockPrompt(null,'cf')">Next →</button>
    </div>
  </div></div>`);
  window._aiReceiptFile=receiptFile;
}

// ─── MANUAL WIZARD ────────────────────────────────────────────────────────────
function startManualWizard(){wizardStep=1;wizardVehicle=null;wizardCat=null;wizardPart=null;renderWizard()}

function renderWizard(){
  const steps=['Vehicle','Category','Part','Details'];
  const progress=steps.map((s,i)=>`<div class="wizard-dot ${i<wizardStep?'done':''}"></div>`).join('');

  let body='',footer='';

  if(wizardStep===1){
    body=`<div class="wizard-step">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Which vehicle is this part for? (or select Any for all GMT800)</p>
      <div class="cat-grid">
        <div class="cat-btn ${wizardVehicle==='all'?'sel':''}" onclick="wizardSelectVehicle('all')"><div class="cat-icon">🚗</div><div class="cat-name">All GMT800</div><div class="cat-count">All compatible parts</div></div>
        <div class="cat-btn ${wizardVehicle==='esc'?'sel':''}" onclick="wizardSelectVehicle('esc')"><div class="cat-icon">👼</div><div class="cat-name">Jessie's Escalade</div><div class="cat-count">2004 Cadillac</div></div>
        <div class="cat-btn ${wizardVehicle==='yk1'?'sel':''}" onclick="wizardSelectVehicle('yk1')"><div class="cat-icon">🤴</div><div class="cat-name">Nathan's Denali</div><div class="cat-count">2004 GMC</div></div>
        <div class="cat-btn ${wizardVehicle==='yk2'?'sel':''}" onclick="wizardSelectVehicle('yk2')"><div class="cat-icon">👸</div><div class="cat-name">Cammy's Denali</div><div class="cat-count">2005 GMC</div></div>
      </div>
    </div>`;
    footer=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" ${!wizardVehicle?'disabled':''} onclick="wizardStep=2;renderWizard()">Next →</button>`;
  }
  else if(wizardStep===2){
    const filteredCats=getCategories().filter(cat=>{const parts=_catalog.filter(p=>p.cat===cat&&(wizardVehicle==='all'||p.fits==='all'||p.fits===(wizardVehicle==='yk1'||wizardVehicle==='yk2'?'yk':wizardVehicle)));return parts.length>0});
    body=`<div class="wizard-step">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Select a part category:</p>
      <div class="cat-grid" style="max-height:360px;overflow-y:auto">
        ${filteredCats.map(cat=>{
          const count=_catalog.filter(p=>p.cat===cat&&(wizardVehicle==='all'||p.fits==='all'||p.fits===(wizardVehicle==='yk1'||wizardVehicle==='yk2'?'yk':wizardVehicle))).length;
          return`<div class="cat-btn ${wizardCat===cat?'sel':''}" onclick="wizardSelectCat('${cat}')"><div class="cat-icon">${CAT_ICONS[cat]||'🔧'}</div><div class="cat-name">${cat}</div><div class="cat-count">${count} parts</div></div>`;
        }).join('')}
      </div>
    </div>`;
    footer=`<button class="btn btn-secondary" onclick="wizardStep=1;renderWizard()">← Back</button><button class="btn btn-primary" ${!wizardCat?'disabled':''} onclick="wizardStep=3;renderWizard()">Next →</button>`;
  }
  else if(wizardStep===3){
    let catParts=_catalog.filter(p=>p.cat===wizardCat&&(wizardVehicle==='all'||p.fits==='all'||p.fits===(wizardVehicle==='yk1'||wizardVehicle==='yk2'?'yk':wizardVehicle))).sort((a,b)=>a.rank-b.rank);
    body=`<div class="wizard-step">
      <input type="text" class="search-input" id="wiz-search" placeholder="🔍 Search ${wizardCat} parts..." oninput="filterWizardParts(this.value)" style="width:100%;margin-bottom:14px">
      <div id="wiz-parts" style="max-height:340px;overflow-y:auto">
        ${catParts.map(p=>`<div class="part-suggestion ${wizardPart?.id===p.id?'selected':''}" onclick="wizardSelectPart('${p.id}')">
          <div class="ps-name">${esc(p.name)} ${p.rank<=20?`<span class="ps-rank">#${p.rank} most replaced</span>`:''}</div>
          <div class="ps-meta">OEM: ${esc(p.oem||' - ')} · ${esc(p.desc?p.desc.substring(0,80)+'...':'')}</div>
        </div>`).join('')}
      </div>
    </div>`;
    footer=`<button class="btn btn-secondary" onclick="wizardStep=2;renderWizard()">← Back</button><button class="btn btn-primary" ${!wizardPart?'disabled':''} onclick="wizardStep=4;renderWizard()">Next →</button>`;
  }
  else if(wizardStep===4){
    body=`<div class="wizard-step">
      <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
        <strong style="color:var(--accent)">${esc(wizardPart?.name)}</strong><br>
        <span style="color:var(--text-muted)">OEM: ${esc(wizardPart?.oem||' - ')}</span>
      </div>
      <div class="grid-2">
        <div class="form-group"><label>Purchased Part # (if different from OEM)</label><input type="text" class="form-control" id="wz-partnum" placeholder="${esc(wizardPart?.oem||'')}"></div>
        <div class="form-group"><label>Alt OEM / Aftermarket Cross Ref</label><input type="text" class="form-control" id="wz-oem2" placeholder="${esc(wizardPart?.afm||'')}"></div>
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
    footer=`<button class="btn btn-secondary" onclick="wizardStep=3;renderWizard()">← Back</button><button class="btn btn-primary" onclick="showLowStockPrompt('wizard','wz')">Next →</button>`;
  }

  showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:580px">
    <div class="modal-header"><div class="modal-title" style="display:flex;flex-direction:column;gap:2px"><span>Add Part to Inventory</span><span style="font-size:12px;color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">Step ${wizardStep} of 4  -  ${['','Vehicle','Category','Select Part','Details'][wizardStep]}</span></div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="wizard-progress">${progress}</div>
      ${body}
    </div>
    <div class="modal-footer">${footer}</div>
  </div></div>`);
}

function wizardSelectVehicle(v){wizardVehicle=v;renderWizard()}
function wizardSelectCat(c){wizardCat=c;renderWizard()}
function wizardSelectPart(id){wizardPart=_catalog.find(p=>p.id===id);renderWizard()}
function filterWizardParts(search){
  const s=search.toLowerCase();
  const container=document.getElementById('wiz-parts');
  if(!container)return;
  const parts=_catalog.filter(p=>p.cat===wizardCat&&(wizardVehicle==='all'||p.fits==='all'||p.fits===(wizardVehicle==='yk1'||wizardVehicle==='yk2'?'yk':wizardVehicle))&&(p.name.toLowerCase().includes(s)||p.oem.toLowerCase().includes(s)||p.desc.toLowerCase().includes(s))).sort((a,b)=>a.rank-b.rank);
  container.innerHTML=parts.map(p=>`<div class="part-suggestion ${wizardPart?.id===p.id?'selected':''}" onclick="wizardSelectPart('${p.id}')"><div class="ps-name">${esc(p.name)} ${p.rank<=20?`<span class="ps-rank">#${p.rank} most replaced</span>`:''}</div><div class="ps-meta">OEM: ${esc(p.oem||' - ')} · ${esc(p.desc?p.desc.substring(0,80)+'...':'')}</div></div>`).join('');
}

// ─── LOW STOCK PROMPT → SAVE ──────────────────────────────────────────────────
function showLowStockPrompt(source,prefix){
  const name=val(`${prefix}-name`)||wizardPart?.name||'';
  // Snapshot ALL form values before modal is replaced
  window._lsSource=source; window._lsPrefix=prefix;
  window._wizSnap={
    cond:val('wz-cond'),
    qty:parseInt(document.getElementById('wz-qty')?.value)||1,
    partnum:val('wz-partnum'),
    oem2:val('wz-oem2'),
    src:val('wz-src'),
    date:val('wz-date'),
    price:val('wz-price'),
    from:val('wz-from'),
    notes:val('wz-notes'),
    cfName:val('cf-name'),
    cfCond:val('cf-cond'),
    cfQty:parseInt(document.getElementById('cf-qty')?.value)||1,
    cfNum:val('cf-num'),
    cfSrc:val('cf-src'),
    cfDate:val('cf-date'),
    cfPrice:val('cf-price'),
    cfNotes:val('cf-notes'),
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

async function savePartFromWizard(source,prefix,lowStockThreshold){
  let data={created_by:currentUser.id,low_stock_threshold:lowStockThreshold===null?null:lowStockThreshold};
  let receiptFile=null,imgFile=null;

  const snap=window._wizSnap||{};
  if(source==='wizard'){
    if(!wizardPart)return toast('No part selected','error');
    const cond=snap.cond||val('wz-cond');
    const qty=snap.qty||parseInt(document.getElementById('wz-qty')?.value)||1;
    if(!cond)return toast('Please select a condition','error');
    data={...data,catalog_part_id:wizardPart.id,name:wizardPart.name,
      part_number:snap.partnum||val('wz-partnum')||wizardPart.oem||null,
      oem_part_number:snap.oem2||val('wz-oem2')||wizardPart.afm||null,
      condition:cond,quantity:qty,
      source:snap.src||val('wz-src')||null,
      date_acquired:snap.date||val('wz-date')||null,
      price_paid:parseFloat(snap.price||val('wz-price'))||null,
      sourced_from_vehicle:snap.from||val('wz-from')||null,
      notes:snap.notes||val('wz-notes')||null,
      compatible_vehicles:wizardPart.fits==='all'?"Nathan's 2004 Denali, Cammy's 2005 Denali, Jessie's 2004 Escalade":wizardPart.fits==='esc'?"Jessie's 2004 Escalade":"Nathan's 2004 Denali, Cammy's 2005 Denali"};
    receiptFile=document.getElementById('wz-file')?.files[0];
    imgFile=document.getElementById('wz-img')?.files[0];
  } else {
    const name=snap.cfName||val('cf-name');
    const cond=snap.cfCond||val('cf-cond');
    const qty=snap.cfQty||parseInt(document.getElementById('cf-qty')?.value)||1;
    if(!name)return toast('Part name is required','error');
    if(!cond)return toast('Please select a condition','error');
    data={...data,name,
      part_number:snap.cfNum||val('cf-num')||null,
      source:snap.cfSrc||val('cf-src')||null,
      date_acquired:snap.cfDate||val('cf-date')||null,
      price_paid:parseFloat(snap.cfPrice||val('cf-price'))||null,
      notes:snap.cfNotes||val('cf-notes')||null,
      condition:cond,quantity:qty};
    receiptFile=window._aiReceiptFile;
  }

  try{
    if(receiptFile)data.receipt_url=await uploadFile('receipts',receiptFile);
    if(imgFile)data.image_url=await uploadFile('parts-images',imgFile);
  }catch(e){toast('Upload error: '+e.message,'error');return}

  const{error}=await db.from('parts').insert(data);
  if(error){toast(error.message,'error');return}
  toast('Part added to inventory! 🎉','success');
  window._aiReceiptFile=null;
  closeModal();
  invalidate('inventory','dashboard');
  fetchInventory(true).then(inv=>{dbInventory=inv;renderPartsList();});
}

// ─── ADD SPECIFIC PART (from profile) ────────────────────────────────────────
function showAddSpecificPart(catalogId){
  wizardPart=_catalog.find(p=>p.id===catalogId);
  if(!wizardPart)return;
  wizardStep=4;wizardVehicle='all';wizardCat=wizardPart.cat;
  closeModal();setTimeout(renderWizard,50);
}

async function showEditInventoryModal(invId,catalogId){
  if(!invId)return showAddSpecificPart(catalogId);
  const{data:p}=await db.from('parts').select('*').eq('id',invId).single();
  if(!p)return;
  const cp=_catalog.find(x=>x.id===catalogId);
  showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal">
    <div class="modal-header"><div class="modal-title">Edit Inventory Record</div><button class="close-btn" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      <div class="grid-2">
        <div class="form-group"><label>Part Number (Purchased)</label><input type="text" class="form-control" id="ep-num" value="${esc(p.part_number||cp?.oem||'')}"></div>
        <div class="form-group"><label>Alt OEM / Cross Ref</label><input type="text" class="form-control" id="ep-oem2" value="${esc(p.oem_part_number||cp?.afm||'')}"></div>
        <div class="form-group"><label>Condition</label><select class="form-control" id="ep-cond"><option value="">Select...</option>${['New','Used - Good','Used - Fair','Used - Poor'].map(c=>`<option ${p.condition===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label>Quantity</label><input type="number" class="form-control" id="ep-qty" value="${p.quantity}" min="0"></div>
        <div class="form-group"><label>Source</label><input type="text" class="form-control" id="ep-src" value="${esc(p.source||'')}"></div>
        <div class="form-group"><label>Price Paid</label><input type="text" class="form-control" id="ep-price" value="${esc(p.price_paid||'')}"></div>
        <div class="form-group"><label>Date Acquired</label><input type="date" class="form-control" id="ep-date" value="${p.date_acquired||''}"></div>
        <div class="form-group"><label>Low Stock Alert At</label><input type="number" class="form-control" id="ep-low" value="${p.low_stock_threshold||1}" min="0"></div>
      </div>
      <div class="form-group"><label>Intended For Vehicle</label>
        <select class="form-control" id="ep-from">
          <option value="">General Stock</option>
          <option value="Nathan's 2004 Denali" ${p.sourced_from_vehicle==="Nathan's 2004 Denali"?'selected':''}>Nathan's 2004 Denali</option>
          <option value="Cammy's 2005 Denali" ${p.sourced_from_vehicle==="Cammy's 2005 Denali"?'selected':''}>Cammy's 2005 Denali</option>
          <option value="Jessie's 2004 Escalade" ${p.sourced_from_vehicle==="Jessie's 2004 Escalade"?'selected':''}>Jessie's 2004 Escalade</option>
        </select>
      </div>
      <div class="form-group"><label>Shop URL</label><input type="text" class="form-control" id="ep-shop" value="${esc(p.shop_url||'')}" placeholder="https://..."></div>
      <div class="form-group"><label>Notes</label><textarea class="form-control" id="ep-notes">${esc(p.notes||'')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label>Update Receipt</label><input type="file" class="form-control" id="ep-receipt" accept="image/*,.pdf">${p.receipt_url?`<a href="${p.receipt_url}" target="_blank" style="font-size:12px;color:var(--accent)">View current</a>`:''}</div>
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

async function saveEditInventory(id){
  let data={part_number:val('ep-num')||null,oem_part_number:val('ep-oem2')||null,condition:val('ep-cond')||null,quantity:parseInt(document.getElementById('ep-qty').value)||0,source:val('ep-src')||null,price_paid:parseFloat(val('ep-price'))||null,date_acquired:val('ep-date')||null,low_stock_threshold:parseInt(document.getElementById('ep-low').value)||1,sourced_from_vehicle:val('ep-from')||null,shop_url:val('ep-shop')||null,notes:val('ep-notes')||null};
  const rf=document.getElementById('ep-receipt').files[0];const imgf=document.getElementById('ep-img').files[0];
  try{if(rf)data.receipt_url=await uploadFile('receipts',rf);if(imgf)data.image_url=await uploadFile('parts-images',imgf)}catch(e){toast('Upload error','error');return}
  const{error}=await db.from('parts').update(data).eq('id',id);
  if(error){toast(error.message,'error');return}
  toast('Updated!','success');closeModal();
  invalidate('inventory','dashboard');
  fetchInventory(true).then(inv=>{dbInventory=inv;renderPartsList();});
}

async function confirmDeleteInv(id,name){
  if(!confirm(`Remove "${name}" from inventory?`))return;
  await db.from('parts').delete().eq('id',id);toast('Removed from inventory','success');closeModal();
  invalidate('inventory','dashboard');
  fetchInventory(true).then(inv=>{dbInventory=inv;renderPartsList();});
}

function printPartLabel(name,qrUrl,oem,location){
  const w=window.open('','_blank');
  w.document.write(`<html><head><title>Label</title><style>body{font-family:Arial,sans-serif;display:flex;justify-content:center;padding:20px;background:#fff}.label{border:2px solid #000;padding:14px;width:280px;text-align:center;border-radius:4px}h2{font-size:14px;margin:8px 0 3px;font-weight:bold}p{font-size:11px;margin:2px 0;color:#444}.footer{font-size:9px;color:#999;margin-top:8px}</style></head><body onload="window.print()"><div class="label"><img src="${qrUrl}" width="120" height="120"><h2>${name}</h2>${oem?`<p><strong>OEM:</strong> ${oem}</p>`:''}${location?`<p><strong>Loc:</strong> ${location}</p>`:''}<p class="footer">🐔 Chicken Zone</p></div></body></html>`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VEHICLES ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// ─── VEHICLES LIST PAGE ──────────────────────────────────────────────────────
async function renderVehicles(){
  const el=document.getElementById('view-vehicles');
  let vehicles=[];
  try{
    if(!_cache.vehicles) el.innerHTML=viewLoading('Loading vehicles...');
    vehicles=await fetchVehicles();
  }catch(err){
    el.innerHTML=errBox(err.message);
    console.error(err);
    return;
  }

  let html='';
  html+='<div class="page-header"><div style="text-align:center;flex:1"><div class="page-title" style="font-size:42px;text-align:center">Vehicles</div><div class="page-subtitle" style="font-size:12px;text-align:center">Car Profiles</div></div>';
  html+='<div style="display:flex;gap:8px;flex-wrap:wrap">';
  html+='<button class="btn btn-primary" onclick="showVehicleModal()">+ New Vehicle</button>';
  html+='<button class="btn btn-secondary" onclick="toast(\'Guest car feature coming soon!\',\'info\')">+ Guest</button>';
  html+='</div></div>';

  if(!vehicles || vehicles.length===0){
    html+='<div class="empty-state"><div class="empty-icon">🚗</div><p>No vehicles yet</p></div>';
  } else {
    html+='<div class="vehicle-grid">';
    vehicles.forEach(function(v){
      const driverName=getVehicleDisplayName(v);
      const subtitle=[v.make,v.model,v.trim].filter(Boolean).join(' ').replace(/\s+AWD$/,'');
      html+='<div class="vehicle-card" onclick="showView(\'vehicle-profile\',{id:\''+v.id+'\'})">';
      html+='<div class="vehicle-year-bg">'+v.year+'</div>';
      html+='<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:22px;font-weight:700;text-transform:uppercase;color:var(--text)">'+esc(driverName)+'</div>';
      html+='<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;display:flex;align-items:center;gap:8px">'+esc(subtitle);
      if(v.color) html+='<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+colorToCss(v.color)+';border:1px solid rgba(255,255,255,.2);flex-shrink:0" title="'+esc(v.color)+'"></span>';
      html+='</div>';
      html+='<div style="font-size:13px;color:var(--text-muted)">🛣 <span style="color:var(--text);font-weight:600">'+(v.current_mileage||0).toLocaleString()+'</span> miles</div>';
      if(v.vin) html+='<div style="font-size:11px;color:var(--text-dim);margin-top:4px">VIN: '+esc(v.vin)+'</div>';
      html+='<div class="flex-row no-print" style="margin-top:14px;flex-wrap:wrap;gap:6px" onclick="event.stopPropagation()">';
      html+='<button class="btn btn-secondary btn-sm" onclick="showLogMileageModal(\''+v.id+'\')">🛣 Log Miles</button>';
      html+='<button class="btn btn-secondary btn-sm" onclick="printVehicleProfile(\''+v.id+'\')">🖨️</button>';
      html+='</div>';
      html+='</div>';
    });
    html+='</div>';
  }
  el.innerHTML=html;
}

// Legacy - make sure anything calling openVehicleDetail still works
function openVehicleDetail(id){
  showView('vehicle-profile', {id:id});
}

// Refresh vehicle data - stays on current view (list or profile)
async function refreshVehicleView(){
  if(_currentVehicleProfile.id){
    await renderVehicleProfile({id: _currentVehicleProfile.id});
  } else {
    await renderVehicles();
  }
}



// ─── VEHICLE PROFILE - FULL PAGE VIEW ────────────────────────────────────────
let _currentVehicleProfile={id:null,tab:'overview'};

async function renderVehicleProfile(arg){
  const el=document.getElementById('view-vehicle-profile');
  if(!el) return;
  el.innerHTML=viewLoading('Loading vehicle...');

  const id = arg?.id;
  if(!id){
    el.innerHTML='<div style="padding:60px"><button class="btn btn-secondary btn-sm" onclick="showView(\'vehicles\')">← Back to Vehicles</button></div>';
    return;
  }

  // Preserve tab from previous render or use default
  if(_currentVehicleProfile.id !== id){
    _currentVehicleProfile = {id:id, tab:'overview'};
  }

  let v=null, services=[], reminders=[], installs=[], mileLogs=[];
  try{
    const vRes = await withTimeout(db.from('vehicles').select('*').eq('id',id).single());
    v = vRes.data;
    if(!v) throw new Error('Vehicle not found');
    const r = await withTimeout(Promise.all([
      db.from('service_history').select('*').eq('vehicle_id',id).order('performed_date',{ascending:false}),
      db.from('maintenance_reminders').select('*').eq('vehicle_id',id).eq('is_active',true).order('created_at'),
      db.from('part_installations').select('*,parts(name,part_number,condition,catalog_part_id)').eq('vehicle_id',id).order('installed_date',{ascending:false}),
      db.from('mileage_logs').select('*').eq('vehicle_id',id).order('logged_at',{ascending:false}).limit(6)
    ]));
    services = r[0].data || [];
    reminders = r[1].data || [];
    installs = r[2].data || [];
    mileLogs = r[3].data || [];
  }catch(err){
    el.innerHTML='<div style="padding:32px"><button class="btn btn-secondary btn-sm" onclick="showView(\'vehicles\')">← Back</button><div class="alert alert-danger" style="margin-top:16px">Error loading vehicle: '+err.message+'</div></div>';
    return;
  }

  const today = new Date();
  const dueReminders = reminders.filter(function(r){
    if(r.snoozed_until_date && new Date(r.snoozed_until_date) > today) return false;
    if(r.next_due_date && new Date(r.next_due_date) <= today) return true;
    if(r.next_due_mileage && (v.current_mileage||0) >= r.next_due_mileage) return true;
    return false;
  });

  const driverName = getVehicleDisplayName(v);
  const subtitle = [v.make, v.model, v.trim].filter(Boolean).join(' ').replace(/\s+AWD$/,'');

  // Extract engine and transmission from notes
  const engineMatch = (v.notes||'').match(/Engine:\s*([^.,\n]+)/i);
  const transMatch = (v.notes||'').match(/Trans(?:mission)?:\s*([^.,\n]+)/i);
  const interiorMatch = (v.notes||'').match(/([A-Za-z]+)\s+interior/i);
  const engine = engineMatch ? engineMatch[1].trim() : '';
  const transmission = transMatch ? transMatch[1].trim() : '';
  const interiorColor = interiorMatch ? interiorMatch[1] : '';

  const tab = _currentVehicleProfile.tab || 'overview';

  let html = '';

  // Hero header matching the list card style
  html += '<div style="background:linear-gradient(135deg,#0a0a1a 0%,#151525 100%);margin:-32px -32px 24px -32px;padding:28px 32px;border-bottom:2px solid var(--accent);position:relative;overflow:hidden">';
  html += '<button class="btn btn-ghost btn-sm" onclick="showView(\'vehicles\')" style="margin-bottom:12px">← Back to Vehicles</button>';
  html += '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:120px;color:var(--accent);line-height:1;opacity:.15;position:absolute;right:24px;top:30px">'+v.year+'</div>';
  html += '<div style="position:relative">';
  html += '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:40px;font-weight:700;text-transform:uppercase;color:var(--text);line-height:1">'+esc(driverName)+'</div>';
  html += '<div style="color:var(--text-muted);font-size:14px;margin-top:4px;display:flex;align-items:center;gap:10px">'+esc(subtitle);
  if(v.color) html += '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+colorToCss(v.color)+';border:1px solid rgba(255,255,255,.2)" title="'+esc(v.color)+'"></span>';
  html += '</div>';
  html += '<div style="color:var(--text-muted);font-size:13px;margin-top:12px">🛣 <strong style="color:var(--text)">'+(v.current_mileage||0).toLocaleString()+'</strong> miles'+(v.vin?' · VIN: '+esc(v.vin):'')+'</div>';
  html += '<div class="flex-row no-print" style="flex-wrap:wrap;gap:6px;margin-top:16px">';
  html += '<button class="btn btn-secondary btn-sm" onclick="showLogMileageModal(\''+id+'\')">🛣 Log Miles</button>';
  html += '<button class="btn btn-secondary btn-sm" onclick="showVehicleModal(\''+id+'\')">✏️ Edit</button>';
  html += '<button class="btn btn-secondary btn-sm" onclick="printVehicleProfile(\''+id+'\')">🖨️ Print</button>';
  html += '<button class="btn btn-danger btn-sm" onclick="confirmDeleteVehicle(\''+id+'\',\''+esc(driverName).replace(/'/g,'&#39;')+'\')">🗑️</button>';
  html += '</div></div></div>';

  // Due reminders banner
  if(dueReminders.length > 0){
    html += '<div class="alert alert-warning" style="margin-bottom:20px">⚠️ <strong>'+dueReminders.length+' maintenance item'+(dueReminders.length>1?'s':'')+' due</strong></div>';
  }

  // Tabs
  html += '<div class="tabs no-print">';
  const tabs = [
    {id:'overview', label:'Overview'},
    {id:'service', label:'Service History ('+services.length+')'},
    {id:'parts', label:'Installed Parts ('+installs.filter(function(i){return !i.removed_date;}).length+')'},
    {id:'photos', label:'Photos'},
    {id:'reminders', label:'Maintenance ('+reminders.length+')'}
  ];
  tabs.forEach(function(t){
    html += '<div class="tab '+(tab===t.id?'active':'')+'" onclick="setVehicleTab(\''+t.id+'\')">'+t.label+'</div>';
  });
  html += '</div>';

  html += '<div id="vehicle-tab-content">';
  if(tab==='overview') html += renderVehicleOverview(v, engine, transmission, interiorColor, mileLogs, services, installs);
  else if(tab==='service') html += renderServiceTab(services, id);
  else if(tab==='parts') html += renderPartsTab(installs, id);
  else if(tab==='photos') html += renderPhotosTab(v);
  else if(tab==='reminders') html += renderRemindersTab(reminders, v, id);
  html += '</div>';

  el.innerHTML = html;
}

function setVehicleTab(tab){
  _currentVehicleProfile.tab = tab;
  renderVehicleProfile({id: _currentVehicleProfile.id});
}

function renderVehicleOverview(v, engine, transmission, interiorColor, mileLogs, services, installs){
  const active = (installs||[]).filter(function(i){return !i.removed_date;});
  let html = '<div class="grid-2" style="gap:16px">';

  // Left: specs
  html += '<div class="card"><div class="stat-label" style="margin-bottom:12px">Vehicle Specs</div>';
  html += '<div class="detail-field" style="margin-bottom:10px"><label>Engine</label><div class="value" style="font-family:\'Barlow Condensed\',sans-serif;font-size:18px;color:var(--accent)">'+esc(engine||'Not specified')+'</div></div>';
  html += '<div class="detail-field" style="margin-bottom:10px"><label>Transmission</label><div class="value" style="font-family:\'Barlow Condensed\',sans-serif;font-size:18px;color:var(--accent)">'+esc(transmission||'Not specified')+'</div></div>';
  if(interiorColor){
    html += '<div class="detail-field" style="margin-bottom:10px"><label>Interior</label><div class="value" style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:'+colorToCss(interiorColor)+';border:1px solid rgba(255,255,255,.2)"></span>'+esc(interiorColor)+'</div></div>';
  }
  html += '</div>';

  // Right: mileage
  html += '<div class="card"><div class="stat-label" style="margin-bottom:12px">Recent Mileage Logs</div>';
  if((mileLogs||[]).length===0){
    html += '<div style="color:var(--text-muted);font-size:13px">No mileage logged yet</div>';
  } else {
    mileLogs.forEach(function(l){
      html += '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">';
      html += '<span style="font-weight:600;font-family:\'Barlow Condensed\',sans-serif;font-size:16px">'+l.mileage.toLocaleString()+' mi</span>';
      html += '<span style="color:var(--text-muted)">'+fmtDate(l.logged_at)+'</span>';
      html += '</div>';
    });
  }
  html += '</div>';

  html += '</div>';

  // Stats row
  html += '<div class="grid-2" style="gap:16px;margin-top:16px">';
  html += '<div class="stat-card"><div class="stat-label">Service Records</div><div class="stat-value">'+services.length+'</div></div>';
  html += '<div class="stat-card"><div class="stat-label">Active Parts</div><div class="stat-value">'+active.length+'</div></div>';
  html += '</div>';

  // Notes
  if(v.notes){
    // Filter out the structured fields from notes for display
    let cleanNotes = v.notes
      .replace(/Driver:\s*[^.,\n]+[.,]?\s*/i, '')
      .replace(/Engine:\s*[^.,\n]+[.,]?\s*/i, '')
      .replace(/Trans(?:mission)?:\s*[^.,\n]+[.,]?\s*/i, '')
      .replace(/Automatic\s+climate\s+control[.,]?\s*/i, '')
      .replace(/[A-Za-z]+\s+interior[.,]?\s*/i, '')
      .trim();
    if(cleanNotes){
      html += '<div class="card" style="margin-top:16px"><div class="stat-label" style="margin-bottom:8px">Notes</div><div style="font-size:13px;color:var(--text-muted);line-height:1.6">'+esc(cleanNotes)+'</div></div>';
    }
  }

  return html;
}

// Photos tab - skeleton for Phase 2
function renderPhotosTab(v){
  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px" class="no-print">';
  html += '<div style="color:var(--text-muted);font-size:13px">Upload condition photos with date stamps. Tag as exterior, interior, or damage.</div>';
  html += '<button class="btn btn-primary btn-sm" onclick="toast(\'Photo upload coming in Phase 2\',\'info\')">+ Upload Photo</button>';
  html += '</div>';
  html += '<div class="empty-state"><div class="empty-icon">📸</div><p>Photo album coming in Phase 2</p><div style="font-size:12px;color:var(--text-dim);margin-top:8px">This tab will show your uploaded photos, tagged by location and condition, with update reminders every year.</div></div>';
  return html;
}


async function showVehicleModal(id=null){let v=null;if(id){const{data}=await db.from('vehicles').select('*').eq('id',id).single();v=data}showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">${v?'Edit Vehicle':'Add Vehicle'}</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="grid-3"><div class="form-group"><label>Year *</label><input type="number" class="form-control" id="v-year" value="${v?.year||''}" placeholder="2006"></div><div class="form-group" style="grid-column:span 2"><label>Make *</label><input type="text" class="form-control" id="v-make" value="${esc(v?.make||'')}" placeholder="Cadillac, GMC, Chevrolet..."></div></div><div class="grid-2"><div class="form-group"><label>Model *</label><input type="text" class="form-control" id="v-model" value="${esc(v?.model||'')}" placeholder="Escalade, Yukon, Avalanche..."></div><div class="form-group"><label>Trim</label><input type="text" class="form-control" id="v-trim" value="${esc(v?.trim||'')}" placeholder="Denali, EXT, LTZ..."></div></div><div class="grid-2"><div class="form-group"><label>Color</label><input type="text" class="form-control" id="v-color" value="${esc(v?.color||'')}" placeholder="Black, Silver..."></div><div class="form-group"><label>Current Mileage</label><input type="number" class="form-control" id="v-miles" value="${v?.current_mileage||''}"></div></div><div class="form-group"><label>VIN</label><input type="text" class="form-control" id="v-vin" value="${esc(v?.vin||'')}"></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="v-notes">${esc(v?.notes||'')}</textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveVehicle(${v?`'${v.id}'`:'null'})">${v?'Save':'Add Vehicle'}</button></div></div></div>`);}

async function saveVehicle(id){const year=parseInt(document.getElementById('v-year').value);const make=val('v-make'),model=val('v-model');if(!year||!make||!model)return toast('Year, make, and model are required','error');const data={year,make,model,trim:val('v-trim')||null,color:val('v-color')||null,current_mileage:parseInt(document.getElementById('v-miles').value)||0,vin:val('v-vin')||null,notes:val('v-notes')||null};let error;if(id){({error}=await db.from('vehicles').update(data).eq('id',id))}else{data.created_by=currentUser.id;({error}=await db.from('vehicles').insert(data))}if(error){toast(error.message,'error');return}toast(id?'Vehicle updated!':'Vehicle added!','success');invalidate('vehicles','dashboard');closeModal();await refreshVehicleView()}

async function confirmDeleteVehicle(id,name){if(!confirm(`Delete "${name}" and all history?`))return;await db.from('vehicles').delete().eq('id',id);_currentVehicleProfile={id:null,tab:'overview'};invalidate('vehicles','dashboard');toast('Deleted','success');await showView('vehicles')}

async function showLogMileageModal(vehicleId){const{data:v}=await db.from('vehicles').select('year,make,model,current_mileage').eq('id',vehicleId).single();showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Log Mileage</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div style="margin-bottom:16px;padding:12px;background:var(--surface);border-radius:6px;font-size:13px"><strong>${v?`${v.year} ${v.make} ${v.model}`:'Vehicle'}</strong><br><span style="color:var(--text-muted)">Current: <strong>${(v?.current_mileage||0).toLocaleString()} mi</strong></span></div><div class="form-group"><label>New Mileage Reading *</label><input type="number" class="form-control" id="ml-miles" placeholder="e.g. 155000"></div><div class="form-group"><label>Note</label><input type="text" class="form-control" id="ml-note" placeholder="e.g. After road trip"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="logMileage('${vehicleId}')">Log Mileage</button></div></div></div>`)}

async function logMileage(vehicleId){const mileage=parseInt(document.getElementById('ml-miles').value);if(!mileage)return toast('Please enter mileage','error');const[{error:e1},{error:e2}]=await Promise.all([db.from('mileage_logs').insert({vehicle_id:vehicleId,mileage,notes:val('ml-note')||null}),db.from('vehicles').update({current_mileage:mileage}).eq('id',vehicleId)]);if(e1||e2){toast('Error','error');return}toast('Mileage logged!','success');closeModal();await refreshVehicleView()}

async function showServiceModal(vehicleId){showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">Add Service Record</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Service Type *</label><input type="text" class="form-control" id="sr-type" list="svc-list" placeholder="e.g. Oil Change"><datalist id="svc-list"><option>Oil Change</option><option>Tire Rotation</option><option>Brake Job</option><option>Transmission Service</option><option>Coolant Flush</option><option>Spark Plugs</option><option>Air Filter</option><option>Water Pump</option><option>Alternator</option><option>Ball Joints</option><option>Wheel Bearings</option><option>Alignment</option><option>Differential Fluid</option><option>Transfer Case Fluid</option></datalist></div><div class="form-group"><label>Description</label><textarea class="form-control" id="sr-desc" placeholder="Details about work performed..."></textarea></div><div class="grid-2"><div class="form-group"><label>Date</label><input type="date" class="form-control" id="sr-date" value="${new Date().toISOString().split('T')[0]}"></div><div class="form-group"><label>Mileage</label><input type="number" class="form-control" id="sr-miles"></div></div><div class="form-group"><label>Performed By</label><input type="text" class="form-control" id="sr-by" placeholder="e.g. Dad, Shop"></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="sr-notes"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveServiceRecord('${vehicleId}')">Add Record</button></div></div></div>`)}

async function saveServiceRecord(vehicleId){const t=val('sr-type');if(!t)return toast('Service type required','error');const{error}=await db.from('service_history').insert({vehicle_id:vehicleId,service_type:t,description:val('sr-desc')||null,performed_date:val('sr-date')||null,mileage_at_service:parseInt(document.getElementById('sr-miles').value)||null,performed_by:val('sr-by')||null,notes:val('sr-notes')||null});if(error){toast(error.message,'error');return}toast('Record added!','success');invalidate('vehicles','dashboard');closeModal();invalidate('vehicles','dashboard');await refreshVehicleView()}

async function deleteServiceRecord(id){if(!confirm('Delete this record?'))return;await db.from('service_history').delete().eq('id',id);toast('Deleted','success');invalidate('vehicles','dashboard');await refreshVehicleView()}

async function showInstallPartModal(invId, cpId, partName, condition, location){
  var compatVehicles=_cache.vehicles||[];
  if(cpId){
    var cp=_catalog.find(function(p){return p.id===cpId;});
    if(cp&&cp.fits!=='all'){
      compatVehicles=compatVehicles.filter(function(v){
        return cp.fits==='esc'?v.make==='Cadillac':cp.fits==='yk'?v.make==='GMC':true;
      });
    }
  }
  var opts='<option value="">Select vehicle...</option>';
  compatVehicles.forEach(function(v){opts+='<option value="'+v.id+'">'+esc(getVehicleDisplayName(v))+'</option>';});
  var partDisplay=partName?('<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:16px"><div style="font-weight:600;font-size:15px">'+esc(partName)+'</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">'+(condition?'Condition: '+esc(condition)+'&nbsp;&nbsp;':'')+(location?'Location: '+esc(location):'No location set')+'</div></div>'):'';
  var partField;
  if(invId){
    partField='<input type="hidden" id="ip-part" value="'+invId+'">';
  } else {
    var invOpts='<option value="">Select...</option>';
    (_cache.inventory||[]).filter(function(p){return p.quantity>0;}).sort(function(a,b){return(a.date_acquired||'').localeCompare(b.date_acquired||'');}).forEach(function(p){invOpts+='<option value="'+p.id+'">'+esc(p.name)+(p.part_number?' #'+esc(p.part_number):'')+'</option>';});
    partField='<div class="form-group"><label>Part from Inventory *</label><select class="form-control" id="ip-part">'+invOpts+'</select></div>';
  }
  showModal('<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px"><div class="modal-header"><div class="modal-title">Install Part</div><button class="close-btn" onclick="closeModal()">&times;</button></div><div class="modal-body">'+partDisplay+partField+'<div class="form-group"><label>Install On *</label><select class="form-control" id="ip-vehicle">'+opts+'</select></div><div class="grid-2"><div class="form-group"><label>Date Installed</label><input type="date" class="form-control" id="ip-date" value="'+new Date().toISOString().split('T')[0]+'"></div><div class="form-group"><label>Mileage at Install</label><input type="number" class="form-control" id="ip-miles" placeholder="e.g. 155000"></div></div><div class="form-group"><label>How Long Did It Take?</label><input type="text" class="form-control" id="ip-time" placeholder="e.g. 2 hrs, 45 min"></div><div class="form-group"><label>Notes</label><textarea class="form-control" id="ip-notes" rows="2"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveInstallFromModal()">Install Part</button></div></div></div>');
}


function saveInstallFromModal(){
  var v=document.getElementById('ip-vehicle');
  saveInstall(v?v.value:'');
}

async function saveInstall(vehicleId){
  if(!vehicleId)return toast('Please select a vehicle','error');
  const partId=document.getElementById('ip-part').value;
  if(!partId)return toast('Please select a part','error');
  const timeTaken=val('ip-time')||null;
  const{data:p}=await db.from('parts').select('quantity,name,catalog_part_id').eq('id',partId).single();
  const{error}=await db.from('part_installations').insert({
    part_id:partId,vehicle_id:vehicleId,
    installed_date:val('ip-date')||null,
    installed_mileage:parseInt(document.getElementById('ip-miles').value)||null,
    time_taken:timeTaken,
    notes:val('ip-notes')||null
  });
  if(error){toast(error.message,'error');return;}
  const newQty=(p&&p.quantity>0)?p.quantity-1:0;
  if(p&&p.quantity>0) await db.from('parts').update({quantity:newQty}).eq('id',partId);
  invalidate('inventory','vehicles','dashboard');
  closeModal();
  toast('Part installed!','success');
  if(newQty===0){
    var pname=p?p.name:'this part';
    var pcid=p?p.catalog_part_id:null;
    setTimeout(function(){
      if(confirm('Last one used! Add '+pname+' to wishlist to restock?')){
        showWishlistModalPrefilled({id:null,name:pname,part_number:null,priority:'High',compatible_vehicles:'',notes:'Restocking - last unit installed'});
      }
    },400);
  }
  await refreshVehicleView();
}

async function showRemovePartModal(installId){showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Mark Part Removed</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Date Removed</label><input type="date" class="form-control" id="rp-date" value="${new Date().toISOString().split('T')[0]}"></div><div class="form-group"><label>Reason</label><input type="text" class="form-control" id="rp-reason" placeholder="e.g. Failed early, Upgraded, Swapped"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="markRemoved('${installId}')">Confirm</button></div></div></div>`)}

async function markRemoved(installId){const{error}=await db.from('part_installations').update({removed_date:val('rp-date')||new Date().toISOString().split('T')[0],removal_reason:val('rp-reason')||null}).eq('id',installId);if(error){toast(error.message,'error');return}toast('Marked removed','success');invalidate('vehicles','dashboard');closeModal();invalidate('vehicles','dashboard');await refreshVehicleView()}

async function showReminderModal(vehicleId){showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><div class="modal-title">Add Maintenance Reminder</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-group"><label>Title *</label><input type="text" class="form-control" id="mr-title" list="rem-list" placeholder="e.g. Oil Change"><datalist id="rem-list"><option>Oil Change</option><option>Tire Rotation</option><option>Brake Inspection</option><option>Transmission Fluid</option><option>Coolant Flush</option><option>Spark Plugs</option><option>Air Filter</option><option>Differential Fluid</option><option>Transfer Case Fluid</option><option>Ball Joint Inspection</option></datalist></div><div class="form-group"><label>Description</label><input type="text" class="form-control" id="mr-desc"></div><div class="form-group"><label>Reminder Type</label><select class="form-control" id="mr-type" onchange="toggleRF()"><option value="mileage">Mileage Based</option><option value="time">Time Based</option><option value="both">Both</option></select></div><div class="grid-2"><div class="form-group" id="mr-mg"><label>Interval (Miles)</label><input type="number" class="form-control" id="mr-miles" placeholder="e.g. 5000"></div><div class="form-group" id="mr-dg" style="display:none"><label>Interval (Days)</label><input type="number" class="form-control" id="mr-days" placeholder="e.g. 180"></div></div><div class="grid-2"><div class="form-group"><label>Last Done Date</label><input type="date" class="form-control" id="mr-ld"></div><div class="form-group"><label>Last Done Mileage</label><input type="number" class="form-control" id="mr-lm"></div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveReminder('${vehicleId}')">Add</button></div></div></div>`)}

function toggleRF(){const t=document.getElementById('mr-type').value;document.getElementById('mr-mg').style.display=(t==='mileage'||t==='both')?'block':'none';document.getElementById('mr-dg').style.display=(t==='time'||t==='both')?'block':'none'}

async function saveReminder(vehicleId){const title=val('mr-title');if(!title)return toast('Title required','error');const type=document.getElementById('mr-type').value;const im=parseInt(document.getElementById('mr-miles').value)||null,id=parseInt(document.getElementById('mr-days').value)||null,ld=val('mr-ld')||null,lm=parseInt(document.getElementById('mr-lm').value)||null;let nd=null,nm=null;if(ld&&id){const d=new Date(ld);d.setDate(d.getDate()+id);nd=d.toISOString().split('T')[0]}if(lm&&im)nm=lm+im;const{error}=await db.from('maintenance_reminders').insert({vehicle_id:vehicleId,title,description:val('mr-desc')||null,reminder_type:type,interval_miles:im,interval_days:id,last_done_date:ld,last_done_mileage:lm,next_due_date:nd,next_due_mileage:nm});if(error){toast(error.message,'error');return}toast('Reminder added!','success');invalidate('vehicles','dashboard');closeModal();invalidate('vehicles','dashboard');await refreshVehicleView()}

async function markReminderDone(reminderId,vehicleId,currentMileage){const{data:r}=await db.from('maintenance_reminders').select('*').eq('id',reminderId).single();if(!r)return;const today=new Date().toISOString().split('T')[0];let nd=null,nm=null;if(r.interval_days){const d=new Date();d.setDate(d.getDate()+r.interval_days);nd=d.toISOString().split('T')[0]}if(r.interval_miles&&currentMileage)nm=parseInt(currentMileage)+r.interval_miles;await Promise.all([db.from('maintenance_reminders').update({last_done_date:today,last_done_mileage:currentMileage||null,next_due_date:nd,next_due_mileage:nm,snoozed_until_date:null,snoozed_until_mileage:null}).eq('id',reminderId),db.from('service_history').insert({vehicle_id:vehicleId,service_type:r.title,description:'Completed via maintenance reminder',performed_date:today,mileage_at_service:currentMileage||null})]);toast('Done! Service record logged.','success');invalidate('vehicles','dashboard');await refreshVehicleView()}

async function showSnoozeModal(reminderId,title){showModal(`<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Snooze Reminder</div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body"><div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">Snoozing: <strong style="color:var(--text)">${esc(title)}</strong></div><div class="form-group"><label>Snooze Until Date</label><input type="date" class="form-control" id="sn-date"></div><div style="text-align:center;color:var(--text-dim);font-size:12px;margin:4px 0"> -  or  - </div><div class="form-group"><label>Snooze Until Mileage</label><input type="number" class="form-control" id="sn-miles"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="snoozeReminder('${reminderId}')">Snooze</button></div></div></div>`)}

async function snoozeReminder(id){const sd=val('sn-date')||null,sm=parseInt(document.getElementById('sn-miles').value)||null;if(!sd&&!sm)return toast('Enter date or mileage','error');await db.from('maintenance_reminders').update({snoozed_until_date:sd,snoozed_until_mileage:sm}).eq('id',id);toast('Snoozed!','success');invalidate('vehicles','dashboard');closeModal();invalidate('vehicles','dashboard');await refreshVehicleView()}

async function deleteReminder(id){if(!confirm('Delete reminder?'))return;await db.from('maintenance_reminders').delete().eq('id',id);toast('Deleted','success');invalidate('vehicles','dashboard');await refreshVehicleView()}

// ─── VEHICLE TAB RENDERERS ────────────────────────────────────────────────────

function renderServiceTab(services, vehicleId){
  var html='<div style="display:flex;justify-content:flex-end;margin-bottom:16px" class="no-print">';
  html+='<button class="btn btn-primary btn-sm" onclick="showServiceModal(_currentVehicleProfile.id)">+ Add Service Record</button></div>';
  if(!services||services.length===0) return html+'<div class="empty-state"><div class="empty-icon">&#x1F4CB;</div><p>No service records yet</p></div>';
  services.forEach(function(s){
    html+='<div class="service-row"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div>';
    html+='<div style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;text-transform:uppercase;color:var(--ku-blue)">'+esc(s.service_type||'Service')+'</div>';
    var meta=[s.performed_date?fmtDate(s.performed_date):null,s.mileage_at_service?s.mileage_at_service.toLocaleString()+' mi':null,s.performed_by?'by '+esc(s.performed_by):null].filter(Boolean).join(' &middot; ');
    if(meta) html+='<div style="font-size:12px;color:var(--text-muted);margin-top:3px">'+meta+'</div>';
    if(s.description) html+='<div style="margin-top:8px;font-size:13px">'+esc(s.description)+'</div>';
    html+='</div><button class="btn btn-ghost btn-sm no-print" onclick="deleteServiceRecord('+JSON.stringify(s.id)+')">&#x1F5D1;&#xFE0F;</button></div></div>';
  });
  return html;
}

function renderPartsTab(installs, vehicleId){
  var active=(installs||[]).filter(function(i){return !i.removed_date;});
  var removed=(installs||[]).filter(function(i){return !!i.removed_date;});
  var html='<div style="display:flex;justify-content:flex-end;margin-bottom:16px" class="no-print">';
  html+='<button class="btn btn-primary btn-sm" onclick="showInstallPartModal(_currentVehicleProfile.id,null,null,null,null)">+ Log Part Installation</button></div>';
  if(active.length===0&&removed.length===0) return html+'<div class="empty-state"><div class="empty-icon">&#x1F529;</div><p>No parts logged yet</p></div>';
  function groupByPart(list){
    var g={};
    list.forEach(function(i){
      var k=i.parts&&i.parts.catalog_part_id?i.parts.catalog_part_id:i.parts?i.parts.name:'unknown';
      if(!g[k]){g[k]={name:i.parts?i.parts.name:'Unknown Part',items:[]};}
      g[k].items.push(i);
    });
    return g;
  }
  function safeId(k){return k.replace(/[^a-z0-9]/gi,'_');}
  if(active.length>0){
    html+='<div style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px">Currently Installed ('+active.length+')</div>';
    Object.entries(groupByPart(active)).forEach(function(e){
      var key=e[0],group=e[1],latest=group.items[group.items.length-1];
      var gid='grp_'+safeId(key);
      html+='<div class="install-row" style="cursor:pointer" onclick="toggleInstallHistory(\''+gid+'\')">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
      html+='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><strong>'+esc(group.name)+'</strong><span class="badge badge-ok">Active</span>';
      if(group.items.length>1) html+='<span style="font-size:11px;color:var(--text-muted)">'+group.items.length+' installs</span>';
      html+='</div><span style="font-size:11px;color:var(--text-muted)">&#x25BC; history</span></div>';
      html+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Last installed: '+(latest.installed_date?fmtDate(latest.installed_date):'-');
      if(latest.installed_mileage) html+=' @ '+latest.installed_mileage.toLocaleString()+' mi';
      if(latest.time_taken) html+=' &middot; Took: '+esc(latest.time_taken);
      html+='</div>';
      html+='<div id="'+gid+'" style="display:none;margin-top:10px">';
      group.items.forEach(function(i){
        html+='<div style="padding:8px 12px;background:var(--bg);border-radius:6px;margin-top:6px;font-size:12px">';
        html+='<div style="font-weight:600">'+fmtDate(i.installed_date)+(i.installed_mileage?' @ '+i.installed_mileage.toLocaleString()+' mi':'')+'</div>';
        if(i.parts) html+='<div style="color:var(--text-muted)">'+esc(i.parts.condition||'-')+'  &middot;  Part #: '+esc(i.parts.part_number||'-')+'</div>';
        if(i.time_taken) html+='<div style="color:var(--text-muted)">Time: '+esc(i.time_taken)+'</div>';
        if(i.notes) html+='<div style="color:var(--text-muted);margin-top:3px">'+esc(i.notes)+'</div>';
        if(!i.removed_date) html+='<div style="margin-top:6px"><button class="btn btn-secondary btn-sm no-print" onclick="showRemovePartModal('+JSON.stringify(i.id)+')">Mark Removed</button></div>';
        html+='</div>';
      });
      html+='</div></div>';
    });
  }
  if(removed.length>0){
    html+='<div style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--text-muted);margin:20px 0 10px">Previously Installed ('+removed.length+')</div>';
    Object.entries(groupByPart(removed)).forEach(function(e){
      var key=e[0],group=e[1];
      var gid='rmv_'+safeId(key);
      html+='<div class="install-row" style="opacity:.6;cursor:pointer" onclick="toggleInstallHistory(\''+gid+'\')">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center">';
      html+='<strong>'+esc(group.name)+'</strong><span style="font-size:11px;color:var(--text-muted)">'+group.items.length+' record'+(group.items.length>1?'s':'')+'  &#x25BC;</span></div>';
      html+='<div id="'+gid+'" style="display:none;margin-top:10px">';
      group.items.forEach(function(i){
        html+='<div style="padding:8px 12px;background:var(--bg);border-radius:6px;margin-top:6px;font-size:12px">';
        html+='<div>Installed: '+fmtDate(i.installed_date)+(i.installed_mileage?' @ '+i.installed_mileage.toLocaleString()+' mi':'')+'</div>';
        html+='<div style="color:var(--danger)">Removed: '+fmtDate(i.removed_date)+(i.removal_reason?' - '+esc(i.removal_reason):'')+'</div>';
        if(i.time_taken) html+='<div style="color:var(--text-muted)">Time: '+esc(i.time_taken)+'</div>';
        html+='</div>';
      });
      html+='</div></div>';
    });
  }
  return html;
}

function toggleInstallHistory(id){
  var el=document.getElementById(id);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

function renderRemindersTab(reminders, vehicle, vehicleId){
  var today=new Date();
  var html='<div style="display:flex;justify-content:flex-end;margin-bottom:16px" class="no-print">';
  html+='<button class="btn btn-primary btn-sm" onclick="showReminderModal(_currentVehicleProfile.id)">+ Add Reminder</button></div>';
  if(!reminders||reminders.length===0) return html+'<div class="empty-state"><div class="empty-icon">&#x23F0;</div><p>No maintenance reminders</p></div>';
  reminders.forEach(function(r){
    var snoozed=r.snoozed_until_date&&new Date(r.snoozed_until_date)>today;
    var overdue=!snoozed&&((r.next_due_date&&new Date(r.next_due_date)<=today)||(r.next_due_mileage&&(vehicle.current_mileage||0)>=r.next_due_mileage));
    var cls=overdue?'overdue':'';var sb='';
    if(snoozed) sb='<span class="badge badge-snoozed">Snoozed</span>';
    else if(overdue) sb='<span class="badge badge-overdue">Overdue</span>';
    else if(r.next_due_date){var d=(new Date(r.next_due_date)-today)/86400000;if(d<=30){cls='due-soon';sb='<span class="badge badge-fair">Due in '+Math.ceil(d)+'d</span>';}}
    html+='<div class="reminder-card '+cls+'">';
    html+='<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div>';
    html+='<div style="font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+esc(r.title)+' '+sb+'</div>';
    if(r.description) html+='<div style="font-size:12px;color:var(--text-muted);margin-top:4px">'+esc(r.description)+'</div>';
    var meta=[r.interval_miles?'Every '+r.interval_miles.toLocaleString()+' mi':null,r.interval_days?'every '+r.interval_days+' days':null,r.next_due_date?'Next: '+fmtDate(r.next_due_date):null,r.next_due_mileage?'Next: '+r.next_due_mileage.toLocaleString()+' mi':null].filter(Boolean).join(' &middot; ');
    if(meta) html+='<div style="font-size:12px;color:var(--text-muted);margin-top:6px">'+meta+'</div>';
    html+='</div>';
    html+='<div class="flex-row no-print" style="flex-wrap:wrap;gap:4px">';
    html+='<button class="btn btn-secondary btn-sm" onclick="showSnoozeModal('+JSON.stringify(r.id)+','+JSON.stringify(r.title)+')">Snooze</button>';
    html+='<button class="btn btn-secondary btn-sm" onclick="markReminderDone('+JSON.stringify(r.id)+',_currentVehicleProfile.id,'+(vehicle.current_mileage||0)+')">Done</button>';
    html+='<button class="btn btn-ghost btn-sm" onclick="deleteReminder('+JSON.stringify(r.id)+')">Del</button>';
    html+='</div></div></div>';
  });
  return html;
}


async function printVehicleProfile(vehicleId){
  const{data:v}=await db.from('vehicles').select('*').eq('id',vehicleId).single();
  const[{data:services},{data:installs}]=await Promise.all([db.from('service_history').select('*').eq('vehicle_id',vehicleId).order('performed_date',{ascending:false}),db.from('part_installations').select('*,parts(name,part_number,condition,source,oem_part_number)').eq('vehicle_id',vehicleId).order('installed_date',{ascending:false})]);
  const active=(installs||[]).filter(i=>!i.removed_date);
  const w=window.open('','_blank');
  w.document.write(`<html><head><title>${v.year} ${v.make} ${v.model} Profile</title><style>body{font-family:Arial,sans-serif;padding:30px;color:#111;font-size:13px}h1{font-size:24px;margin:0 0 4px;color:#0051BA}h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #0051BA;padding-bottom:4px;margin:20px 0 12px;color:#0051BA}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd;padding:5px 8px}td{padding:6px 8px;border-bottom:1px solid #eee;font-size:12px}.sub{color:#E8000D;font-size:13px;margin-bottom:20px;font-weight:600}.footer{margin-top:30px;font-size:11px;color:#999;border-top:1px solid #ddd;padding-top:10px}</style></head><body>
    <h1>🚗 ${v.year} ${v.make} ${v.model}${v.trim?' '+v.trim:''}</h1>
    <div class="sub">${[v.color,v.current_mileage?v.current_mileage.toLocaleString()+' miles':null,v.vin?'VIN: '+v.vin:null].filter(Boolean).join(' · ')}</div>
    ${v.notes?`<div style="margin-bottom:16px;padding:10px;background:#f9f9f9;border-left:3px solid #0051BA;font-size:12px">${v.notes}</div>`:''}
    <h2>Currently Installed Parts (${active.length})</h2>
    ${active.length===0?'<p style="color:#999">None recorded</p>':`<table><thead><tr><th>Part</th><th>Part #</th><th>Condition</th><th>Source</th><th>Installed</th><th>Mileage</th></tr></thead><tbody>${active.map(i=>`<tr><td><strong>${i.parts?i.parts.name:'Unknown'}</strong></td><td>${i.parts?.part_number||' - '}</td><td>${i.parts?.condition||' - '}</td><td>${i.parts?.source||' - '}</td><td>${i.installed_date?new Date(i.installed_date+'T12:00:00').toLocaleDateString():' - '}</td><td>${i.installed_mileage?i.installed_mileage.toLocaleString()+' mi':' - '}</td></tr>`).join('')}</tbody></table>`}
    <h2>Service History (${(services||[]).length} records)</h2>
    ${(!services||services.length===0)?'<p style="color:#999">None recorded</p>':`<table><thead><tr><th>Service</th><th>Date</th><th>Mileage</th><th>By</th><th>Notes</th></tr></thead><tbody>${services.map(s=>`<tr><td><strong>${s.service_type||' - '}</strong>${s.description?`<br><span style="color:#666;font-size:11px">${s.description}</span>`:''}</td><td>${s.performed_date?new Date(s.performed_date+'T12:00:00').toLocaleDateString():' - '}</td><td>${s.mileage_at_service?s.mileage_at_service.toLocaleString()+' mi':' - '}</td><td>${s.performed_by||' - '}</td><td style="color:#666;font-size:11px">${s.notes||''}</td></tr>`).join('')}</tbody></table>`}
    <div class="footer">🐔 Chicken Zone Inventory Manager · ${new Date().toLocaleDateString()}</div>
  </body></html>`);
  setTimeout(()=>w.print(),400);
}

// ─── WISHLIST ─────────────────────────────────────────────────────────────────
// ─── WISHLIST PAGE ───────────────────────────────────────────────────────────
async function renderWishlist(){
  const el=document.getElementById('view-wishlist');
  el.innerHTML=viewLoading();

  let items=[];
  try{
    if(!_cache.wishlist) el.innerHTML=viewLoading('Loading wishlist...');
    items=await fetchWishlist();
  }catch(err){
    el.innerHTML=errBox(err.message);
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

  let html='<div class="page-header"><div style="text-align:center;flex:1"><div class="page-title" style="font-size:42px;text-align:center">Wishlist</div><div class="page-subtitle" style="font-size:12px;text-align:center">Find, Buy, Succeed!</div></div><button class="btn btn-primary" onclick="showWishlistModal()">+ Add Item</button></div>';

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
async function showWishlistModal(id){
  let item=null;
  if(id){
    const{data}=await db.from('wishlist').select('*').eq('id',id).single();
    item=data;
  }

  // Build suggestions from GMT800 catalog + custom parts in dbInventory
  const catalogNames = _catalog.map(function(p){return p.name;});
  const customNames = (dbInventory||[]).map(function(p){return p.name;}).filter(function(n){return n && !catalogNames.includes(n);});
  const allNames = catalogNames.concat(customNames);

  let html='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:500px">';
  html+='<div class="modal-header"><div class="modal-title">'+(item?'Edit Wishlist Item':'Add to Wishlist')+'</div><button class="close-btn" onclick="closeModal()">×</button></div>';
  html+='<div class="modal-body">';

  // Part name with autocomplete
  html+='<div class="form-group"><label>Part Name *</label>';
  html+='<input type="text" class="form-control" id="w-name" value="'+esc(item?.name||'')+'" list="w-name-list" oninput="onWishlistNameInput(this.value)" autocomplete="off">';
  html+='<datalist id="w-name-list">';
  allNames.forEach(function(n){ html+='<option value="'+esc(n)+'">'; });
  html+='</datalist></div>';

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
  const name = val('w-name');
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
  invalidate('wishlist');
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
  invalidate('wishlist');
  await renderWishlist();
}