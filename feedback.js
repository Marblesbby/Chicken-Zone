// ─── CHICKEN ZONE — feedback.js — User Profile, Users Panel, Comments, Announcements, Feedback ───
// Depends on: app.js (globals, helpers, db)




// ─── USER PROFILE ────────────────────────────────────────────────────────────

async function renderUserProfile(){
  var el = document.getElementById('view-profile');
  if(!el || el.style.display === 'none') el = document.getElementById('view-users');
  if(!el) return;
  el.innerHTML = viewLoading('Loading profile...');
  try{
    var profRes = await withTimeout(db.from('profiles').select('*').eq('id', currentUser.id).single(), 6000);
    if(profRes.data){
      _currentUserProfile = profRes.data;
      _isAdmin = _currentUserProfile.role === 'admin';
      // Sync sidebar admin nav with fresh role
      var an = document.getElementById('admin-nav');
      if(an) an.style.display = _isAdmin ? 'block' : 'none';
    }
  }catch(e){ console.warn('Profile re-fetch failed:', e); }
  var p = _currentUserProfile || {};
  var uname = p.username || (currentUser.user_metadata && currentUser.user_metadata.username) || '';
  var ucolor = p.user_color || '#FFD700';
  var dname = p.display_name || uname;
  // Use effective role for display (respects View-As mode)
  var role = (_viewAsRole && _isAdmin) ? _viewAsRole : (p.role || 'owner');
  var resetReq = p.reset_requested;

  var html = '<div class="page-header"><div style="text-align:center;flex:1">';
  html += '<div class="page-title" style="font-size:42px">My Profile</div>';
  html += '<div class="page-subtitle" style="font-size:12px">'+esc(uname)+'</div></div></div>';

  html += '<div style="max-width:500px;margin:0 auto">';

  // Profile card
  html += '<div class="card" style="margin-bottom:20px">';
  html += '<div style="text-align:center;margin-bottom:20px">';
  var currentEmoji = p.avatar_emoji || '🐇';
  html += '<div style="width:80px;height:80px;border-radius:50%;background:#fff;border:3px solid '+ucolor+';margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:42px">'+currentEmoji+'</div>';
  html += '<div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
  html += AVATAR_EMOJIS.map(function(e){
    var sel = e===currentEmoji;
    return '<button onclick="selectAvatar(\''+e+'\')" style="background:#fff;border:'+(sel?'3px solid '+ucolor:'2px solid var(--border)')+';border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;padding:0">'+e+'</button>';
  }).join('');
  html += '</div>';
  html += '<input type="hidden" id="up-avatar" value="'+currentEmoji+'">';
  html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:700;color:'+ucolor+'">'+esc(dname)+'</div>';
  html += '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px">';
  html += '<div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">'+esc(role)+'</div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="form-group"><label>Display Name</label>';
  html += '<input type="text" class="form-control" id="up-dname" value="'+esc(dname)+'" placeholder="How your name appears on comments"></div>';

  html += '<div class="form-group"><label>Username Color</label>';
  html += '<div style="display:flex;align-items:center;gap:12px">';
  html += '<input type="color" id="up-color" value="'+ucolor+'" style="width:50px;height:36px;border:none;background:none;cursor:pointer;border-radius:6px">';
  html += '<div id="up-color-preview" style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:'+ucolor+'">'+esc(dname)+' (preview)</div>';
  html += '</div></div>';

  html += '<script>document.getElementById("up-color").addEventListener("input",function(){var c=this.value;document.getElementById("up-color-preview").style.color=c;});<\/script>';

  html += '<div style="display:flex;gap:8px;margin-top:16px">';
  html += '<button class="btn btn-primary" onclick="saveUserProfile()">Save Changes</button>';
  if(role==='tester' && !resetReq){
    html += '<button class="btn btn-secondary" onclick="requestReTest()" style="margin-left:auto">Request Re-Test</button>';
  }
  if(role==='tester' && resetReq){
    html += '<div style="margin-left:auto;font-size:12px;color:var(--warning);align-self:center">⏳ Reset requested — waiting for admin</div>';
  }
  html += '</div>';

  // Role update via invite code
  html += '<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">';
  html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Update Role with Invite Code</div>';
  html += '<div style="display:flex;gap:8px">';
  html += '<input type="text" class="form-control" id="profile-invite-code" placeholder="Enter invite code" style="text-transform:uppercase;flex:1">';
  html += '<button class="btn btn-secondary" onclick="applyInviteCodeFromProfile()">Apply</button>';
  html += '</div>';
  html += '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
  html += '<span>Current role: <strong style="color:var(--accent)">'+esc(role)+'</strong></span>';
  if(p.requested_role){
    html += '<span style="color:var(--warning);font-size:11px">⏳ Pending: '+esc(p.requested_role)+'</span>';
  } else if(role !== 'admin'){
    html += '<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 10px" onclick="showRequestRoleModal()">Request Role</button>';
  }
  html += '</div>';
  html += '</div></div>';

  html += '</div>';
  el.innerHTML = html;
}


async function applyInviteCodeFromProfile(){
  var codeInput = (val('profile-invite-code')||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!codeInput) return toast('Enter an invite code','error');
  var existsRes = await db.from('invite_codes').select('*').eq('code', codeInput);
  if(existsRes.error){ toast('Could not check invite code. Try again.','error'); return; }
  if(!existsRes.data || existsRes.data.length === 0){
    toast('Invite code not found. Check spelling and try again.','error'); return;
  }
  var ic = existsRes.data[0];
  if(!ic.is_active){
    toast('This invite code has been deactivated. Ask an admin for a new code.','error'); return;
  }
  var newRole = ic.role;
  var{error} = await db.from('profiles').update({role:newRole}).eq('id',currentUser.id);
  if(error){ toast(error.message,'error'); return; }
  await db.from('invite_codes').update({uses:(ic.uses||0)+1}).eq('id',ic.id);
  _currentUserProfile = Object.assign({},_currentUserProfile,{role:newRole});
  _isAdmin = newRole === 'admin';
  var adminNav = document.getElementById('admin-nav');
  if(adminNav) adminNav.style.display = _isAdmin ? 'block' : 'none';
  toast('Role updated to '+newRole+'!','success');
  await renderUserProfile();
}


function selectAvatar(emoji){
  document.getElementById('up-avatar').value = emoji;
  var color = document.getElementById('up-color').value || '#FFD700';
  // Update tiny emoji buttons - all white background, ring on selected
  var buttons = document.querySelectorAll('[onclick^="selectAvatar"]');
  buttons.forEach(function(btn){
    var isSelected = btn.textContent === emoji;
    btn.style.background = '#fff';
    btn.style.border = isSelected ? '3px solid '+color : '2px solid var(--border)';
  });
  // Update large preview circle - white bg, color ring
  var circles = document.querySelectorAll('[style*="border-radius:50%"][style*="width:80px"]');
  circles.forEach(function(c){
    if(c.style.fontSize==='42px' || c.style.fontSize==='40px'){
      c.textContent = emoji;
      c.style.background = '#fff';
      c.style.border = '3px solid '+color;
    }
  });
}

async function saveUserProfile(){
  var dname = val('up-dname');
  var color = document.getElementById('up-color') ? document.getElementById('up-color').value : '#FFD700';
  var avatar = val('up-avatar') || '🐇';
  if(!dname) return toast('Display name cannot be empty','error');
  var{error} = await db.from('profiles').update({display_name:dname, user_color:color, avatar_emoji:avatar}).eq('id', currentUser.id);
  if(error){ toast(error.message,'error'); return; }
  _currentUserProfile = Object.assign({}, _currentUserProfile, {display_name:dname, user_color:color});
  // Update sidebar display
  var display = document.getElementById('user-email-display');
  if(display) display.innerHTML = '<span style="color:'+color+';font-weight:600">'+esc(_currentUserProfile.username||dname)+'</span>';
  toast('Profile saved!','success');
  await renderUserProfile();
}

async function requestReTest(){
  if(!confirm('This will ask the admin to reset your test data. Continue?')) return;
  await db.from('profiles').update({reset_requested:true}).eq('id', currentUser.id);
  toast('Reset requested! Admin will clear your test data soon.','success');
  await renderUserProfile();
}

// ─── ADMIN: USERS PANEL ──────────────────────────────────────────────────────

async function renderUsersPanel(){
  var el = document.getElementById('view-users');
  if(!el) return;
  if(!_isAdmin){ el.innerHTML = errBox('Access denied'); return; }
  el.innerHTML = viewLoading('Loading users...');
  try{
    var usersRes = await db.from('profiles').select('*').order('created_at');
    var users = usersRes.data || [];
    var vehicles = _session.vehicles || await getVehicles();

    // Pre-fetch tester activity counts (parts + vehicles they created)
    var testerIds = users.filter(function(u){ return u.role === 'tester'; }).map(function(u){ return u.id; });
    var testerCounts = {};
    if(testerIds.length > 0){
      try{
        var tpRes = await db.from('parts').select('created_by').in('created_by', testerIds).eq('is_historical', false);
        var tvRes = await db.from('vehicles').select('created_by').in('created_by', testerIds);
        testerIds.forEach(function(tid){
          var pc = (tpRes.data||[]).filter(function(p){ return p.created_by === tid; }).length;
          var vc = (tvRes.data||[]).filter(function(v){ return v.created_by === tid; }).length;
          testerCounts[tid] = pc + vc;
        });
      }catch(e){}
    }

    var html = '<div class="page-header"><div style="text-align:center;flex:1">';
    html += '<div class="page-title" style="font-size:42px">Users</div>';
    html += '<div class="page-subtitle" style="font-size:12px">Manage access and roles</div></div></div>';

    var unknownCount = 0;
    users.forEach(function(u){
      var ucolor = u.user_color || '#FFD700';
      var isMe = u.id === currentUser.id;
      html += '<div class="card" style="margin-bottom:12px">';
      html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">';
      html += '<div style="width:40px;height:40px;border-radius:50%;background:'+ucolor+';display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">'+(u.avatar_emoji||'🐇')+'</div>';
      html += '<div style="flex:1">';
      html += '<div style="font-weight:600;color:'+ucolor+'">'+(function(){ if(!u.display_name && !u.username){ unknownCount++; return 'Unknown '+unknownCount; } return esc(u.display_name||u.username||'Unknown'); })()+(isMe?' <span style="font-size:11px;color:var(--text-muted)">(you)</span>':'')+'</div>';
      html += '<div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px">'+esc(u.role||'owner')+'</div>';
      // Tester stats — days since last reset + item count, both in red
      if(u.role === 'tester'){
        var resetDate = new Date(u.last_reset_at || u.created_at);
        var daysSince = Math.floor((new Date() - resetDate) / 86400000);
        var itemCount = testerCounts[u.id] || 0;
        html += '<div style="font-size:11px;margin-top:3px;display:flex;gap:10px">';
        html += '<span style="color:var(--danger);font-weight:600">&#x1F551; ' + daysSince + ' day' + (daysSince !== 1 ? 's' : '') + ' since reset</span>';
        html += '<span style="color:var(--danger);font-weight:600">&#x1F4E6; ' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ' recorded</span>';
        html += '</div>';
      }
      if(u.reset_requested) html += '<div style="font-size:11px;color:var(--warning);margin-top:2px">⚠️ Reset requested</div>';
      if(u.requested_role) html += '<div style="font-size:11px;color:var(--warning);margin-top:2px;cursor:help" title="Reason: '+esc(u.request_reason||'No reason given')+'">🚩 Requesting: '+esc(u.requested_role)+'</div>';
      html += '</div>';
      if(!isMe){
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap" onclick="event.stopPropagation()">';
        // Role selector
        html += '<button class="btn btn-ghost btn-sm" onclick="setAdminNickname(\''+u.id+'\')">&#x270F;&#xFE0F; Nickname</button>';
        if(u.requested_role){
          html += '<button class="btn btn-primary btn-sm" onclick="approveRoleRequest(\''+u.id+'\',\''+u.requested_role+'\')">✅ Approve '+u.requested_role+'</button>';
          html += '<button class="btn btn-ghost btn-sm" onclick="denyRoleRequest(\''+u.id+'\')">Deny</button>';
        }
        html += '<select class="form-control" style="width:auto;font-size:12px" onchange="setUserRole(\''+u.id+'\',this.value)">';
        ['admin','owner','guest','tester'].forEach(function(r){
          html += '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>';
        });
        html += '</select>';
        // Vehicle assignment (for owner)
        if(u.role==='owner'){
          html += '<select class="form-control" style="width:auto;font-size:12px" onchange="setUserVehicle(\''+u.id+'\',this.value)">';
          html += '<option value="">No vehicle assigned</option>';
          vehicles.forEach(function(v){
            html += '<option value="'+v.id+'"'+(u.assigned_vehicle_id===v.id?' selected':'')+'>'+esc(getVehicleDisplayName(v))+'</option>';
          });
          html += '</select>';
        }
        // Reset button (for tester)
        if(u.role==='tester'){
          html += '<button class="btn btn-danger btn-sm" title="Delete permanently (cannot be undone)" onclick="adminResetTester(\''+u.id+'\',\''+esc(u.username||'this user')+'\')">🗑️ Reset Data</button>';
        }
        html += '</div>';
      }
      html += '</div>';
      
      html += '</div>';
    });

    // Invite codes section
    html += '<div class="card" style="margin-top:24px">';
    html += '<div class="stat-label" style="margin-bottom:14px">🔑 Invite Codes</div>';
    try{
      var codesRes = await db.from('invite_codes').select('*').order('created_at');
      var codes = codesRes.data || [];
      if(codes.length === 0){
        html += '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">No invite codes yet.</div>';
      }
      codes.forEach(function(c){
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">';
        html += '<code style="font-size:14px;color:var(--accent);flex:1">'+esc(c.code)+'</code>';
        html += '<button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(\''+c.code+'\').then(function(){toast(\'Copied!\',\'success\')})" title="Copy code">&#x1F4CB;</button>';
        html += '<span style="font-size:12px;color:var(--text-muted);text-transform:uppercase">'+esc(c.role)+'</span>';
        html += '<span style="font-size:12px;color:var(--text-muted)">Used: '+( c.uses||0)+'x</span>';
        html += '<span style="font-size:12px;color:'+(c.is_active?'var(--success)':'var(--danger)')+'">'+( c.is_active?'Active':'Inactive')+'</span>';
        html += '<button class="btn btn-ghost btn-sm" onclick="toggleInviteCode(\''+c.id+'\','+(c.is_active?'true':'false')+')">'+( c.is_active?'Deactivate':'Activate')+'</button>';
        html += '<button class="btn btn-danger btn-sm" title="Delete permanently (cannot be undone)" onclick="deleteInviteCode(\''+c.id+'\')">Del</button>';
        html += '</div>';
      });
    }catch(e){}
    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">';
    html += '<div class="form-group" style="margin:0;flex:1"><label>New Code</label><input type="text" class="form-control" id="new-code-input" placeholder="e.g. CZOWNER2024" style="text-transform:uppercase"></div>';
    html += '<div class="form-group" style="margin:0"><label>Role</label><select class="form-control" id="new-code-role"><option value="owner">Owner</option><option value="guest">Guest</option><option value="tester">Tester</option></select></div>';
    html += '<button class="btn btn-primary" onclick="createInviteCode()" style="margin-bottom:0">+ Add Code</button>';
    html += '</div></div>';

    el.innerHTML = html;
  }catch(err){
    el.innerHTML = errBox(err.message);
  }
}

async function createInviteCode(){
  var code = (document.getElementById('new-code-input').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  var role = document.getElementById('new-code-role').value;
  if(!code) return toast('Enter a code','error');
  var{error} = await db.from('invite_codes').insert({code:code, role:role, is_active:true, uses:0});
  if(error){ toast(error.message,'error'); return; }
  toast('Code created!','success');
  await renderUsersPanel();
}

async function toggleInviteCode(id, currentlyActive){
  await db.from('invite_codes').update({is_active:!currentlyActive}).eq('id',id);
  await renderUsersPanel();
}

async function deleteInviteCode(id){
  if(!confirm('Delete this invite code?')) return;
  await db.from('invite_codes').delete().eq('id',id);
  toast('Deleted','success');
  await renderUsersPanel();
}


async function setAdminNickname(userId){
  var nick = prompt('Set a nickname for this user (leave blank to clear):');
  if(nick === null) return;
  var{error} = await db.from('profiles').update({display_name: nick.trim() || null}).eq('id', userId);
  if(error){ toast(error.message,'error'); return; }
  toast(nick.trim() ? 'Nickname set!' : 'Nickname cleared', 'success');
  await renderUsersPanel();
}


// ─── ROLE REQUEST ─────────────────────────────────────────────────────────────────────────────
function showRequestRoleModal(){
  showModal('<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:400px"><div class="modal-header"><div class="modal-title">Request a Role</div><button class="close-btn" onclick="closeModal()">&times;</button></div><div class="modal-body"><div class="form-group"><label>Requested Role</label><select class="form-control" id="rr-role"><option value="owner">Owner</option><option value="guest">Guest</option><option value="tester">Tester</option></select></div><div class="form-group"><label>Reason</label><textarea class="form-control" id="rr-reason" rows="3" placeholder="Why are you requesting this role?"></textarea></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitRoleRequest()">Submit Request</button></div></div></div>');
}

async function submitRoleRequest(){
  var role = val('rr-role');
  var reason = val('rr-reason');
  if(!reason) return toast('Please provide a reason','error');
  var{error} = await db.from('profiles').update({
    requested_role: role,
    request_reason: reason,
    request_at: new Date().toISOString()
  }).eq('id', currentUser.id);
  if(error){ toast(error.message,'error'); return; }
  if(_currentUserProfile){
    _currentUserProfile.requested_role = role;
    _currentUserProfile.request_reason = reason;
  }
  toast('Request submitted! Admin will review it soon.','success');
  closeModal();
  await renderUserProfile();
}

async function approveRoleRequest(userId, role){
  if(!confirm('Approve role change to '+role+'?')) return;
  await db.from('profiles').update({
    role: role,
    requested_role: null,
    request_reason: null
  }).eq('id', userId);
  toast('Role approved','success');
  await renderUsersPanel();
}

async function denyRoleRequest(userId){
  if(!confirm('Deny this role request?')) return;
  await db.from('profiles').update({
    requested_role: null,
    request_reason: null
  }).eq('id', userId);
  toast('Request denied','info');
  await renderUsersPanel();
}


async function setUserRole(userId, role){
  var{error} = await db.from('profiles').update({role:role}).eq('id', userId);
  if(error){ toast(error.message,'error'); return; }
  toast('Role updated','success');
  await renderUsersPanel();
}

async function setUserVehicle(userId, vehicleId){
  var{error} = await db.from('profiles').update({assigned_vehicle_id:vehicleId||null}).eq('id', userId);
  if(error){ toast(error.message,'error'); return; }
  toast('Vehicle assigned','success');
}

async function adminResetTester(userId, username){
  if(!confirm('PERMANENT: Delete all data created by '+username+'? This cannot be undone.')) return;
  try{
    var{error} = await db.rpc('reset_tester_data', {tester_id: userId});
    if(error) throw new Error(error.message);
    // Stamp the reset time so days-since-reset counter resets
    await db.from('profiles').update({ last_reset_at: new Date().toISOString() }).eq('id', userId);
    toast('Tester data reset!','success');
    invalidate();
    await renderUsersPanel();
  }catch(e){ toast('Reset failed: '+e.message,'error'); }
}

async function adminDeleteInstalls(userId, username){
  if(!confirm('PERMANENT: Delete ALL installation history for '+username+'? This cannot be undone.')) return;
  try{
    // Delete part_installations for parts created by or attributed to this user
    // Since we don't have user_id on part_installations, delete by vehicle ownership
    var vRes = await db.from('vehicles').select('id').eq('created_by', userId);
    if(vRes.data && vRes.data.length){
      var vIds = vRes.data.map(function(v){return v.id;});
      await db.from('part_installations').delete().in('vehicle_id', vIds);
    }
    // Also delete any parts they created that have installations
    var pRes = await db.from('parts').select('id').eq('created_by', userId);
    if(pRes.data && pRes.data.length){
      var pIds = pRes.data.map(function(p){return p.id;});
      await db.from('part_installations').delete().in('part_id', pIds);
    }
    toast('Install history deleted','success');
    invalidate();
    await renderUsersPanel();
  }catch(e){ toast('Delete failed: '+e.message,'error'); }
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ─── FEEDBACK PAGE ──────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════

var FEEDBACK_LOCATIONS = [
  'Dashboard','Auto Parts','Part Profile','Vehicles','Vehicle Profile',
  'Wishlist','Feedback','My Profile','New Page','General / Other'
];

async function renderFeedbackPage(){
  var el = document.getElementById('view-feedback');
  if(!el) return;
  el.innerHTML = viewLoading('Loading feedback...');
  try{
    var res = await withTimeout(db.from('feedback').select('*').order('created_at',{ascending:false}), 10000);
    if(res.error) throw new Error(res.error.message);
    var allFeedback = res.data || [];
    var myFeedback  = allFeedback.filter(function(f){ return f.user_id === currentUser.id; });

    // Known bugs = published, not yet resolved
    var knownBugs = allFeedback.filter(function(f){
      return f.is_published && !f.is_resolved && f.type === 'Bug Report';
    });
    // Squashed bugs = published AND resolved
    var squashedBugs = allFeedback.filter(function(f){
      return f.is_published && f.is_resolved && f.type === 'Bug Report';
    });

    var html = '<div class="page-header"><div>';
    html += '<div class="page-title">Feedback</div>';
    html += '<div class="page-subtitle">Bug Reports & Feature Suggestions</div>';
    html += '</div></div>';

    // ── KNOWN BUGS SECTION (always visible) ────────────────────────────
    html += '<div class="card" style="margin-bottom:16px;border-left:3px solid var(--warning)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
    html += '<div class="stat-label" style="color:var(--warning)">&#x1F41B; Known Bugs'+(knownBugs.length>0?' ('+knownBugs.length+')':'')+'</div>';
    if(_isAdmin){
      html += '<button class="btn btn-secondary btn-sm" onclick="addKnownBugManually()">+ Add Known Bug</button>';
    }
    html += '</div>';
    if(knownBugs.length > 0){
      knownBugs.forEach(function(b){
        html += renderKnownBug(b, false);
      });
    } else {
      html += '<div style="font-size:13px;color:var(--text-muted);font-style:italic">No known bugs at this time. \u{1F389}</div>';
    }
    html += '</div>';

    // ── SQUASHED BUGS SECTION (collapsible) ────────────────────────────
    if(squashedBugs.length > 0){
      html += '<div class="card" style="margin-bottom:16px;border-left:3px solid var(--success)">';
      html += '<div class="stat-label" style="margin-bottom:12px;color:var(--success);cursor:pointer" onclick="document.getElementById(\'squashed-list\').style.display=document.getElementById(\'squashed-list\').style.display===\'none\'?\'block\':\'none\'">&#x2705; Squashed Bugs ('+squashedBugs.length+') &#x25BC;</div>';
      html += '<div id="squashed-list" style="display:none">';
      squashedBugs.forEach(function(b){
        html += renderKnownBug(b, true);
      });
      html += '</div></div>';
    }

    // ── SUBMIT FORM ───────────────────────────────────────────────────
    html += '<div class="card" style="margin-bottom:24px">';
    html += '<div class="stat-label" style="margin-bottom:14px">Submit Feedback</div>';
    html += '<div class="form-group"><label>Type</label>';
    html += '<select class="form-control" id="fb-type" onchange="updateFeedbackForm()">';
    html += '<option value="">Select type...</option>';
    ['Bug Report','New Feature','Improvement','UI / Visual','Performance'].forEach(function(t){
      html += '<option value="'+t+'">'+t+'</option>';
    });
    html += '</select></div>';
    html += '<div class="form-group"><label>Location (which page?)</label>';
    html += '<select class="form-control" id="fb-location">';
    html += '<option value="">Select page...</option>';
    FEEDBACK_LOCATIONS.forEach(function(l){ html += '<option value="'+l+'">'+l+'</option>'; });
    html += '</select></div>';
    html += '<div id="fb-dynamic-fields"></div>';
    html += '<button class="btn btn-primary" onclick="submitFeedback()" style="margin-top:8px">Submit</button>';
    html += '</div>';

    // ── MY SUBMISSIONS / ALL SUBMISSIONS (admin only) ────────────────
    var displayList = _isAdmin ? allFeedback : myFeedback;
    if(displayList.length > 0){
      if(_isAdmin){
        // Group by type with collapsible headers
        var types = ['Bug Report','New Feature','Improvement','UI / Visual','Performance'];
        types.forEach(function(t){
          var group = displayList.filter(function(f){ return f.type === t; });
          if(group.length === 0) return;
          var typeIcon = t==='Bug Report'?'&#x1F41B;':t==='New Feature'?'&#x1F4A1;':t==='Improvement'?'&#x1F527;':t==='UI / Visual'?'&#x1F3A8;':'&#x26A1;';
          var sectionId = 'fb-section-'+t.replace(/[^a-z]/gi,'');
          html += '<div style="margin-bottom:20px">';
          html += '<div class="stat-label" style="margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:8px" onclick="toggleSection(\''+sectionId+'\')">'+typeIcon+' '+esc(t)+' ('+group.length+') <span style="font-size:12px">&#x25BC;</span></div>';
          html += '<div id="'+sectionId+'">';
          group.forEach(function(f){ html += renderFeedbackEntry(f); });
          html += '</div></div>';
        });
        // Uncategorized
        var other = displayList.filter(function(f){ return !types.includes(f.type); });
        if(other.length > 0){
          html += '<div class="stat-label" style="margin-bottom:10px">Other ('+other.length+')</div>';
          other.forEach(function(f){ html += renderFeedbackEntry(f); });
        }
      } else {
        html += '<div class="stat-label" style="margin-bottom:14px">My Submissions</div>';
        displayList.forEach(function(f){ html += renderFeedbackEntry(f); });
      }
    } else {
      html += '<div class="empty-state"><div class="empty-icon">&#x1F4AC;</div><p>No feedback submitted yet</p></div>';
    }

    el.innerHTML = html;
  }catch(err){
    el.innerHTML = errBox('Could not load feedback. ' + err.message);
  }
}

// ─── KNOWN BUG DISPLAY ────────────────────────────────────────────────────────────────────────
function renderKnownBug(b, isSquashed){
  var html = '<div style="padding:8px 0;border-bottom:1px solid var(--border)">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">';
  html += '<div style="flex:1;min-width:200px">';
  html += '<div style="font-weight:600;font-size:14px">'+esc(b.title || 'Bug')+'</div>';
  if(b.location) html += '<div style="font-size:11px;color:var(--text-muted)">Location: '+esc(b.location)+'</div>';
  if(b.extra_fields){
    try{
      var ex = JSON.parse(b.extra_fields);
      if(ex.Severity) html += '<div style="font-size:11px;color:var(--text-muted)">Severity: '+esc(ex.Severity)+'</div>';
    }catch(e){}
  }
  if(b.description) html += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">'+esc(b.description)+'</div>';
  if(isSquashed && b.resolution_message){
    html += '<div style="font-size:12px;color:var(--success);margin-top:6px;padding:6px;background:rgba(34,197,94,.1);border-radius:4px">&#x2705; '+esc(b.resolution_message)+'</div>';
  }
  html += '</div>';
  if(_isAdmin){
    html += '<div style="display:flex;flex-direction:column;gap:4px">';
    html += '<button class="btn btn-ghost btn-sm" onclick="editKnownBug(\''+b.id+'\')">&#x270F;&#xFE0F; Edit</button>';
    if(!isSquashed){
      html += '<button class="btn btn-secondary btn-sm" onclick="resolveKnownBug(\''+b.id+'\')">&#x2705; Mark Resolved</button>';
    }
    html += '<button class="btn btn-ghost btn-sm" onclick="unpublishKnownBug(\''+b.id+'\')">Unpublish</button>';
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}


// ─── ADMIN FEEDBACK UPDATE MODAL ────────────────────────────────────────────────────────────
function showFeedbackUpdateModal(id){
  var f = null;
  // Find in current DOM data — fetch fresh
  db.from('feedback').select('*').eq('id',id).single().then(function(res){
    f = res.data;
    if(!f){ toast('Could not load submission','error'); return; }
    var statusOpts = ['new','in_progress','done','wont_fix'].map(function(s){
      return '<option value="'+s+'"'+(f.status===s?' selected':'')+'>'+s.replace(/_/g,' ')+'</option>';
    }).join('');
    showModal(
      '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
      '<div class="modal" style="max-width:480px">' +
      '<div class="modal-header"><div class="modal-title">Update Submission</div>' +
      '<button class="close-btn" onclick="closeModal()">&times;</button></div>' +
      '<div class="modal-body">' +
      '<div style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Editing admin fields only — user input is preserved as submitted.</div>' +
      '<div class="form-group"><label>Bug Title (public-facing)</label>' +
      '<input type="text" class="form-control" id="fu-title" value="'+esc(f.title||f.type||'')+'"></div>' +
      '<div class="form-group"><label>Status</label>' +
      '<select class="form-control" id="fu-status">'+statusOpts+'</select></div>' +
      '<div class="form-group"><label>Admin Note (visible to submitter)</label>' +
      '<textarea class="form-control" id="fu-note" rows="3">'+esc(f.admin_note||'')+'</textarea></div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveFeedbackUpdate(\''+id+'\')">Save Update</button>' +
      '</div></div></div>'
    );
  });
}

async function saveFeedbackUpdate(id){
  var title = val('fu-title');
  var status = val('fu-status');
  var note = val('fu-note');
  var updates = {updated_at: new Date().toISOString()};
  if(title) updates.title = title;
  if(status) updates.status = status;
  updates.admin_note = note || null;
  var{error} = await db.from('feedback').update(updates).eq('id',id);
  if(error){ toast(error.message,'error'); return; }
  toast('Updated','success');
  closeModal();
  await renderFeedbackPage();
}


function renderFeedbackEntry(f){
  var statusColor = {new:'var(--accent)',in_progress:'var(--info)',done:'var(--success)',wont_fix:'var(--danger)'}[f.status]||'var(--text-muted)';
  var statusLabel = {new:'New',in_progress:'In Progress',done:'Done',wont_fix:"Won't Fix"}[f.status]||f.status||'New';
  var typeIcon = f.type==='Bug Report'?'&#x1F41B;':f.type==='New Feature'?'&#x1F4A1;':f.type==='Improvement'?'&#x1F527;':f.type==='UI / Visual'?'&#x1F3A8;':'&#x26A1;';

  // Calculate days since submitted
  var daysSince = '';
  if(f.created_at){
    var diff = Math.floor((Date.now() - new Date(f.created_at)) / 86400000);
    daysSince = diff === 0 ? 'Today' : diff === 1 ? '1 day ago' : diff + ' days ago';
  }

  var html = '<div class="card" style="margin-bottom:10px">';
  // Header row: type + title + status badge
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
  html += '<div style="flex:1">';
  html += '<div style="font-weight:700;font-size:14px">'+typeIcon+' '+esc(f.title||f.type||'Feedback');
  if(f.location) html += ' <span style="font-size:11px;font-weight:400;color:var(--text-muted)">— '+esc(f.location)+'</span>';
  html += '</div>';
  // Submitter + date info
  html += '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">';
  if(_isAdmin && f.username) html += '<span style="color:'+(f.user_color||'#FFD700')+';font-weight:600">'+esc(f.username)+'</span> · ';
  html += fmtDate(f.created_at)+' · '+daysSince;
  html += '</div>';
  html += '</div>';
  html += '<span style="font-size:11px;color:'+statusColor+';font-weight:700;text-transform:uppercase;letter-spacing:1px;white-space:nowrap">'+statusLabel+'</span>';
  html += '</div>';

  // User-submitted details
  if(f.description) html += '<div style="font-size:13px;color:var(--text);margin-bottom:6px">'+esc(f.description)+'</div>';
  if(f.extra_fields){
    try{
      var ex = JSON.parse(f.extra_fields);
      var exHtml = Object.keys(ex).filter(function(k){return ex[k];}).map(function(k){
        return '<span style="font-size:11px;color:var(--text-muted)"><strong>'+esc(k)+':</strong> '+esc(ex[k])+'</span>';
      }).join(' &nbsp;·&nbsp; ');
      if(exHtml) html += '<div style="margin-bottom:6px">'+exHtml+'</div>';
    }catch(e){}
  }

  // Admin note
  if(f.admin_note) html += '<div style="font-size:12px;color:var(--accent);margin-top:6px;padding:6px 10px;background:rgba(255,215,0,.08);border-radius:6px;border-left:3px solid var(--accent)"><strong>Admin:</strong> '+esc(f.admin_note)+'</div>';
  if(f.is_published) html += '<div style="font-size:11px;color:var(--warning);margin-top:4px">&#x1F4E2; Published as known bug</div>';

  // Admin action bar
  if(_isAdmin){
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">';
    html += '<button class="btn btn-secondary btn-sm" onclick="showFeedbackUpdateModal(\''+f.id+'\')">&#x270F;&#xFE0F; Update</button>';
    if(f.type==='Bug Report' && !f.is_published){
      html += '<button class="btn btn-ghost btn-sm" onclick="publishKnownBug(\''+f.id+'\')">&#x1F4E2; Publish Bug</button>';
    }
    html += '<button class="btn btn-danger btn-sm" title="Delete permanently (cannot be undone)" onclick="deleteFeedback(\''+f.id+'\')">Del</button>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}


async function setFeedbackStatus(id, status){
  await db.from('feedback').update({status:status, updated_at:new Date().toISOString()}).eq('id',id);
  await renderFeedbackPage();
}
async function addAdminNote(id){
  var note = prompt('Add a note for the user:');
  if(note === null) return;
  await db.from('feedback').update({admin_note:note, updated_at:new Date().toISOString()}).eq('id',id);
  toast('Note added','success');
  await renderFeedbackPage();
}
async function deleteFeedback(id){
  if(!confirm('Delete this feedback entry?')) return;
  await db.from('feedback').delete().eq('id',id);
  toast('Deleted','success');
  await renderFeedbackPage();
}



// ─── COMMENTS SYSTEM ─────────────────────────────────────────────────────────

async function renderComments(recordType, recordId, containerId){
  var container = document.getElementById(containerId);
  if(!container) return;
  container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Loading comments...</div>';
  try{
    var res = await db.from('comments').select('*').eq('record_type',recordType).eq('record_id',String(recordId)).order('created_at',{ascending:true});
    var comments = res.data || [];
    var ucolor = (_currentUserProfile && _currentUserProfile.user_color) || '#FFD700';
    var uname = (_currentUserProfile && _currentUserProfile.username) || 'Me';
    var html = '';
    if(comments.length === 0){
      html += '<div style="font-size:12px;color:var(--text-dim);padding:8px 0">No comments yet</div>';
    }
    comments.forEach(function(c){
      var isMe = c.user_id === currentUser.id;
      var ccolor = c.user_color || '#FFD700';
      html += '<div id="comment-'+c.id+'" style="padding:8px 0;border-bottom:1px solid var(--border)">';
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
      html += '<span style="font-weight:600;font-size:12px;color:'+ccolor+'">'+esc(c.username||'Unknown')+'</span>';
      html += '<span style="font-size:11px;color:var(--text-dim)">'+fmtDate(c.created_at)+'</span>';
      if(isMe || _isAdmin){
        html += '<button onclick="editComment(\''+c.id+'\',\''+containerId+'\',\''+recordType+'\',\''+String(recordId)+'\')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:11px;margin-left:auto">✏️</button>';
        html += '<button onclick="deleteComment(\''+c.id+'\',\''+containerId+'\',\''+recordType+'\',\''+String(recordId)+'\')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px">🗑️</button>';
      }
      html += '</div>';
      html += '<div style="font-size:13px;color:var(--text);white-space:pre-wrap">'+esc(c.body)+'</div>';
      html += '</div>';
    });
    // Add comment input
    html += '<div style="margin-top:10px;display:flex;gap:6px">';
    html += '<input type="text" id="new-comment-'+containerId+'" class="form-control" placeholder="Add a comment... (Enter to submit)" style="flex:1;font-size:13px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();submitComment(\''+recordType+'\',\''+String(recordId)+'\',\''+containerId+'\')}">';
    html += '<button class="btn btn-secondary btn-sm" onclick="submitComment(\''+recordType+'\',\''+String(recordId)+'\',\''+containerId+'\')">Post</button>';
    html += '</div>';
    container.innerHTML = html;
  }catch(e){
    container.innerHTML = '<div style="font-size:12px;color:var(--danger)">Could not load comments</div>';
  }
}

async function submitComment(recordType, recordId, containerId){
  var input = document.getElementById('new-comment-'+containerId);
  if(!input || !input.value.trim()) return;
  var body = input.value.trim();
  var ucolor = (_currentUserProfile && _currentUserProfile.user_color) || '#FFD700';
  var uname = (_currentUserProfile && (_currentUserProfile.display_name || _currentUserProfile.username)) || 'Unknown';
  var{error} = await db.from('comments').insert({
    user_id: currentUser.id,
    username: uname,
    user_color: ucolor,
    record_type: recordType,
    record_id: String(recordId),
    body: body
  });
  if(error){ toast(error.message,'error'); return; }
  input.value = '';
  await renderComments(recordType, recordId, containerId);
}

async function deleteComment(commentId, containerId, recordType, recordId){
  if(!confirm('Delete this comment?')) return;
  await db.from('comments').delete().eq('id', commentId);
  await renderComments(recordType, recordId, containerId);
}

async function editComment(commentId, containerId, recordType, recordId){
  var bodyEl = document.querySelector('#comment-'+commentId+' div[style*="pre-wrap"]');
  if(!bodyEl) return;
  var current = bodyEl.textContent;
  var newBody = prompt('Edit comment:', current);
  if(!newBody || newBody.trim() === current) return;
  await db.from('comments').update({body:newBody.trim(), updated_at:new Date().toISOString()}).eq('id', commentId);
  await renderComments(recordType, recordId, containerId);
}

// ─── TESTER DASHBOARD BUTTON ─────────────────────────────────────────────────


// ─── ANNOUNCEMENTS CARD ──────────────────────────────────────────────────────────────────────
// Admins post announcements targeted to specific roles. Users see relevant ones on dashboard.
// Resolved bug banners also appear here for unified messaging.
async function renderAnnouncementsCard(){
  var html = '<div class="card" style="margin-bottom:16px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">';
  html += '<div class="stat-label" style="display:flex;align-items:center;gap:6px">';
  html += '\u{1F4EC} Announcements';
  html += '<span title="Notes from admins and resolved bug fixes appear here." style="cursor:help;color:var(--text-muted);font-size:13px">\u24D8</span>';
  html += '</div>';
  if(_isAdmin){
    html += '<button class="btn btn-primary btn-sm" onclick="showAnnouncementModal()">+ New Announcement</button>';
  }
  html += '</div>';

  // Resolved bug banners (existing system, now lives inside Announcements)
  var bugBanners = '';
  try{
    var dismissed = (_currentUserProfile && _currentUserProfile.dismissed_resolutions) || [];
    var bRes = await db.from('feedback').select('id,title,resolution_message')
      .eq('is_published',true).eq('is_resolved',true)
      .order('resolved_at',{ascending:false}).limit(5);
    var bugs = (bRes.data||[]).filter(function(b){ return dismissed.indexOf(b.id) < 0; });
    bugs.forEach(function(b){
      bugBanners += '<div class="alert" style="background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      bugBanners += '<span>\u2705</span>';
      bugBanners += '<div style="flex:1;min-width:200px"><strong style="cursor:pointer;color:var(--success)" onclick="showView(\'feedback\')">'+esc(b.title||'Bug Fix')+'</strong>';
      if(b.resolution_message) bugBanners += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">'+esc(b.resolution_message)+'</div>';
      bugBanners += '</div>';
      bugBanners += '<button class="btn btn-ghost btn-sm" onclick="dismissResolution(\''+b.id+'\')">Dismiss</button>';
      bugBanners += '</div>';
    });
  }catch(e){}

  // Admin announcements targeted to user role
  var roleBanners = '';
  try{
    var myRole = (_currentUserProfile && _currentUserProfile.role) || 'viewer';
    var aRes = await db.from('announcements').select('*').order('created_at',{ascending:false}).limit(20);
    var anns = (aRes.data||[]).filter(function(a){
      if(!a.target_role || a.target_role === 'all') return true;
      return a.target_role === myRole;
    });
    anns.forEach(function(a){
      roleBanners += '<div class="alert" style="background:rgba(99,102,241,.1);border-color:rgba(99,102,241,.3);margin-bottom:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">';
      roleBanners += '<span>\u{1F4E3}</span>';
      roleBanners += '<div style="flex:1;min-width:200px">';
      if(a.title) roleBanners += '<strong>'+esc(a.title)+'</strong>';
      if(a.body) roleBanners += '<div style="font-size:13px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap">'+esc(a.body)+'</div>';
      if(a.image_url) roleBanners += '<img src="'+esc(a.image_url)+'" style="max-width:100%;max-height:240px;border-radius:6px;margin-top:8px">';
      roleBanners += '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">'+fmtDate(a.created_at)+'</div>';
      roleBanners += '</div>';
      if(_isAdmin){
        roleBanners += '<button class="btn btn-danger btn-sm" title="Delete permanently (cannot be undone)" onclick="deleteAnnouncement(\''+a.id+'\')">Del</button>';
      }
      roleBanners += '</div>';
    });
  }catch(e){}

  if(bugBanners || roleBanners){
    html += bugBanners + roleBanners;
  } else {
    html += '<div style="font-size:13px;color:var(--text-muted);font-style:italic;padding:8px">No announcements right now.</div>';
  }
  html += '</div>';
  return html;
}

// ─── ADMIN: POST ANNOUNCEMENT ────────────────────────────────────────────────────────────────
function showAnnouncementModal(){
  var modal = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
    '<div class="modal" style="max-width:520px">' +
    '<div class="modal-header"><div class="modal-title">New Announcement</div>' +
    '<button class="close-btn" onclick="closeModal()">&times;</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-group"><label>Visible to</label>' +
    '<select class="form-control" id="ann-target">' +
    '<option value="all">Everyone</option>' +
    '<option value="owner">Owners only</option>' +
    '<option value="tester">Testers only</option>' +
    '<option value="guest">Guests only</option>' +
    '<option value="viewer">Viewers only</option>' +
    '<option value="admin">Admins only</option>' +
    '</select></div>' +
    '<div class="form-group"><label>Title</label>' +
    '<input type="text" class="form-control" id="ann-title" placeholder="Short headline"></div>' +
    '<div class="form-group"><label>Message</label>' +
    '<textarea class="form-control" id="ann-body" rows="4" placeholder="What do you want to tell users?"></textarea></div>' +
    '<div class="form-group"><label>Image (optional)</label>' +
    '<input type="file" class="form-control" id="ann-image" accept="image/*"></div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveAnnouncement()">Post Announcement</button>' +
    '</div></div></div>';
  showModal(modal);
}

async function saveAnnouncement(){
  var target = val('ann-target') || 'all';
  var title = val('ann-title');
  var body = val('ann-body');
  if(!title && !body) return toast('Add a title or message','error');
  var imageUrl = null;
  var fileEl = document.getElementById('ann-image');
  var file = fileEl && fileEl.files && fileEl.files[0];
  if(file){
    try{
      imageUrl = await uploadFile('parts-images', file);
    }catch(e){
      toast('Image upload failed: '+e.message,'error');
      return;
    }
  }
  var{error} = await db.from('announcements').insert({
    title: title || null,
    body: body || null,
    image_url: imageUrl,
    target_role: target,
    created_by: currentUser.id
  });
  if(error){ toast(error.message,'error'); return; }
  toast('Announcement posted','success');
  closeModal();
  // Refresh dashboard
  if(_currentView === 'dashboard') await renderDashboard();
}

async function deleteAnnouncement(id){
  if(!confirm('Delete this announcement?')) return;
  await db.from('announcements').delete().eq('id', id);
  toast('Deleted','success');
  if(_currentView === 'dashboard') await renderDashboard();
}


function maybeShowTesterBanner(){
  var role = getEffectiveRole();
  // Viewer = default — show invite to join
  if(role === 'viewer'){
    return '<div class="alert" style="background:rgba(100,100,200,.1);border-color:rgba(100,100,200,.3);margin-bottom:16px;cursor:pointer" onclick="showView(\'profile\')">👀 <strong>You\'re only a spectator!</strong> Tap here to enter an invite code and join the cause.</div>';
  }
  if(role !== 'tester') return '';
  var resetReq = _currentUserProfile && _currentUserProfile.reset_requested;
  if(resetReq){
    return '<div class="alert alert-warning" style="margin-bottom:16px">⏳ <strong>Reset requested.</strong> Admin will clear your test data soon.</div>';
  }
  return '<div class="alert" style="background:rgba(100,100,200,.1);border-color:rgba(100,100,200,.3);margin-bottom:16px">🧪 <strong>Tester mode.</strong> <button class="btn btn-secondary btn-sm" onclick="requestReTest()" style="margin-left:8px">Request Data Reset</button></div>';
}

// ─── BUG RESOLUTION BANNERS ────────────────────────────────────────────────────────────────────
async function maybeShowResolutionBanners(){
  if(!currentUser) return '';
  try{
    var dismissed = (_currentUserProfile && _currentUserProfile.dismissed_resolutions) || [];
    var res = await db.from('feedback').select('id,title,resolution_message')
      .eq('is_published',true).eq('is_resolved',true)
      .order('resolved_at',{ascending:false}).limit(5);
    var bugs = (res.data||[]).filter(function(b){ return dismissed.indexOf(b.id) < 0; });
    if(bugs.length === 0) return '';
    var html = '';
    bugs.forEach(function(b){
      html += '<div class="alert" style="background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      html += '<span>&#x2705;</span>';
      html += '<div style="flex:1;min-width:200px">';
      html += '<strong style="cursor:pointer;color:var(--success)" onclick="showView(\'feedback\')">'+esc(b.title||'Bug Fix')+'</strong>';
      if(b.resolution_message) html += '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">'+esc(b.resolution_message)+'</div>';
      html += '</div>';
      html += '<button class="btn btn-ghost btn-sm" onclick="dismissResolution(\''+b.id+'\')">Dismiss</button>';
      html += '</div>';
    });
    return html;
  }catch(e){ return ''; }
}

async function dismissResolution(bugId){
  var dismissed = (_currentUserProfile && _currentUserProfile.dismissed_resolutions) || [];
  if(dismissed.indexOf(bugId) < 0) dismissed.push(bugId);
  await db.from('profiles').update({dismissed_resolutions:dismissed}).eq('id',currentUser.id);
  if(_currentUserProfile) _currentUserProfile.dismissed_resolutions = dismissed;
  // Re-render current view
  var parsed = parseHash(window.location.hash);
  await showView(parsed.view || 'dashboard', parsed.arg);
}




// ─── FEEDBACK PAGE ───────────────────────────────────────────────────────────

// (renderFeedbackPage defined above)

async function submitFeedback(){
  var type = val('feedback-type') || 'bug';
  var title = val('feedback-title');
  var desc = val('feedback-desc');
  // title is optional for user submissions — admin sets at publish time
  var uname = (_currentUserProfile && (_currentUserProfile.display_name||_currentUserProfile.username)) || 'Unknown';
  var ucolor = (_currentUserProfile && _currentUserProfile.user_color) || '#FFD700';
  var{error} = await db.from('feedback').insert({
    user_id: currentUser.id,
    username: uname,
    user_color: ucolor,
    type: type,
    title: title,
    description: desc,
    status: 'new'
  });
  if(error){ toast(error.message,'error'); return; }
  toast('Feedback submitted! Thank you.','success');
  await renderFeedbackPage();
}

async function setFeedbackStatus(id, status){
  await db.from('feedback').update({status:status, updated_at:new Date().toISOString()}).eq('id',id);
  await renderFeedbackPage();
}

async function addAdminNote(id){
  var note = prompt('Add a note for the user:');
  if(note===null) return;
  await db.from('feedback').update({admin_note:note, updated_at:new Date().toISOString()}).eq('id',id);
  toast('Note added','success');
  await renderFeedbackPage();
}

async function deleteFeedback(id){
  if(!confirm('Delete this feedback entry?')) return;
  await db.from('feedback').delete().eq('id',id);
  toast('Deleted','success');
  await renderFeedbackPage();
}


// ─── AUTO MAINTENANCE DEFAULTS ────────────────────────────────────────────────────────────────
// Created automatically when a new vehicle is added
// reminder_type uses 'mileage' | 'time' | 'both' (DB constraint)
var AUTO_MAINTENANCE = [
  {title:'Oil Change',          interval_miles:5000,  interval_days:180,  reminder_type:'both'},
  {title:'Tire Rotation',       interval_miles:7500,  interval_days:180,  reminder_type:'both'},
  {title:'Air Filter (Engine)', interval_miles:15000, interval_days:365,  reminder_type:'both'},
  {title:'Cabin Air Filter',    interval_miles:15000, interval_days:365,  reminder_type:'both'},
  {title:'Spark Plugs',         interval_miles:30000, interval_days:null, reminder_type:'mileage'},
  {title:'Coolant Check',       interval_miles:30000, interval_days:730,  reminder_type:'both'},
  {title:'Brake Fluid',         interval_miles:null,  interval_days:730,  reminder_type:'time'},
  {title:'Windshield Wipers',   interval_miles:null,  interval_days:365,  reminder_type:'time'},
  {title:'Wiper Fluid',         interval_miles:null,  interval_days:90,   reminder_type:'time'},
  {title:'Battery Check',       interval_miles:null,  interval_days:730,  reminder_type:'time'},
];

// Commute style mileage estimates (miles per year)
var COMMUTE_STYLES = {
  city:     {label:'City Driver',       miles_per_year:8000,  desc:'Lots of short trips, stop-and-go'},
  mixed:    {label:'Mixed',             miles_per_year:12000, desc:'Combination of city and highway'},
  highway:  {label:'Highway Commuter',  miles_per_year:15000, desc:'Mostly highway, longer trips'},
  weekend:  {label:'Weekend Driver',    miles_per_year:3000,  desc:'Rarely used, low mileage'},
  worktruck:{label:'Work Truck',        miles_per_year:20000, desc:'Heavy use, towing or hauling'},
};

