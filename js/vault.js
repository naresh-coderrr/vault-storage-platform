const VaultAuth = (() => {
  const KEY = 'vault.session';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch { return null; }
  }
  function save(session) { localStorage.setItem(KEY, JSON.stringify(session)); }
  function clear() { localStorage.removeItem(KEY); }
  function token() { return load()?.token || ''; }
  function operator() { return load()?.operator || null; }
  function requirePage() {
    if (!token()) {
      const next = encodeURIComponent(location.pathname.split('/').pop() || 'dashboard.html');
      location.replace(`login.html?next=${next}`);
      return false;
    }
    return true;
  }
  return { load, save, clear, token, operator, requirePage };
})();

const VaultAPI = (() => {
  function headers(extra) {
    const h = Object.assign({ Accept: 'application/json' }, extra || {});
    const t = VaultAuth.token();
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  async function request(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 204) return null;
    const ctype = res.headers.get('content-type') || '';
    const body = ctype.includes('json') ? await res.json() : await res.blob();
    if (!res.ok) {
      const msg = body && body.error ? body.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return body;
  }

  function get(path) { return request(path, { headers: headers() }); }
  function send(path, method, json) {
    return request(path, {
      method,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(json || {}),
    });
  }
  function upload(file, replicationFactor) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('replicationFactor', String(replicationFactor || 3));
    return request('/api/v1/objects/upload', { method: 'POST', headers: headers(), body: fd });
  }
  async function download(id, filename) {
    const res = await fetch(`/api/v1/objects/${id}/download`, { headers: headers() });
    if (!res.ok) {
      let msg = 'Download failed';
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'object.bin';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function health() {
    try { return await get('/api/health'); }
    catch { return { status: 'down' }; }
  }

  return { get, send, upload, download, health };
})();

function toast(msg) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function statusBadge(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'HEALTHY' || s === 'ACTIVE' || s === 'OK') return '<span class="badge ok">Healthy</span>';
  if (s === 'DEGRADED' || s === 'HEALING') return '<span class="badge warn">Degraded</span>';
  if (s === 'OFFLINE') return '<span class="badge bad">Offline</span>';
  return `<span class="badge neutral">${status || 'unknown'}</span>`;
}

function relative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return new Date(iso).toLocaleString();
}

const VaultShell = {
  async mount(page) {
    if (!VaultAuth.requirePage()) return null;
    const op = VaultAuth.operator();
    const health = await VaultAPI.health();
    const live = health && health.status === 'ok';
    document.body.innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <a class="brand" href="dashboard.html" style="margin:4px 8px 16px">
            <span class="mark">V</span> Vault
          </a>
          <a class="nav-link ${page === 'overview' ? 'active' : ''}" href="dashboard.html">Overview</a>
          <a class="nav-link ${page === 'objects' ? 'active' : ''}" href="objects.html">Objects</a>
          <a class="nav-link ${page === 'cluster' ? 'active' : ''}" href="cluster.html">Cluster</a>
          <a class="nav-link ${page === 'repair' ? 'active' : ''}" href="repair.html">Repair & integrity</a>
          <a class="nav-link ${page === 'durability' ? 'active' : ''}" href="settings.html">Durability</a>
          <div class="grow"></div>
          <div style="padding:10px 12px;font-size:12px;color:var(--ink-soft)">${op?.email || ''}</div>
          <button class="nav-link" id="signOut" type="button">Sign out</button>
        </aside>
        <main class="main">
          <div class="top">
            <div>
              <h1 id="pageTitle"></h1>
              <p class="sub" id="pageSub"></p>
            </div>
            <div class="gateway-pill ${live ? '' : 'off'}" id="livePill">${live ? 'Gateway reachable' : 'Gateway down'}</div>
          </div>
          <div id="pageRoot"></div>
        </main>
      </div>
    `;
    document.getElementById('signOut').onclick = async () => {
      try { await VaultAPI.send('/api/v1/auth/logout', 'POST', {}); } catch {}
      VaultAuth.clear();
      location.replace('index.html');
    };
    return document.getElementById('pageRoot');
  },
  setHeading(title, sub) {
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSub').textContent = sub || '';
  }
};
