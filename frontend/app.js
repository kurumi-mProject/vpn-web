const API = '/api';
let token = localStorage.getItem('vpn_token');
let userData = null;
let selectedPlanEl = null;

window.addEventListener('load', () => {
  if (token) loadMe();
  initScrollAnimations();
  document.addEventListener('click', e => {
    const menu = document.getElementById('mobile-menu');
    if (menu.classList.contains('open') && !e.target.closest('.navbar') && !e.target.closest('.mobile-menu')) {
      menu.classList.remove('open');
      document.querySelector('.nav-burger')?.classList.remove('open');
    }
  });
});

// ── Mobile menu ────────────────────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const burger = document.querySelector('.nav-burger');
  menu.classList.toggle('open');
  burger.classList.toggle('open');
}

// ── Scroll animations ──────────────────────────────────────────────────────
function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.anim').forEach(el => obs.observe(el));
}

// ── Plan selection (landing) ───────────────────────────────────────────────
function selectPlan(el, months, price, label) {
  document.querySelectorAll('.plan').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  selectedPlanEl = el;
  document.getElementById('plan-confirm-name').textContent = label;
  document.getElementById('plan-confirm-price').textContent = price + ' · VPN + Прокси';
  document.getElementById('plan-confirm-bar').classList.add('show');
}

function confirmPlan() {
  showAuth();
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function loginByCode() {
  const input = document.getElementById('login-code-input');
  const errEl = document.getElementById('login-error');
  const code = input.value.trim();
  errEl.style.display = 'none';
  if (!code) return;

  const res = await fetch(`${API}/auth/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!res.ok) {
    errEl.textContent = res.status === 401 ? '❌ Неверный или истёкший код' : '❌ Ошибка входа';
    errEl.style.display = 'block';
    return;
  }
  const data = await res.json();
  token = data.token;
  userData = data.user;
  localStorage.setItem('vpn_token', token);
  input.value = '';
  hideAuth();
  openDashboard(data.user);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('auth-modal').classList.contains('open')) loginByCode();
});

function showAuth() {
  const m = document.getElementById('auth-modal');
  m.classList.add('open');
  m.onclick = e => { if(e.target === m) hideAuth(); };
}
function hideAuth() {
  document.getElementById('auth-modal').classList.remove('open');
}
function hideAuth() { document.getElementById('auth-modal').classList.remove('open'); }
function closeModal(e) { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); }

// ── Load profile ───────────────────────────────────────────────────────────
async function loadMe() {
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { localStorage.removeItem('vpn_token'); token = null; return; }
  userData = await res.json();
  updateNavAuth(userData);
  // Автоматически открываем дашборд если токен валиден
  openDashboard(userData);
}

function updateNavAuth(user) {
  document.getElementById('nav-auth').innerHTML = `
    <button class="btn-glass" onclick="openDashboard()">
      ${user.avatar ? `<img src="${user.avatar}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px">` : ''}
      ${user.name || 'Кабинет'}
    </button>
    <button class="btn-glass" onclick="logout()" style="margin-left:8px;padding:10px 14px">Выйти</button>
  `;
}

// ── Dashboard page ─────────────────────────────────────────────────────────
async function openDashboard(user) {
  if (!user) {
    if (userData) { user = userData; }
    else {
      const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { showAuth(); return; }
      user = await res.json(); userData = user;
    }
  }
  updateNavAuth(user);

  // Fill sidebar
  const avatarMini = document.getElementById('dash-avatar-mini');
  avatarMini.src = user.avatar || '';
  document.getElementById('dash-name-mini').textContent = user.name || 'Пользователь';
  document.getElementById('dash-greeting-name').textContent = (user.name || 'друг').split(' ')[0];

  const vpn = user.vpn;
  const isActive = vpn && vpn.active;
  const statusDot = document.querySelector('.dash-status-dot');
  statusDot.className = 'dash-status-dot' + (isActive ? ' active' : '');
  document.getElementById('dash-sub-status-mini').textContent = isActive ? 'Активна' : 'Не активна';

  // Sub badge
  document.getElementById('dash-sub-badge-wrap').innerHTML = isActive
    ? `<div class="sub-badge-active">✅ Подписка активна</div>`
    : `<div class="sub-badge-inactive">❌ Нет подписки</div>`;

  // Overview status
  const ovStatus = document.getElementById('ov-status-content');
  if (vpn) {
    ovStatus.innerHTML = `
      <div class="ov-status-row">
        <div class="${isActive ? 'sub-badge-active' : 'sub-badge-inactive'}">${isActive ? '✅ Активна' : '❌ Не активна'}</div>
        <div style="font-size:.85rem;color:var(--muted)">до <b style="color:var(--text)">${vpn.paid_until || '—'}</b></div>
      </div>`;
  } else {
    ovStatus.innerHTML = `<div class="sub-badge-inactive">❌ Подписка не оформлена</div>
      <div style="font-size:.84rem;color:var(--muted);margin-top:10px">Оформите в <a href="https://t.me/KomoVpn_bot" target="_blank" style="color:var(--blue)">@KomoVpn_bot</a></div>`;
  }

  // Donut traffic
  const limit = vpn ? (vpn.traffic_limit_gb || 50) : 50;
  const used = vpn ? (vpn.traffic_used_gb || 0) : 0;
  const pct = Math.min((used / limit) * 100, 100);
  document.getElementById('donut-pct').textContent = Math.round(pct) + '%';
  document.getElementById('donut-used').textContent = used.toFixed(2) + ' ГБ';
  document.querySelectorAll('.donut-stats span:last-child').forEach(el => el.textContent = limit + ' ГБ');
  setTimeout(() => {
    const offset = 188.5 - (188.5 * pct / 100);
    document.getElementById('donut-fill').style.strokeDashoffset = offset;
  }, 300);

  // Детальный трафик VPN vs Прокси
  if (vpn && vpn.active) {
    loadTrafficDetail(limit);
    startTrafficAutoRefresh(limit);
  }

  // Days left
  const daysEl = document.getElementById('ov-days-left');
  const daysBarFill = document.getElementById('days-bar-fill');
  if (vpn && vpn.paid_until) {
    const diff = Math.max(0, Math.ceil((new Date(vpn.paid_until) - new Date()) / 86400000));
    daysEl.textContent = diff + ' дн.';
    document.getElementById('ov-paid-until').textContent = 'до ' + vpn.paid_until;
    setTimeout(() => { daysBarFill.style.width = Math.min(diff / 30 * 100, 100) + '%'; }, 400);
  } else {
    daysEl.textContent = '—';
    daysBarFill.style.width = '0%';
  }

  // Referral link
  document.getElementById('ref-link-val').textContent = `https://t.me/KomoVpn_bot?start=ref_${user.tg_id || 'you'}`;
  document.getElementById('ref-count').textContent = user.referral_count ?? '0';
  document.getElementById('ref-days').textContent = ((user.referral_count ?? 0) * 7) + ' дн.';

  // Sparkline
  drawSparkline(vpn);

  // Show page
  document.getElementById('dashboard-page').classList.remove('hidden');
  document.getElementById('main-footer').style.display = 'none';
  document.querySelectorAll('section, .navbar').forEach(el => el.style.display = 'none');

  switchDashTab('overview');
}

function closeDashboard() {
  document.getElementById('dashboard-page').classList.add('hidden');
  document.getElementById('main-footer').style.display = '';
  document.querySelectorAll('section, .navbar').forEach(el => el.style.display = '');
}

function logout() {
  localStorage.removeItem('vpn_token'); token = null; userData = null;
  stopTrafficAutoRefresh();
  closeDashboard();
  document.getElementById('nav-auth').innerHTML = `<button class="btn-glass" onclick="showAuth()">Войти</button>`;
}

// ── Dashboard tabs ─────────────────────────────────────────────────────────
function switchDashTab(name) {
  document.querySelectorAll('.dash-nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
  const tabs = ['overview','vpn','proxy','plans','referral','gpt'];
  const idx = tabs.indexOf(name);
  if (idx >= 0) document.querySelectorAll('.dash-nav-item')[idx].classList.add('active');
  document.getElementById('dtab-' + name).classList.add('active');
  if (name === 'vpn') loadVPN();
  if (name === 'proxy') loadProxy();
  if (name === 'gpt') loadGPT();
}

// ── VPN config ─────────────────────────────────────────────────────────────
async function loadVPN() {
  const el = document.getElementById('vpn-content');
  el.innerHTML = '<span style="color:var(--muted)">⏳ Загружаю...</span>';
  const res = await fetch(`${API}/config/vpn`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    el.innerHTML = err.detail === 'Subscription not active'
      ? `❌ Подписка не активна. <a href="https://t.me/KomoVpn_bot" target="_blank" style="color:var(--blue)">Оплатить в боте →</a>`
      : '❌ ' + (err.detail || 'Ошибка');
    return;
  }
  const { link } = await res.json();

  // Загружаем sub-ссылку параллельно
  const subRes = await fetch(`${API}/config/sub`, { headers: { Authorization: `Bearer ${token}` } });
  const subData = subRes.ok ? await subRes.json() : null;

  el.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">VLESS конфиг</div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;word-break:break-all;cursor:pointer;color:var(--blue);line-height:1.6;font-size:.8rem;transition:background .2s"
           onclick="copyText('${link}',this)"
           onmouseover="this.style.background='rgba(255,255,255,.07)'"
           onmouseout="this.style.background='rgba(255,255,255,.04)'">${link}</div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:6px">👆 Нажмите чтобы скопировать</div>
    </div>
    ${subData ? `
    <div style="background:linear-gradient(135deg,rgba(139,92,246,.12),rgba(59,130,246,.08));border:1px solid rgba(139,92,246,.25);border-radius:16px;padding:20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="font-size:1.4rem">🔗</span>
        <div>
          <div style="font-weight:600;font-size:.95rem">Ссылка на подписку</div>
          <div style="font-size:.75rem;color:var(--muted)">Вставьте в приложение — конфиги обновляются автоматически</div>
        </div>
      </div>
      <div style="background:rgba(0,0,0,.25);border-radius:10px;padding:12px 14px;word-break:break-all;font-size:.78rem;color:var(--text);margin-bottom:12px;cursor:pointer;transition:background .2s"
           onclick="copyText('${subData.url}',this)"
           onmouseover="this.style.background='rgba(0,0,0,.4)'"
           onmouseout="this.style.background='rgba(0,0,0,.25)'">${subData.url}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="background:rgba(139,92,246,.2);border:1px solid rgba(139,92,246,.3);border-radius:20px;padding:4px 12px;font-size:.72rem">v2rayNG</span>
        <span style="background:rgba(59,130,246,.2);border:1px solid rgba(59,130,246,.3);border-radius:20px;padding:4px 12px;font-size:.72rem">Hiddify</span>
        <span style="background:rgba(16,185,129,.2);border:1px solid rgba(16,185,129,.3);border-radius:20px;padding:4px 12px;font-size:.72rem">Streisand</span>
        <span style="background:rgba(245,158,11,.2);border:1px solid rgba(245,158,11,.3);border-radius:20px;padding:4px 12px;font-size:.72rem">NekoBox</span>
      </div>
    </div>` : ''}
  `;
}

// ── Proxy config ───────────────────────────────────────────────────────────
async function loadProxy() {
  const loading = '<span style="color:var(--muted)">⏳</span>';
  document.getElementById('proxy-socks-content').innerHTML = loading;
  document.getElementById('proxy-http-content').innerHTML = loading;

  const res = await fetch(`${API}/config/proxy`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    document.getElementById('proxy-socks-content').textContent = '❌ Подписка не активна';
    document.getElementById('proxy-http-content').textContent = '❌ Подписка не активна';
    return;
  }
  const c = await res.json();
  const tgSocks = `tg://proxy?server=${c.host}&port=${c.socks5_port}&user=${c.login}&pass=${c.password}&type=socks5`;
  const tgHttp  = `tg://proxy?server=${c.host}&port=${c.http_port}&user=${c.login}&pass=${c.password}&type=http`;

  document.getElementById('proxy-socks-port').textContent = ':' + c.socks5_port;
  document.getElementById('proxy-http-port').textContent = ':' + c.http_port;

  const row = (label, val) => `<div class="proxy-row">${label} <span onclick="copyText('${val}',this)">${val}</span></div>`;
  document.getElementById('proxy-socks-content').innerHTML = row('🔌 Порт', c.socks5_port);
  document.getElementById('proxy-http-content').innerHTML = row('🔌 Порт', c.http_port);
  document.getElementById('proxy-tg-socks').href = tgSocks;
  document.getElementById('proxy-tg-http').href = tgHttp;

  document.getElementById('proxy-shared-content').innerHTML = `
    <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px">Общие данные</div>
    ${row('🖥 Хост', c.host)}
    ${row('👤 Логин', c.login)}
    ${row('🔑 Пароль', c.password)}
    <div style="font-size:.73rem;color:var(--muted);margin-top:10px">Нажмите на значение для копирования</div>
  `;
}

// ── Dashboard plan select ──────────────────────────────────────────────────
function selectDashPlan(el, label, price) {
  document.querySelectorAll('.dash-plan').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  const confirm = document.getElementById('dash-plan-confirm');
  document.getElementById('dash-plan-confirm-name').textContent = label;
  document.getElementById('dash-plan-confirm-price').textContent = price + ' · VPN + Прокси';
  confirm.classList.remove('hidden');
}

// ── Referral ───────────────────────────────────────────────────────────────
function copyRefLink() {
  const val = document.getElementById('ref-link-val').textContent;
  copyText(val, document.querySelector('.ref-copy-btn'));
}

// ── Sparkline ─────────────────────────────────────────────────────────────
function drawSparkline(vpn) {
  const canvas = document.getElementById('sparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * devicePixelRatio || 600;
  canvas.height = 60 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = canvas.offsetWidth || 600, H = 60;

  // Generate fake decorative data
  const seed = vpn ? (vpn.traffic_used_gb || 1) : 1;
  const data = Array.from({length:7}, (_,i) => Math.abs(Math.sin(i * seed + i) * 8 + Math.cos(i * 2) * 4 + 5));
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => [i / 6 * W, H - (v / max) * (H - 10) - 5]);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(176,111,255,.35)');
  grad.addColorStop(1, 'rgba(176,111,255,0)');

  ctx.beginPath();
  ctx.moveTo(pts[0][0], H);
  ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i];
    ctx.bezierCurveTo(px + (cx - px) / 2, py, px + (cx - px) / 2, cy, cx, cy);
  }
  ctx.lineTo(pts[pts.length - 1][0], H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i];
    ctx.bezierCurveTo(px + (cx - px) / 2, py, px + (cx - px) / 2, cy, cx, cy);
  }
  ctx.strokeStyle = 'rgba(176,111,255,.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dots
  pts.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#b06fff';
    ctx.fill();
  });

  // Day labels
  const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  ctx.fillStyle = 'rgba(240,238,255,.3)';
  ctx.font = `${10 * devicePixelRatio}px Inter`;
  ctx.scale(1 / devicePixelRatio, 1 / devicePixelRatio);
  days.forEach((d, i) => ctx.fillText(d, pts[i][0] * devicePixelRatio - 6, (H - 2) * devicePixelRatio));
}

// ── Traffic detail ─────────────────────────────────────────────────────────
async function loadTrafficDetail(limit) {
  const el = document.getElementById('traffic-detail');
  if (!el) return;
  el.innerHTML = '<span style="color:var(--muted);font-size:.8rem">⏳ Загружаю...</span>';
  try {
    const res = await fetch(`${API}/traffic`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { el.innerHTML = ''; return; }
    const d = await res.json();
    const lim = d.limit || limit || 50;
    const vpnPct   = Math.min((d.vpn   / lim) * 100, 100);
    const proxyPct = Math.min((d.proxy / lim) * 100, 100);
    const totalPct = Math.min((d.total / lim) * 100, 100);
    el.innerHTML = `
      <div class="traf-row">
        <div class="traf-label"><span class="traf-dot vpn-dot"></span>VPN</div>
        <div class="traf-bar-wrap"><div class="traf-bar vpn-bar" style="width:${vpnPct}%"></div></div>
        <div class="traf-val">${d.vpn.toFixed(2)} ГБ</div>
      </div>
      <div class="traf-row">
        <div class="traf-label"><span class="traf-dot proxy-dot"></span>Прокси</div>
        <div class="traf-bar-wrap"><div class="traf-bar proxy-bar" style="width:${proxyPct}%"></div></div>
        <div class="traf-val">${d.proxy.toFixed(2)} ГБ</div>
      </div>
      <div class="traf-row traf-total">
        <div class="traf-label"><span class="traf-dot total-dot"></span>Итого</div>
        <div class="traf-bar-wrap"><div class="traf-bar total-bar" style="width:${totalPct}%"></div></div>
        <div class="traf-val">${d.total.toFixed(2)} / ${lim} ГБ</div>
      </div>
      <div class="traf-row" style="margin-top:8px;border-top:1px solid rgba(255,255,255,.07);padding-top:8px">
        <div style="flex:1"></div>
      </div>`;
    // обновляем donut тоже
    document.getElementById('donut-pct').textContent = Math.round(totalPct) + '%';
    document.getElementById('donut-used').textContent = d.total.toFixed(2) + ' ГБ';
    setTimeout(() => {
      document.getElementById('donut-fill').style.strokeDashoffset = 188.5 - (188.5 * totalPct / 100);
    }, 100);
  } catch(e) { el.innerHTML = ''; }
}

// ── Copy ───────────────────────────────────────────────────────────────────
function copyText(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.textContent;
    el.textContent = '✅ Скопировано!';
    setTimeout(() => el.textContent = orig, 1500);
    showToast('Скопировано!', 'success');
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── Auto-refresh traffic every 30s ────────────────────────────────────────
let _trafficTimer = null;
function startTrafficAutoRefresh(limit) {
  if (_trafficTimer) clearInterval(_trafficTimer);
  _trafficTimer = setInterval(() => loadTrafficDetail(limit), 30000);
}
function stopTrafficAutoRefresh() {
  if (_trafficTimer) { clearInterval(_trafficTimer); _trafficTimer = null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// KomoGPT
// ══════════════════════════════════════════════════════════════════════════════

let gptCurrentModel = 'gpt-5-nano';
let gptAllModels = [];
let gptSending = false;
let gptLastUserMsg = '';

async function loadGPT() {
  await Promise.all([loadGPTModels(), loadGPTHistory()]);
  updateCharCounter();
}

async function loadGPTModels() {
  try {
    const r = await fetch('/api/gpt/models', {headers: {'Authorization': 'Bearer ' + token}});
    if (!r.ok) {
      if (r.status === 403) {
        document.getElementById('gpt-model-chips').innerHTML =
          '<div class="gpt-model-loading">❌ Нет активной подписки. <a href="https://t.me/KomoVpn_bot" target="_blank" style="color:#b06fff">Оформить →</a></div>';
      }
      return;
    }
    const data = await r.json();
    gptAllModels = data.models;
    const sess = await fetch('/api/gpt/session', {headers: {'Authorization': 'Bearer ' + token}}).then(x => x.json()).catch(() => ({}));
    gptCurrentModel = sess.model || 'gpt-5-nano';
    renderGPTModels(data.models);
  } catch(e) {}
}

function renderGPTModels(models) {
  const wrap = document.getElementById('gpt-model-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  models.forEach(m => {
    const chip = document.createElement('div');
    chip.className = 'gpt-model-chip' + (m.id === gptCurrentModel ? ' active' : '') + (!m.available ? ' locked' : '');
    chip.setAttribute('data-id', m.id);
    chip.setAttribute('title', m.desc + (!m.available ? ` · Доступно с тарифа ${m.tier_label}` : ''));
    chip.innerHTML = m.available
      ? `${m.name}<span class="chip-desc">${m.desc}</span>`
      : `🔒 ${m.name}<span class="chip-tier">${m.tier_label}</span>`;
    if (m.available) chip.onclick = () => gptSelectModel(m.id);
    wrap.appendChild(chip);
  });
}

async function gptSelectModel(modelId) {
  gptCurrentModel = modelId;
  document.querySelectorAll('.gpt-model-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-id') === modelId);
  });
  await fetch('/api/gpt/session', {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: modelId})
  });
  const m = gptAllModels.find(x => x.id === modelId);
  if (m) showToast(`Модель: ${m.name}`, 'success');
  await loadGPTHistory();
}

async function loadGPTHistory() {
  try {
    const r = await fetch('/api/gpt/history', {headers: {'Authorization': 'Bearer ' + token}});
    if (!r.ok) return;
    const data = await r.json();
    gptCurrentModel = data.model;
    const msgs = document.getElementById('gpt-messages');
    if (!msgs) return;
    if (!data.history.length) {
      msgs.innerHTML = `<div class="gpt-welcome">
        <div class="gpt-welcome-icon">🤖</div>
        <div class="gpt-welcome-title">KomoGPT</div>
        <div class="gpt-welcome-text">Выбери модель выше и напиши сообщение.<br>Поддерживаю markdown, код, таблицы.</div>
      </div>`;
      return;
    }
    msgs.innerHTML = '';
    data.history.forEach(m => appendGPTMessage(m.role, m.content));
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e) {}
}

function renderMarkdown(text) {
  // Code blocks
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const id = 'cb_' + Math.random().toString(36).slice(2,8);
    return `<div class="code-block">
      <div class="code-header">
        <span class="code-lang">${lang || 'code'}</span>
        <button class="code-copy-btn" onclick="copyCode('${id}')">📋 Копировать</button>
      </div>
      <pre><code id="${id}" class="language-${lang || 'plaintext'}">${escaped}</code></pre>
    </div>`;
  });
  // Tables — парсим до inline замен
  html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_, header, rows) => {
    const ths = header.split('|').map(c=>c.trim()).filter(Boolean)
      .map(c=>`<th>${c}</th>`).join('');
    const trs = rows.trim().split('\n').map(row => {
      const tds = row.split('|').map(c=>c.trim()).filter(Boolean)
        .map(c=>`<td>${c}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  });
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  // Bold, italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  // Lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, s => `<ul class="md-ul">${s}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // HR
  html = html.replace(/^---$/gm, '<hr class="md-hr">');
  // Newlines
  html = html.replace(/\n\n/g, '</p><p class="md-p">');
  html = html.replace(/\n/g, '<br>');
  return `<p class="md-p">${html}</p>`;
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.closest('.code-block')?.querySelector('.code-copy-btn');
    if (btn) { const o = btn.textContent; btn.textContent = '✅ Скопировано'; setTimeout(() => btn.textContent = o, 1500); }
    showToast('Код скопирован!', 'success');
  });
}

function appendGPTMessage(role, content, modelName, withActions = false) {
  const msgs = document.getElementById('gpt-messages');
  if (!msgs) return;
  msgs.querySelector('.gpt-welcome')?.remove();

  const div = document.createElement('div');
  div.className = `gpt-msg ${role}`;
  const avatar = role === 'user' ? '👤' : '🤖';
  const html = role === 'assistant' ? renderMarkdown(content) : `<p class="md-p">${content.replace(/\n/g,'<br>')}</p>`;

  div.innerHTML = `
    <div class="gpt-msg-avatar">${avatar}</div>
    <div class="gpt-msg-body">
      <div class="gpt-msg-bubble">${html}</div>
      ${modelName ? `<div class="gpt-msg-model">— ${modelName}</div>` : ''}
      ${withActions && role === 'assistant' ? `
        <div class="gpt-msg-actions">
          <button class="gpt-action-btn" onclick="gptRegenerate()">🔄 Повторить</button>
          <button class="gpt-action-btn" onclick="gptCopyLast(this)">📋 Копировать</button>
        </div>` : ''}
    </div>`;
  msgs.appendChild(div);

  // Highlight code blocks
  div.querySelectorAll('pre code').forEach(el => {
    if (window.hljs) hljs.highlightElement(el);
  });

  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function appendGPTThinking() {
  const msgs = document.getElementById('gpt-messages');
  msgs.querySelector('.gpt-welcome')?.remove();
  const div = document.createElement('div');
  div.className = 'gpt-msg assistant';
  div.id = 'gpt-thinking';
  div.innerHTML = '<div class="gpt-msg-avatar">🤖</div><div class="gpt-thinking"><span></span><span></span><span></span></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

async function gptSend() {
  if (gptSending) return;
  const input = document.getElementById('gpt-input');
  const msg = input.value.trim();
  if (!msg) return;

  gptSending = true;
  gptLastUserMsg = msg;
  document.getElementById('gpt-send-btn').disabled = true;
  input.value = '';
  input.style.height = 'auto';
  updateCharCounter();

  appendGPTMessage('user', msg);
  const thinking = appendGPTThinking();

  try {
    const r = await fetch('/api/gpt/chat', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({message: msg})
    });
    thinking.remove();
    if (!r.ok) {
      const err = await r.json().catch(() => ({detail: 'Ошибка'}));
      if (r.status === 403) {
        appendGPTMessage('assistant', '❌ Нет активной подписки. Оформите в @KomoVpn_bot');
      } else {
        appendGPTMessage('assistant', '❌ ' + (err.detail || 'Ошибка сервера'));
      }
    } else {
      const data = await r.json();
      const m = gptAllModels.find(x => x.id === data.model);
      appendGPTMessage('assistant', data.answer, m?.name, true);
    }
  } catch(e) {
    thinking.remove();
    appendGPTMessage('assistant', '❌ Ошибка соединения. Проверьте интернет.');
  }

  gptSending = false;
  document.getElementById('gpt-send-btn').disabled = false;
  input.focus();
}

async function gptRegenerate() {
  if (gptSending || !gptLastUserMsg) return;
  // Удаляем последний ответ из UI
  const msgs = document.getElementById('gpt-messages');
  const allMsgs = msgs.querySelectorAll('.gpt-msg');
  if (allMsgs.length >= 1) allMsgs[allMsgs.length - 1].remove();

  gptSending = true;
  document.getElementById('gpt-send-btn').disabled = true;
  const thinking = appendGPTThinking();

  try {
    // Удаляем последние 2 сообщения из истории на сервере и переспрашиваем
    await fetch('/api/gpt/history/last', {method: 'DELETE', headers: {'Authorization': 'Bearer ' + token}});
    const r = await fetch('/api/gpt/chat', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({message: gptLastUserMsg})
    });
    thinking.remove();
    if (r.ok) {
      const data = await r.json();
      const m = gptAllModels.find(x => x.id === data.model);
      appendGPTMessage('assistant', data.answer, m?.name, true);
      showToast('Ответ обновлён', 'success');
    }
  } catch(e) {
    thinking.remove();
  }
  gptSending = false;
  document.getElementById('gpt-send-btn').disabled = false;
}

function gptCopyLast(btn) {
  const bubble = btn.closest('.gpt-msg-body')?.querySelector('.gpt-msg-bubble');
  if (!bubble) return;
  navigator.clipboard.writeText(bubble.innerText).then(() => {
    const o = btn.textContent; btn.textContent = '✅ Скопировано';
    setTimeout(() => btn.textContent = o, 1500);
    showToast('Скопировано!', 'success');
  });
}

function gptKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gptSend(); }
}

function gptAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  updateCharCounter();
}

function updateCharCounter() {
  const input = document.getElementById('gpt-input');
  const counter = document.getElementById('gpt-char-counter');
  if (!input || !counter) return;
  const len = input.value.length;
  counter.textContent = len > 0 ? `${len} симв.` : '';
  counter.style.color = len > 3000 ? '#ff5050' : 'var(--muted)';
}

async function gptClearHistory() {
  await fetch('/api/gpt/history', {method: 'DELETE', headers: {'Authorization': 'Bearer ' + token}});
  const msgs = document.getElementById('gpt-messages');
  if (msgs) msgs.innerHTML = `<div class="gpt-welcome">
    <div class="gpt-welcome-icon">🤖</div>
    <div class="gpt-welcome-title">Новый чат</div>
    <div class="gpt-welcome-text">История очищена. Начни новый диалог!</div>
  </div>`;
  gptLastUserMsg = '';
  showToast('История очищена', 'info');
}

// GPT search
function gptSearch() {
  const q = document.getElementById('gpt-search-input')?.value.toLowerCase();
  if (!q) { loadGPTHistory(); return; }
  document.querySelectorAll('.gpt-msg').forEach(m => {
    const text = m.querySelector('.gpt-msg-bubble')?.innerText.toLowerCase() || '';
    m.style.display = text.includes(q) ? '' : 'none';
  });
}

// GPT export
async function gptExport() {
  try {
    const r = await fetch('/api/gpt/history', {headers: {'Authorization': 'Bearer ' + token}});
    if (!r.ok) return;
    const data = await r.json();
    if (!data.history.length) { showToast('История пуста', 'info'); return; }
    const m = gptAllModels.find(x => x.id === data.model);
    let md = `# KomoGPT — История чата\n**Модель:** ${m?.name || data.model}\n\n---\n\n`;
    data.history.forEach(h => {
      md += h.role === 'user' ? `**Вы:**\n${h.content}\n\n` : `**🤖 ${m?.name || 'AI'}:**\n${h.content}\n\n---\n\n`;
    });
    const blob = new Blob([md], {type: 'text/markdown'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `komogpt_${data.model}_${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    showToast('Экспорт готов!', 'success');
  } catch(e) { showToast('Ошибка экспорта', 'error'); }
}

