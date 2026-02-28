(function () {
  // Tenant UI elements
  const elLogo = document.getElementById('tenantLogo');
  const elName = document.getElementById('tenantName');
  const elPkgs = document.getElementById('packages'); // existing packages section (if present)
  const elDebug = document.getElementById('debug');

  const btnCoudersport = document.getElementById('ctaCoudersport');
  const btnWellsboro = document.getElementById('ctaWellsboro');

  // Addresses UI
  const territorySelect = document.getElementById('territorySelect');
  const refreshBtn = document.getElementById('refreshBtn');
  const addrList = document.getElementById('addrList');
  const addrCount = document.getElementById('addrCount');
  const repSelect = document.getElementById('repSelect');
  const switchUserBtn = document.getElementById('switchUserBtn');

  // Disposition UI
  const selectedAddr = document.getElementById('selectedAddr');
  const outcomeSel = document.getElementById('outcome');
  const soldWrap = document.getElementById('soldWrap');
  const soldPackageSel = document.getElementById('soldPackage');
  const noteEl = document.getElementById('note');
  const submitBtn = document.getElementById('submitDisp');
  const formMsg = document.getElementById('formMsg');

  // ---- DEBUG: confirm required elements exist ----
const required = [
  ['tenantLogo', elLogo],
  ['tenantName', elName],
  ['debug', elDebug],
  ['territorySelect', territorySelect],
  ['refreshBtn', refreshBtn],
  ['addrList', addrList],
  ['addrCount', addrCount],
  ['repSelect', repSelect],
  ['selectedAddr', selectedAddr],
  ['outcome', outcomeSel],
  ['soldWrap', soldWrap],
  ['soldPackage', soldPackageSel],
  ['note', noteEl],
  ['submitDisp', submitBtn],
  ['formMsg', formMsg],
  ['switchUserBtn', switchUserBtn],
];

const missing = required.filter(([, el]) => !el).map(([id]) => id);
if (missing.length) {
  throw new Error(`Missing HTML element(s): ${missing.join(', ')}`);
}
  // App state
  let TENANT = null;
  let ADDRESSES = [];
  let SELECTED_ID = null;
  let REPS = [];        // {id, full_name, role}
  let REP_BY_ID = {};   // id -> rep object

  function slugFromQuery() {
    const params = new URLSearchParams(location.search);
    const s = (params.get('slug') || '').trim().toLowerCase();
    return s || null;
  }

  async function loadTenantConfig() {
    const slug = slugFromQuery() || 'zito';
    const r = await fetch(`/api/tenant-config?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error(`tenant-config failed (${r.status})`);
    const json = await r.json();
    if (!json || json.status !== 'ok' || !json.tenant) throw new Error('Invalid tenant-config response');
    return json.tenant;
  }

  function applyBranding(tenant) {
    if (tenant.primary_color) document.documentElement.style.setProperty('--brand', tenant.primary_color);

    elName.textContent = tenant.name || tenant.slug || 'FieldOS';
    if (tenant.logo_url) {
      elLogo.src = tenant.logo_url;
      elLogo.style.display = '';
    } else {
      elLogo.removeAttribute('src');
    }

    const phones = (tenant.config && tenant.config.supportPhones) ? tenant.config.supportPhones : {};
    const c = phones.coudersport ? String(phones.coudersport).trim() : '';
    const w = phones.wellsboro ? String(phones.wellsboro).trim() : '';

    if (c) {
      btnCoudersport.href = `tel:${c}`;
      btnCoudersport.textContent = `Call Coudersport (${c})`;
      btnCoudersport.style.display = '';
    }
    if (w) {
      btnWellsboro.href = `tel:${w}`;
      btnWellsboro.textContent = `Call Wellsboro (${w})`;
      btnWellsboro.style.display = '';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function saveActiveRep(rep) {
    localStorage.setItem('fieldos_active_rep', JSON.stringify(rep));
  }
  function loadActiveRep() {
    try { return JSON.parse(localStorage.getItem('fieldos_active_rep') || 'null'); }
    catch (e) { return null; }
  }
  function clearActiveRep() {
    localStorage.removeItem('fieldos_active_rep');
  }

  function applyRoleUI(activeRep) {
  const role = activeRep ? String(activeRep.role || '').toLowerCase() : 'manager';

  if (role === 'rep') {
    repSelect.value = activeRep.id;
    repSelect.disabled = true;          // lock in rep mode
    switchUserBtn.style.display = '';   // show escape hatch
  } else {
    repSelect.disabled = false;
    switchUserBtn.style.display = 'none';
  }
}
  // ---------- Addresses ----------
  async function fetchAddresses() {
  const slug = slugFromQuery() || 'zito';
  const territory = territorySelect && territorySelect.value ? territorySelect.value : '';

  const activeRep = loadActiveRep(); // {id, full_name, role} or null

  // If saved rep is a rep-role, force repId to that rep.
  // Otherwise, allow manager to filter by dropdown (or all if blank).
  const repId =
    (activeRep && String(activeRep.role || '').toLowerCase() === 'rep')
      ? activeRep.id
      : (repSelect && repSelect.value ? repSelect.value : '');

  let url = `/api/addresses?slug=${encodeURIComponent(slug)}`;
  if (territory) url += `&territory=${encodeURIComponent(territory)}`;
  if (repId) url += `&rep_id=${encodeURIComponent(repId)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`addresses failed (${r.status})`);
  const json = await r.json();
  if (!json || json.status !== 'ok') throw new Error('Invalid addresses response');
  return json.rows || [];
}

  async function fetchReps() {
   const slug = slugFromQuery() || 'zito';
    const r = await fetch(`/api/reps?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error(`reps failed (${r.status})`);
    const json = await r.json();
    if (!json || json.status !== 'ok') throw new Error('Invalid reps response');
    return json.reps || [];
  }

  function renderRepDropdown(reps) {
    REPS = reps;
   REP_BY_ID = {};
    reps.forEach(r => { REP_BY_ID[r.id] = r; });

   repSelect.innerHTML =
    `<option value="">All Reps (Manager)</option>` +
    reps.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.full_name)} (${escapeHtml(r.role)})</option>`).join('');
  }

  function uniqueTerritories(rows) {
    const set = new Set();
    rows.forEach(r => { if (r.territory) set.add(r.territory); });
    return Array.from(set).sort();
  }

  function statusBadge(status) {
    const s = String(status || 'pending');
    return `<span class="badge">${escapeHtml(s)}</span>`;
  }

  function renderAddresses(rows) {
    ADDRESSES = rows;

    addrCount.textContent = `${rows.length} address${rows.length === 1 ? '' : 'es'} loaded`;

    // Keep selection if possible
    if (SELECTED_ID && !rows.some(r => r.id === SELECTED_ID)) {
      SELECTED_ID = null;
      selectedAddr.textContent = 'Select an address to disposition';
    }

    addrList.innerHTML = rows.map(r => {
      const isSel = (r.id === SELECTED_ID);
      return `
        <div class="addrItem ${isSel ? 'selected' : ''}" data-id="${escapeHtml(r.id)}">
          <div class="addrTop">
            <div>
              <div class="addrName">${escapeHtml(r.address)}, ${escapeHtml(r.city)} ${escapeHtml(r.state)} ${escapeHtml(r.zip)}</div>
              <div class="addrMeta">
                ${escapeHtml(r.territory || '')}
                ${r.reps && r.reps.full_name ? ` · Assigned: ${escapeHtml(r.reps.full_name)}` : ''}
              </div>
            </div>
            ${statusBadge(r.status)}
          </div>
        </div>
      `;
    }).join('');

    // Click handlers
    Array.from(addrList.querySelectorAll('.addrItem')).forEach(el => {
      el.addEventListener('click', () => {
        SELECTED_ID = el.getAttribute('data-id');
        renderAddresses(ADDRESSES);
        const row = ADDRESSES.find(a => a.id === SELECTED_ID);
        if (row) {
          selectedAddr.textContent = `${row.address}, ${row.city} ${row.state} ${row.zip}`;
          formMsg.textContent = '';
        }
      });
    });
  }

  function buildTerritoryDropdown(allRows) {
    const terrs = uniqueTerritories(allRows);
    const current = territorySelect.value || '';
    territorySelect.innerHTML = `<option value="">All Territories</option>` +
      terrs.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    territorySelect.value = terrs.includes(current) ? current : '';
  }

  // ---------- Disposition ----------
  function buildSoldPackages() {
    const pkgs = (TENANT && TENANT.config && Array.isArray(TENANT.config.packages)) ? TENANT.config.packages : [];
    soldPackageSel.innerHTML = pkgs.map(p => `<option value="${escapeHtml(p.name || '')}">${escapeHtml(p.name || '')}</option>`).join('');
  }

  function updateSoldVisibility() {
    const v = outcomeSel.value;
    soldWrap.style.display = (v === 'sold') ? '' : 'none';
  }

  async function submitDisposition() {
    if (!SELECTED_ID) {
      formMsg.textContent = 'Select an address first.';
      return;
    }

    const payload = {
      slug: (slugFromQuery() || 'zito'),
      address_id: SELECTED_ID,
      outcome: outcomeSel.value,
      note: noteEl.value || ''
    };

    if (payload.outcome === 'sold') {
      payload.sold_package = soldPackageSel.value || '';
    }
    const activeRep = loadActiveRep();
    let repId = null;

    if (activeRep && String(activeRep.role || '').toLowerCase() === 'rep') {
      repId = activeRep.id;          // forced
    } else {
      repId = repSelect.value || null; // manager chooses
    }

    if (!repId) {
      formMsg.textContent = 'Select a rep first.';
      submitBtn.disabled = false;
      return;
    }

payload.rep_id = repId;

    submitBtn.disabled = true;
    formMsg.textContent = 'Submitting…';

    try {
      const r = await fetch('/api/disposition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error((json && json.message) ? json.message : `disposition failed (${r.status})`);

      formMsg.textContent = 'Saved ✅';
      noteEl.value = '';

      // Refresh addresses list to show status change
      const rows = await fetchAddresses();
      renderAddresses(rows);
    } catch (e) {
      formMsg.textContent = `Error: ${e.message || e}`;
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function boot() {
    try {
      TENANT = await loadTenantConfig();
      applyBranding(TENANT);
      elDebug.textContent = JSON.stringify(TENANT, null, 2);
      const reps = await fetchReps();
      renderRepDropdown(reps);
      buildSoldPackages();
      updateSoldVisibility();
      outcomeSel.addEventListener('change', updateSoldVisibility);
      // Restore last selected rep (role-based)
      const saved = loadActiveRep();
      if (saved && saved.id && REP_BY_ID[saved.id]) {
        repSelect.value = saved.id;
        applyRoleUI(saved);
      } else {
        clearActiveRep();
        applyRoleUI(null);
      }
      // Load addresses
      const allRows = await fetch(`/api/addresses?slug=${encodeURIComponent(slugFromQuery() || 'zito')}`)
        .then(r => r.json())
        .then(j => (j && j.status === 'ok') ? j.rows : []);

      buildTerritoryDropdown(allRows);

      // Load (with filter)
      const rows = await fetchAddresses();
      renderAddresses(rows);

      refreshBtn.addEventListener('click', async () => {
        const rows2 = await fetchAddresses();
        renderAddresses(rows2);
      });
      repSelect.addEventListener('change', async () => {
        const id = repSelect.value || '';
        const rep = id ? REP_BY_ID[id] : null; // null => manager/all reps
        saveActiveRep(rep);
        applyRoleUI(rep);

        const rows2 = await fetchAddresses();
        renderAddresses(rows2);
      });
      switchUserBtn.addEventListener('click', async () => {
        clearActiveRep();                 // back to manager mode
        repSelect.value = '';             // All Reps (Manager)
        applyRoleUI(null);

        const rows2 = await fetchAddresses();
        renderAddresses(rows2);
      });
      territorySelect.addEventListener('change', async () => {
        const rows2 = await fetchAddresses();
        renderAddresses(rows2);
      });

      submitBtn.addEventListener('click', submitDisposition);
    } catch (e) {
      elName.textContent = 'FieldOS';
      elDebug.textContent = `ERROR:\n${e.message || e}`;
      console.error(e);
    }
  }

  boot();
})();