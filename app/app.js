// app/app.js
(function () {
  const elLogo = document.getElementById('tenantLogo');
  const elName = document.getElementById('tenantName');
  const elPkgs = document.getElementById('packages');
  const elDebug = document.getElementById('debug');

  const btnCoudersport = document.getElementById('ctaCoudersport');
  const btnWellsboro = document.getElementById('ctaWellsboro');

  function slugFromQuery() {
    const params = new URLSearchParams(location.search);
    const s = (params.get('slug') || '').trim().toLowerCase();
    return s || null;
  }

  async function loadTenantConfig() {
    const slug = slugFromQuery() || 'zito'; // dev default
    const r = await fetch(`/api/tenant-config?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`tenant-config failed (${r.status}): ${t}`);
    }
    const json = await r.json();
    if (!json || json.status !== 'ok' || !json.tenant) throw new Error('Invalid tenant-config response');
    return json.tenant;
  }

  function applyBranding(tenant) {
    // Brand color
    if (tenant.primary_color) {
      document.documentElement.style.setProperty('--brand', tenant.primary_color);
    }

    // Tenant name + logo
    elName.textContent = tenant.name || tenant.slug || 'FieldOS';
    if (tenant.logo_url) {
      elLogo.src = tenant.logo_url;
      elLogo.style.display = '';
    } else {
      // If no logo, keep placeholder visible but empty
      elLogo.removeAttribute('src');
    }

    // Support phone CTAs (optional)
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

  function renderPackages(tenant) {
    const pkgs = (tenant.config && Array.isArray(tenant.config.packages)) ? tenant.config.packages : [];
    if (!pkgs.length) {
      elPkgs.innerHTML = `<div class="pkg"><div class="name">No packages configured</div><div class="speed">Add packages to companies.config_json</div></div>`;
      return;
    }

    elPkgs.innerHTML = pkgs.map(p => {
      const name = p.name || 'Package';
      const down = (p.down != null) ? `${p.down} Mbps` : '—';
      const up = (p.up != null) ? `${p.up} Mbps` : '—';
      const price = (p.price != null) ? `$${Number(p.price).toFixed(2)}/mo` : '';
      return `
        <div class="pkg">
          <div class="name">${escapeHtml(name)}</div>
          <div class="speed">Download: ${escapeHtml(down)} · Upload: ${escapeHtml(up)}</div>
          <div class="price">${escapeHtml(price)}</div>
        </div>
      `;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function boot() {
    try {
      const tenant = await loadTenantConfig();
      applyBranding(tenant);
      renderPackages(tenant);
      elDebug.textContent = JSON.stringify(tenant, null, 2);
    } catch (e) {
      elName.textContent = 'FieldOS';
      elDebug.textContent = `ERROR:\n${e.message || e}`;
      console.error(e);
    }
  }

  boot();
})();