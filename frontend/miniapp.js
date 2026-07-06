// ─── Init ────────────────────────────────────────────────────────────────────
const tg = window.Telegram.WebApp;
tg.ready(); tg.expand();
tg.setHeaderColor('#06040e');
tg.setBackgroundColor('#06040e');

const API = '/api';
let appData = null, loaded = {};
let aiModels = [], currentAIModel = 'gpt-5-nano';
let aiTyping = false;

// ─── Toast уведомления ────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 2500) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, duration);
}

// ─── Навигация ────────────────────────────────────────────────────────────────
function goTab(n) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(x => x.classList.remove('active'));
  document.getElementById('s-' + n).classList.add('active');
  const ni = document.getElementById('nav-' + n);
  if (ni) ni.classList.add('active');
  document.getElementById('app').scrollTop = 0;
  tg.HapticFeedback?.selectionChanged();
  if (!loaded[n]) { loaded[n] = true; loadTab(n); }
}

function loadTab(n) {
  if (n === 'vpn') loadVPN();
  else if (n === 'proxy') loadProxy();
  else if (n === 'sub') loadSub();
  else if (n === 'plans') loadPlans();
  else if (n === 'ai') loadAI();
  else if (n === 'server') loadServer();
  else if (n === 'ref') loadRef();
  else if (n === 'payments') loadPayments();
  else if (n === 'settings') loadSettings();
}

// ─── Auth & Init ──────────────────────────────────────────────────────────────
async function init() {
  if (!tg.initData) {
    document.getElementById('status-card').innerHTML = `
      <div style="text-align:center;padding:20px 12px">
        <div style="font-size:3rem;margin-bottom:12px">📱</div>
        <div style="font-weight:800;margin-bottom:6px">Откройте через Telegram</div>
        <div style="color:var(--muted);font-size:.82rem;margin-bottom:16px;line-height:1.5">Mini App работает только внутри Telegram</div>
        <a href="https://t.me/KomoVpn_bot" class="btn btn-tg" style="display:inline-flex">Открыть бот</a>
      </div>`;
    return;
  }
  const res = await fetch(`${API}/miniapp/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData })
  }).catch(() => null);
  if (!res?.ok) {
    const e = await res?.json().catch(() => ({}));
    document.getElementById('status-card').innerHTML = `<div class="loading">❌ ${e?.detail || 'Ошибка авторизации'}</div>`;
    return;
  }
  appData = await res.json();
  sessionStorage.setItem('ma_token', appData.token);

  const u = appData.user;
  document.getElementById('user-avatar').textContent = (u.first_name || '?')[0].toUpperCase();
  document.getElementById('home-name').textContent = u.first_name + (u.last_name ? ' ' + u.last_name : '');
  document.getElementById('home-sub').textContent = u.username ? '@' + u.username : 'ID: ' + u.id;

  renderStatus(appData);
  document.getElementById('quick-card').classList.remove('hidden');
  document.getElementById('features-card').classList.remove('hidden');

  if (appData.vpn_active) fetchTrafficDetail();

  // Показываем кнопку MTProto
  document.getElementById('mtproto-btn').style.display = 'flex';

  // Проверяем истечение подписки
  if (appData.paid_until) {
    const diff = Math.ceil((new Date(appData.paid_until) - new Date()) / 86400000);
    if (diff >= 0 && diff <= 3) {
      setTimeout(() => toast(`⚠️ Подписка истекает через ${diff} дн.`, 'warn', 4000), 1500);
    }
  }
}

// ─── Трафик ───────────────────────────────────────────────────────────────────
async function fetchTrafficDetail() {
  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/traffic`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return;
  const d = await res.json();
  renderTrafficBars(d.vpn || 0, d.proxy || 0, d.total || 0, d.limit || 50);
}

function renderStatus(data) {
  const on = data.vpn_active;
  const paid = data.paid_until;
  let daysLeft = '';
  if (paid) {
    const diff = Math.ceil((new Date(paid) - new Date()) / 86400000);
    if (diff < 0) daysLeft = '<span style="color:var(--r);font-size:.75rem">истекла</span>';
    else if (diff <= 3) daysLeft = `<span style="color:var(--o);font-size:.75rem">⚠️ ${diff} дн.</span>`;
    else daysLeft = `<span style="color:var(--muted);font-size:.75rem">${diff} дн.</span>`;
  }
  document.getElementById('status-card').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-weight:800;font-size:.95rem">Подписка</div>
      <span class="badge ${on ? 'on' : 'off'}">${on ? '✅ Активна' : '❌ Не активна'}</span>
    </div>
    ${paid ? `<div class="sr" style="padding:5px 0;border:none">
      <span style="color:var(--muted);font-size:.8rem">Действует до</span>
      <div style="text-align:right"><div style="font-weight:700;font-size:.86rem">${paid}</div>${daysLeft}</div>
    </div>` : ''}
    <div id="traf-detail" style="margin-top:${paid ? '12' : '0'}px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:.72rem;font-weight:700;color:var(--muted);letter-spacing:.5px;text-transform:uppercase">Трафик</span>
        <button onclick="refreshTraffic()" style="background:none;border:none;color:var(--muted);font-size:.72rem;cursor:pointer;padding:2px 6px;border-radius:6px;font-family:inherit">🔄 обновить</button>
      </div>
      <div id="traf-bars"><div style="color:var(--muted);font-size:.78rem">⏳ загрузка...</div></div>
    </div>
    ${on ? `
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="goTab('payments')">📋 Платежи</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="goTab('ref')">👥 Рефералы</button>
    </div>` : `<button class="btn btn-g mt" onclick="goTab('plans')">💳 Выбрать тариф</button>`}`;
}

function renderTrafficBars(vpn, proxy, total, limit) {
  const vPct = Math.min((vpn / limit) * 100, 100);
  const pPct = Math.min((proxy / limit) * 100, 100);
  const tPct = Math.min((total / limit) * 100, 100);
  const warn = tPct > 80 ? ' style="color:var(--o)"' : tPct > 95 ? ' style="color:var(--r)"' : '';
  document.getElementById('traf-bars').innerHTML = `
    <div class="traf-row">
      <div class="traf-meta"><span class="traf-name">🔒 VPN</span><span class="traf-val" style="color:var(--p)">${vpn.toFixed(2)} ГБ</span></div>
      <div class="bar-track"><div class="bar-fill bf-vpn" style="width:${vPct}%"></div></div>
    </div>
    <div class="traf-row">
      <div class="traf-meta"><span class="traf-name">🌍 Прокси</span><span class="traf-val" style="color:var(--b)">${proxy.toFixed(2)} ГБ</span></div>
      <div class="bar-track"><div class="bar-fill bf-proxy" style="width:${pPct}%"></div></div>
    </div>
    <div class="traf-row" style="margin-bottom:0">
      <div class="traf-meta"><span class="traf-name" style="font-weight:700;color:var(--text)">Итого</span><span class="traf-val"${warn}>${total.toFixed(2)} / ${limit} ГБ</span></div>
      <div class="bar-track" style="height:7px"><div class="bar-fill bf-total" style="width:${tPct}%"></div></div>
    </div>
    <div class="traf-row" style="margin-top:8px;border-top:1px solid rgba(255,255,255,.07);padding-top:8px;margin-bottom:0">
    </div>`;
}

async function refreshTraffic() {
  tg.HapticFeedback?.impactOccurred('light');
  await fetchTrafficDetail();
  tg.HapticFeedback?.notificationOccurred('success');
  toast('✅ Трафик обновлён');
}

// ─── VPN ──────────────────────────────────────────────────────────────────────
async function loadVPN() {
  const el = document.getElementById('vpn-content');
  if (!appData?.vpn_active) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:28px 16px">
      <div style="font-size:3rem;margin-bottom:12px">🔒</div>
      <div style="font-weight:800;margin-bottom:8px">Подписка не активна</div>
      <div style="color:var(--muted);font-size:.82rem;margin-bottom:18px;line-height:1.5">Оплатите подписку чтобы получить доступ к VPN</div>
      <button class="btn btn-g" onclick="goTab('plans')">💳 Выбрать тариф</button>
      <a href="https://t.me/KomoVpn_bot" class="btn btn-tg mt">Оплатить в боте</a>
    </div>`; return;
  }
  el.innerHTML = '<div class="loading">⏳</div>';
  const token = sessionStorage.getItem('ma_token');
  const [vRes, sRes] = await Promise.all([
    fetch(`${API}/config/vpn`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
    fetch(`${API}/config/sub`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
  ]);
  if (!vRes?.ok) { el.innerHTML = '<div class="loading">❌ Ошибка загрузки</div>'; return; }
  const { link } = await vRes.json();
  const sub = sRes?.ok ? await sRes.json() : null;
  const linkEsc = link.replace(/'/g, "\\'");
  const subEsc = sub?.url?.replace(/'/g, "\\'") || '';
  el.innerHTML = `
    <div class="card card-glow">
      <div class="ct">Основной конфиг</div>
      <div class="cfg" onclick="copy('${linkEsc}',this)">
        <span class="cfg-copy">нажмите для копирования</span>
        ${link}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="showQR('${linkEsc}','VLESS конфиг')">📷 QR-код</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="shareConfig('${linkEsc}')">📤 Поделиться</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;margin-top:8px">
        <span class="app-chip">⭐ Happ</span>
        <span class="app-chip">📱 v2rayNG</span>
        <span class="app-chip">🍎 Streisand</span>
        <span class="app-chip">💻 Hiddify</span>
      </div>
    </div>
    ${sub ? `<div class="card">
      <div class="ct">Ссылка на подписку (3 конфига)</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px;line-height:1.5">Вставьте один раз — конфиги обновляются автоматически</div>
      <div class="sub-url" onclick="copy('${subEsc}',this)">${sub.url}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="showQR('${subEsc}','Ссылка подписки')">📷 QR</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="shareConfig('${subEsc}')">📤 Поделиться</button>
      </div>
    </div>` : ''}
    <div class="card card-sm">
      <div class="ct">Как подключиться</div>
      <div class="ir"><div class="ii">⭐</div><div><div style="font-weight:600">Happ (Android/iOS/Win/Mac)</div><div class="it">➕ → Import from URL → Connect</div></div></div>
      <div class="ir"><div class="ii">📱</div><div><div style="font-weight:600">Android — v2rayNG</div><div class="it">➕ → Импорт из буфера обмена</div></div></div>
      <div class="ir"><div class="ii">🍎</div><div><div style="font-weight:600">iOS — Streisand</div><div class="it">➕ → Import from clipboard → Connect</div></div></div>
    </div>`;
}

// ─── Proxy ────────────────────────────────────────────────────────────────────
async function loadProxy() {
  const el = document.getElementById('proxy-content');
  if (!appData?.vpn_active) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:28px 16px">
      <div style="font-size:3rem;margin-bottom:12px">🌍</div>
      <div style="font-weight:800;margin-bottom:8px">Подписка не активна</div>
      <button class="btn btn-g mt" onclick="goTab('plans')">💳 Выбрать тариф</button>
    </div>`; return;
  }
  el.innerHTML = '<div class="loading">⏳</div>';
  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/config/proxy`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) { el.innerHTML = '<div class="loading">❌ Ошибка загрузки</div>'; return; }
  const c = await res.json();
  const tgS = `tg://proxy?server=${c.host}&port=${c.socks5_port}&user=${c.login}&pass=${c.password}&type=socks5`;
  const tgH = `tg://proxy?server=${c.host}&port=${c.http_port}&user=${c.login}&pass=${c.password}&type=http`;
  el.innerHTML = `
    <div class="card">
      <div class="ct">Данные прокси — нажмите для копирования</div>
      <div class="sr"><span style="color:var(--muted)">🖥 Хост</span><span class="sv" onclick="copy('${c.host}',this)">${c.host}</span></div>
      <div class="sr"><span style="color:var(--muted)">👤 Логин</span><span class="sv" onclick="copy('${c.login}',this)">${c.login}</span></div>
      <div class="sr"><span style="color:var(--muted)">🔑 Пароль</span><span class="sv" onclick="copy('${c.password}',this)">${c.password}</span></div>
      <div class="sr"><span style="color:var(--muted)">🔌 SOCKS5</span><span class="sv" onclick="copy('${c.socks5_port}',this)">${c.socks5_port}</span></div>
      <div class="sr"><span style="color:var(--muted)">🔌 HTTP</span><span class="sv" onclick="copy('${c.http_port}',this)">${c.http_port}</span></div>
      <button class="btn btn-ghost btn-sm mt" onclick="copyAllProxy('${c.host}','${c.login}','${c.password}','${c.socks5_port}')">📋 Скопировать всё</button>
    </div>
    <div class="card card-sm">
      <div class="ct">Подключить в Telegram</div>
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:10px">Нажмите кнопку — Telegram предложит подключиться</div>
      <div class="row">
        <a href="${tgS}" class="btn btn-g" style="text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center">SOCKS5</a>
        <a href="${tgH}" class="btn btn-b" style="text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center">HTTP</a>
      </div>
    </div>`;
}

function copyAllProxy(host, login, pass, port) {
  const text = `Host: ${host}\nLogin: ${login}\nPassword: ${pass}\nSOCKS5 port: ${port}`;
  navigator.clipboard.writeText(text).then(() => toast('📋 Все данные скопированы'));
}

// ─── Sub ──────────────────────────────────────────────────────────────────────
async function loadSub() {
  const el = document.getElementById('sub-content');
  if (!appData?.vpn_active) {
    el.innerHTML = `<div class="card" style="text-align:center;padding:28px 16px">
      <div style="font-size:3rem;margin-bottom:12px">🔗</div>
      <div style="font-weight:800;margin-bottom:8px">Подписка не активна</div>
      <button class="btn btn-g mt" onclick="goTab('plans')">💳 Выбрать тариф</button>
    </div>`; return;
  }
  el.innerHTML = '<div class="loading">⏳</div>';
  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/config/sub`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) { el.innerHTML = '<div class="loading">❌ Ошибка загрузки</div>'; return; }
  const { url } = await res.json();
  const urlEsc = url.replace(/'/g, "\\'");
  el.innerHTML = `
    <div class="card card-glow">
      <div class="ct">Ваша ссылка на подписку</div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:10px;line-height:1.5">
        Вставьте эту ссылку в приложение <b style="color:var(--text)">один раз</b> — 
        все 3 конфига загрузятся и будут обновляться автоматически
      </div>
      <div class="sub-url" onclick="copy('${urlEsc}',this)">${url}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="showQR('${urlEsc}','Ссылка подписки')">📷 QR-код</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="shareConfig('${urlEsc}')">📤 Поделиться</button>
      </div>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap">
        <span class="app-chip">⭐ Happ</span>
        <span class="app-chip">📱 v2rayNG</span>
        <span class="app-chip">💻 Hiddify</span>
        <span class="app-chip">🍎 Streisand</span>
      </div>
    </div>
    <div class="card card-sm">
      <div class="ct">Как использовать</div>
      <div class="ir"><div class="ii">⭐</div><div><div style="font-weight:600">Happ (Android/iOS/Win/Mac)</div><div class="it">➕ → Import from URL → вставьте</div></div></div>
      <div class="ir"><div class="ii">📱</div><div><div style="font-weight:600">v2rayNG (Android)</div><div class="it">➕ → Импорт из URL подписки → вставьте</div></div></div>
      <div class="ir"><div class="ii">💻</div><div><div style="font-weight:600">Hiddify (Win / Mac)</div><div class="it">➕ → Add profile from URL → вставьте</div></div></div>
      <div class="ir"><div class="ii">📦</div><div><div style="font-weight:600">NekoBox</div><div class="it">Группы → ➕ → вставьте ссылку</div></div></div>
      <div class="ir"><div class="ii">🍎</div><div><div style="font-weight:600">Streisand (iOS)</div><div class="it">➕ → Import from URL → вставьте</div></div></div>
    </div>
    <div style="font-size:.72rem;color:var(--muted);text-align:center;padding:4px 0">⚠️ Ссылка персональная — не передавайте её другим</div>`;
}

// ─── Plans ────────────────────────────────────────────────────────────────────
async function loadPlans() {
  const el = document.getElementById('plans-content');
  const res = await fetch(`${API}/plans`).catch(() => null);
  if (!res?.ok) { el.innerHTML = '<div class="loading">❌ Ошибка</div>'; return; }
  const { plans } = await res.json();
  const cards = plans.map((p, i) => `
    <div class="pc ${i === 1 ? 'hot' : ''}">
      <div class="pc-left">
        ${i === 1 ? '<div class="pc-tag">⭐ Популярный</div>' : ''}
        <div class="pc-name">${p.label}</div>
        <div class="pc-info">${p.traffic_gb} ГБ всего${p.discount ? ` · <span class="pc-disc">−${p.discount}%</span>` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="pc-price">${p.price}₽</div>
        <div class="pc-mo">${Math.round(p.price / parseInt(p.label))}₽/мес</div>
      </div>
    </div>`).join('');

  // Промокод
  const promoSection = `
    <div class="card card-sm" style="margin-top:4px">
      <div class="ct">Промокод</div>
      <div style="display:flex;gap:8px">
        <input id="promo-input" type="text" placeholder="Введите промокод" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border-b);border-radius:10px;padding:10px 12px;color:var(--text);font-family:'Fira Code',monospace;font-size:.82rem;outline:none">
        <button class="btn btn-ghost btn-sm" style="width:auto;padding:10px 14px;margin:0" onclick="applyPromo()">Применить</button>
      </div>
      <div id="promo-result" style="font-size:.75rem;margin-top:6px"></div>
    </div>`;

  el.innerHTML = `
    <div class="card card-sm" style="margin-bottom:14px">
      <div class="ir" style="padding:4px 0;border:none">
        <div class="ii">🎁</div>
        <div><div style="font-weight:700">Пробный период — бесплатно</div><div class="it">7 дней · 10 ГБ · без карты</div></div>
      </div>
    </div>
    ${cards}
    ${promoSection}
    <a href="https://t.me/KomoVpn_bot" class="btn btn-tg mt">💳 Оплатить в боте</a>
    <div style="margin-top:10px;font-size:.72rem;color:var(--muted);text-align:center">VPN + Прокси · 🇫🇮 Финляндия · без логов</div>`;
}

async function applyPromo() {
  const code = document.getElementById('promo-input').value.trim();
  const res = document.getElementById('promo-result');
  if (!code) return;
  const token = sessionStorage.getItem('ma_token');
  const r = await fetch(`${API}/promo/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code })
  }).catch(() => null);
  if (!r) { res.innerHTML = '<span style="color:var(--r)">❌ Ошибка сети</span>'; return; }
  const d = await r.json().catch(() => ({}));
  if (r.ok) {
    res.innerHTML = `<span style="color:var(--mint)">✅ ${d.message || 'Промокод применён!'}</span>`;
    tg.HapticFeedback?.notificationOccurred('success');
    toast('🎉 Промокод применён!', 'success');
  } else {
    res.innerHTML = `<span style="color:var(--r)">❌ ${d.detail || 'Неверный промокод'}</span>`;
  }
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────
async function loadAI() {
  const content = document.getElementById('ai-content');
  const msgArea = document.getElementById('ai-messages');
  const inputArea = document.getElementById('ai-input-area');
  const modelBar = document.getElementById('ai-model-bar');
  const clearBtn = document.getElementById('ai-clear-btn');

  if (!appData?.vpn_active) {
    content.innerHTML = `<div class="card" style="text-align:center;padding:28px 16px">
      <div style="font-size:3rem;margin-bottom:12px">🤖</div>
      <div style="font-weight:800;margin-bottom:8px">AI Чат — только для подписчиков</div>
      <div style="color:var(--muted);font-size:.82rem;margin-bottom:18px;line-height:1.5">Оформите подписку для доступа к GPT-4, Claude и другим моделям</div>
      <button class="btn btn-g" onclick="goTab('plans')">💳 Выбрать тариф</button>
    </div>`;
    return;
  }

  content.innerHTML = '';
  inputArea.classList.remove('hidden');
  modelBar.classList.remove('hidden');
  clearBtn.style.display = 'flex';

  const token = sessionStorage.getItem('ma_token');

  // Загружаем модели и историю параллельно
  const [modelsRes, histRes, sessionRes] = await Promise.all([
    fetch(`${API}/gpt/models`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
    fetch(`${API}/gpt/history`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
    fetch(`${API}/gpt/session`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
  ]);

  if (modelsRes?.ok) {
    const d = await modelsRes.json();
    aiModels = d.models || [];
  }
  if (sessionRes?.ok) {
    const s = await sessionRes.json();
    currentAIModel = s.model || 'gpt-5-nano';
    const m = aiModels.find(x => x.id === currentAIModel);
    document.getElementById('ai-model-name').textContent = m?.name || currentAIModel;
  }

  if (histRes?.ok) {
    const h = await histRes.json();
    const msgs = h.history || [];
    if (msgs.length === 0) {
      msgArea.innerHTML = `<div class="ai-welcome">
        <div style="font-size:2.5rem;margin-bottom:12px">🤖</div>
        <div style="font-weight:700;margin-bottom:6px">AI Ассистент</div>
        <div style="color:var(--muted);font-size:.8rem;line-height:1.6">Задайте любой вопрос. Поддерживает код, анализ, переводы и многое другое.</div>
      </div>`;
    } else {
      msgArea.innerHTML = msgs.map(m => renderAIMsg(m.role, m.content)).join('');
      msgArea.scrollTop = msgArea.scrollHeight;
    }
  }
}

function renderAIMsg(role, content) {
  const isUser = role === 'user';
  let html = content;
  // Tables
  html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_, header, rows) => {
    const ths = header.split('|').map(c=>c.trim()).filter(Boolean).map(c=>`<th>${c}</th>`).join('');
    const trs = rows.trim().split('\n').map(row => {
      const tds = row.split('|').map(c=>c.trim()).filter(Boolean).map(c=>`<td>${c}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  });
  html = html
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:1rem">$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul style="padding-left:16px;margin:4px 0">${s}</ul>`)
    .replace(/\n/g, '<br>');
  return `<div class="ai-msg ${isUser ? 'ai-user' : 'ai-bot'}">
    ${!isUser ? '<div class="ai-avatar">🤖</div>' : ''}
    <div class="ai-bubble">${html}</div>
    ${isUser ? '<div class="ai-avatar ai-avatar-user">👤</div>' : ''}
  </div>`;
}

async function sendAI() {
  if (aiTyping) return;
  const input = document.getElementById('ai-input');
  const msg = input.value.trim();
  if (!msg) return;

  const msgArea = document.getElementById('ai-messages');
  // Убираем welcome если есть
  const welcome = msgArea.querySelector('.ai-welcome');
  if (welcome) welcome.remove();

  input.value = '';
  input.style.height = 'auto';
  tg.HapticFeedback?.impactOccurred('light');

  // Добавляем сообщение пользователя
  msgArea.insertAdjacentHTML('beforeend', renderAIMsg('user', msg));

  // Индикатор печати
  const typingId = 'typing-' + Date.now();
  msgArea.insertAdjacentHTML('beforeend', `<div id="${typingId}" class="ai-msg ai-bot">
    <div class="ai-avatar">🤖</div>
    <div class="ai-bubble ai-typing"><span></span><span></span><span></span></div>
  </div>`);
  msgArea.scrollTop = msgArea.scrollHeight;
  aiTyping = true;
  document.getElementById('ai-send-btn').disabled = true;

  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/gpt/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: msg })
  }).catch(() => null);

  document.getElementById(typingId)?.remove();
  aiTyping = false;
  document.getElementById('ai-send-btn').disabled = false;

  if (!res?.ok) {
    const e = await res?.json().catch(() => ({}));
    msgArea.insertAdjacentHTML('beforeend', renderAIMsg('assistant', `❌ ${e?.detail || 'Ошибка запроса'}`));
  } else {
    const d = await res.json();
    msgArea.insertAdjacentHTML('beforeend', renderAIMsg('assistant', d.answer));
    tg.HapticFeedback?.notificationOccurred('success');
  }
  msgArea.scrollTop = msgArea.scrollHeight;
}

function aiKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function clearAIChat() {
  tg.showConfirm('Очистить историю чата?', async (ok) => {
    if (!ok) return;
    const token = sessionStorage.getItem('ma_token');
    await fetch(`${API}/gpt/history`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    document.getElementById('ai-messages').innerHTML = `<div class="ai-welcome">
      <div style="font-size:2.5rem;margin-bottom:12px">🤖</div>
      <div style="font-weight:700;margin-bottom:6px">Чат очищен</div>
      <div style="color:var(--muted);font-size:.8rem">Начните новый диалог</div>
    </div>`;
    toast('🗑 История очищена');
  });
}

function openModelPicker() {
  const list = document.getElementById('model-list');
  list.innerHTML = aiModels.map(m => `
    <div class="model-item ${m.id === currentAIModel ? 'active' : ''} ${!m.available ? 'locked' : ''}"
         onclick="${m.available ? `selectModel('${m.id}')` : 'void(0)'}">
      <div>
        <div style="font-weight:600;font-size:.88rem">${m.name}</div>
        <div style="font-size:.72rem;color:var(--muted)">${m.desc}</div>
      </div>
      <div style="font-size:.7rem;color:${m.available ? 'var(--mint)' : 'var(--muted)'}">
        ${m.id === currentAIModel ? '✅' : m.available ? '✓' : '🔒'}
      </div>
    </div>`).join('');
  document.getElementById('model-modal').classList.remove('hidden');
}

function closeModelPicker() {
  document.getElementById('model-modal').classList.add('hidden');
}

async function selectModel(id) {
  const token = sessionStorage.getItem('ma_token');
  await fetch(`${API}/gpt/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: id })
  });
  currentAIModel = id;
  const m = aiModels.find(x => x.id === id);
  document.getElementById('ai-model-name').textContent = m?.name || id;
  closeModelPicker();
  // Перезагружаем историю для новой модели
  loaded['ai'] = false;
  loadAI();
  toast(`🤖 Модель: ${m?.name || id}`);
}

// ─── Server Status ────────────────────────────────────────────────────────────
async function loadServer(force = false) {
  if (force) loaded['server'] = true;
  const el = document.getElementById('server-content');
  el.innerHTML = '<div class="loading">⏳ Проверяю сервер...</div>';
  const res = await fetch(`${API}/status`).catch(() => null);
  if (!res?.ok) { el.innerHTML = '<div class="loading">❌ Недоступно</div>'; return; }
  const d = await res.json();

  function svcBadge(ok) {
    return ok
      ? '<span class="badge on" style="font-size:.65rem;padding:3px 8px">● online</span>'
      : '<span class="badge off" style="font-size:.65rem;padding:3px 8px">● offline</span>';
  }
  function metricBar(val, warn = 70, crit = 90) {
    const color = val >= crit ? 'var(--r)' : val >= warn ? 'var(--o)' : 'var(--mint)';
    return `<div class="bar-track" style="height:4px;margin-top:4px"><div class="bar-fill" style="width:${val}%;background:${color}"></div></div>`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="ct">Сервисы</div>
      <div class="sr"><span>🔒 Xray VPN</span>${svcBadge(d.xray)}</div>
      <div class="sr"><span>🤖 VPN Bot</span>${svcBadge(d['vpn-bot'])}</div>
      <div class="sr"><span>🌐 API</span>${svcBadge(d['vpn-api'])}</div>
      <div class="sr" style="border:none"><span>🔀 Nginx</span>${svcBadge(d.nginx)}</div>
    </div>
    <div class="card">
      <div class="ct">Метрики сервера</div>
      <div class="sr">
        <span style="color:var(--muted)">CPU</span>
        <div style="text-align:right;min-width:80px">
          <span style="font-weight:700">${d.cpu_pct}%</span>
          ${metricBar(d.cpu_pct)}
        </div>
      </div>
      <div class="sr">
        <span style="color:var(--muted)">RAM</span>
        <div style="text-align:right;min-width:80px">
          <span style="font-weight:700">${d.ram_pct}%</span>
          ${metricBar(d.ram_pct)}
        </div>
      </div>
      <div class="sr">
        <span style="color:var(--muted)">Диск</span>
        <div style="text-align:right;min-width:80px">
          <span style="font-weight:700">${d.disk_pct}%</span>
          ${metricBar(d.disk_pct, 80, 95)}
        </div>
      </div>
      <div class="sr" style="border:none"><span style="color:var(--muted)">Uptime</span><span style="font-weight:700">${d.uptime_days} дн.</span></div>
    </div>
    <div class="card">
      <div class="ct">Статистика</div>
      <div class="sr"><span style="color:var(--muted)">👥 Активных пользователей</span><span style="font-weight:700;color:var(--p)">${d.active_users}</span></div>
      <div class="sr" style="border:none"><span style="color:var(--muted)">📡 Пинг до Xray</span>
        <span style="font-weight:700;color:${d.xray_ping_ms < 0 ? 'var(--r)' : d.xray_ping_ms < 10 ? 'var(--mint)' : 'var(--o)'}">
          ${d.xray_ping_ms < 0 ? '❌' : d.xray_ping_ms + ' мс'}
        </span>
      </div>
    </div>
    <div style="font-size:.7rem;color:var(--muted);text-align:center;padding:4px 0">🇫🇮 Helsinki · обновлено только что</div>`;
}

// ─── Referrals ────────────────────────────────────────────────────────────────
async function loadRef() {
  const el = document.getElementById('ref-content');
  if (!appData) { el.innerHTML = '<div class="loading">⏳</div>'; return; }
  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/referrals`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  let data = { count: 0, bonus_days: 0, link: '' };
  if (res?.ok) data = await res.json();

  el.innerHTML = `
    <div class="card card-glow">
      <div class="ct">Ваша реферальная ссылка</div>
      <div class="sub-url" onclick="copy('${data.link}',this)">${data.link || 'Загрузка...'}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="copy('${data.link}',this)">📋 Копировать</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="shareRef('${data.link}')">📤 Поделиться</button>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="stat-n">${data.count}</div><div class="stat-l">Приглашено</div></div>
      <div class="stat-box"><div class="stat-n">${data.bonus_days}</div><div class="stat-l">Бонус дней</div></div>
    </div>
    <div class="card card-sm">
      <div class="ct">Как работает</div>
      <div class="ir"><div class="ii">🔗</div><div><div style="font-weight:600">Поделитесь ссылкой</div><div class="it">Отправьте другу вашу реферальную ссылку</div></div></div>
      <div class="ir"><div class="ii">💳</div><div><div style="font-weight:600">Друг оплачивает</div><div class="it">Друг получает скидку 10% на первую оплату</div></div></div>
      <div class="ir" style="border:none"><div class="ii">🎁</div><div><div style="font-weight:600">Вы получаете бонус</div><div class="it">+7 дней к вашей подписке за каждого друга</div></div></div>
    </div>`;
}

function shareRef(link) {
  if (tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('🔒 KomoVPN — быстрый VPN без блокировок. Попробуй бесплатно 7 дней!')}`);
  } else {
    copy(link, document.body);
  }
}

// ─── Payments History ─────────────────────────────────────────────────────────
async function loadPayments() {
  const el = document.getElementById('payments-content');
  const token = sessionStorage.getItem('ma_token');
  const res = await fetch(`${API}/payments`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) { el.innerHTML = '<div class="loading">❌ Ошибка загрузки</div>'; return; }
  const { payments } = await res.json();
  if (!payments?.length) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:24px"><div style="font-size:2rem;margin-bottom:8px">📋</div><div style="color:var(--muted)">История платежей пуста</div></div>';
    return;
  }
  const rows = payments.map(p => {
    const statusColor = p.status === 'confirmed' ? 'var(--mint)' : p.status === 'pending' ? 'var(--o)' : 'var(--r)';
    const statusText = p.status === 'confirmed' ? '✅ Оплачен' : p.status === 'pending' ? '⏳ Ожидает' : '❌ Отклонён';
    return `<div class="sr">
      <div>
        <div style="font-weight:600;font-size:.84rem">${p.months} мес. · ${p.amount}₽</div>
        <div style="font-size:.7rem;color:var(--muted)">${p.created_at?.slice(0, 10) || ''}</div>
      </div>
      <span style="font-size:.72rem;font-weight:700;color:${statusColor}">${statusText}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="card">${rows}</div>`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const el = document.getElementById('settings-content');
  const haptic = localStorage.getItem('haptic') !== 'off';
  const notify = localStorage.getItem('notify') !== 'off';
  el.innerHTML = `
    <div class="card">
      <div class="ct">Интерфейс</div>
      <div class="sr">
        <span>📳 Вибрация</span>
        <label class="toggle">
          <input type="checkbox" ${haptic ? 'checked' : ''} onchange="setSetting('haptic',this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="sr" style="border:none">
        <span>🔔 Уведомления об истечении</span>
        <label class="toggle">
          <input type="checkbox" ${notify ? 'checked' : ''} onchange="setSetting('notify',this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
    <div class="card">
      <div class="ct">Аккаунт</div>
      <div class="sr"><span style="color:var(--muted)">Telegram ID</span><span style="font-weight:600">${appData?.user?.id || '—'}</span></div>
      <div class="sr" style="border:none"><span style="color:var(--muted)">Username</span><span style="font-weight:600">${appData?.user?.username ? '@' + appData.user.username : '—'}</span></div>
    </div>
    <div class="card">
      <div class="ct">Дополнительно</div>
      <button class="btn btn-ghost btn-sm" onclick="goTab('payments')" style="margin-bottom:8px">📋 История платежей</button>
      <button class="btn btn-ghost btn-sm" onclick="goTab('ref')" style="margin-bottom:8px">👥 Реферальная программа</button>
      <button class="btn btn-ghost btn-sm" onclick="goTab('server')">🖥 Статус сервера</button>
    </div>
    <div class="card card-sm">
      <div class="ct">О сервисе</div>
      <div class="sr"><span style="color:var(--muted)">Версия</span><span>2.0.0</span></div>
      <div class="sr" style="border:none"><span style="color:var(--muted)">Сервер</span><span>🇫🇮 Helsinki</span></div>
    </div>
    <a href="https://t.me/KomoVpn_bot" class="btn btn-tg mt">🤖 Открыть бот</a>`;
}

function setSetting(key, val) {
  localStorage.setItem(key, val ? 'on' : 'off');
  toast(val ? `✅ ${key} включено` : `🔕 ${key} выключено`);
}

// ─── MTProto ──────────────────────────────────────────────────────────────────
async function loadMTProto() {
  const res = await fetch(`${API}/mtproto`).catch(() => null);
  const d = res?.ok ? await res.json() : {server:'193.17.182.23',port:2443,secret:'dd28bd106fd8f1007a3a5c98b2d91648f8',link:'tg://proxy?server=193.17.182.23&port=2443&secret=dd28bd106fd8f1007a3a5c98b2d91648f8'};

  // Показываем модальное окно с инфо
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `
    <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
    <div class="modal-box">
      <div class="modal-title">📡 MTProto прокси</div>
      <div style="font-size:.8rem;color:var(--muted);margin-bottom:14px;line-height:1.6">
        Специальный прокси только для Telegram. Маскирует трафик под HTTPS.
      </div>
      <div class="card card-sm" style="width:100%;margin-bottom:12px">
        <div class="sr"><span style="color:var(--muted)">Сервер</span><span class="sv" onclick="copy('${d.server}',this)">${d.server}</span></div>
        <div class="sr"><span style="color:var(--muted)">Порт</span><span class="sv" onclick="copy('${d.port}',this)">${d.port}</span></div>
        <div class="sr" style="border:none"><span style="color:var(--muted)">Секрет</span><span class="sv" onclick="copy('${d.secret}',this)" style="font-size:.65rem">${d.secret.slice(0,16)}...</span></div>
      </div>
      <a href="${d.link}" class="btn btn-tg" style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px">
        🔌 Подключить в Telegram
      </a>
      <button class="btn btn-ghost btn-sm mt" onclick="this.closest('.modal').remove()">✕ Закрыть</button>
    </div>`;
  document.body.appendChild(box);
  tg.HapticFeedback?.impactOccurred('light');
}

// ─── QR Code ──────────────────────────────────────────────────────────────────
// Простая генерация QR через внешний API (без библиотеки)
function showQR(text, label) {
  document.getElementById('qr-label').textContent = label;
  const canvas = document.getElementById('qr-canvas');
  const size = 220;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvas.width = size; canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#333';
    ctx.font = '14px monospace';
    ctx.fillText('QR недоступен', 20, size / 2);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  document.getElementById('qr-modal').classList.remove('hidden');
  tg.HapticFeedback?.impactOccurred('light');
}

function closeQR() {
  document.getElementById('qr-modal').classList.add('hidden');
}

// ─── Share ────────────────────────────────────────────────────────────────────
function shareConfig(text) {
  if (navigator.share) {
    navigator.share({ text }).catch(() => copy(text, document.body));
  } else if (tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(text)}`);
  } else {
    copy(text, document.body);
  }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
function copy(text, el) {
  const haptic = localStorage.getItem('haptic') !== 'off';
  navigator.clipboard.writeText(text).then(() => {
    if (el && el !== document.body) {
      const orig = el.textContent.trim();
      el.classList.add('copied');
      el.textContent = '✅ Скопировано!';
      if (haptic) tg.HapticFeedback?.impactOccurred('medium');
      setTimeout(() => { el.classList.remove('copied'); el.textContent = orig; }, 1500);
    } else {
      toast('📋 Скопировано!', 'success');
      if (haptic) tg.HapticFeedback?.impactOccurred('medium');
    }
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    toast('📋 Скопировано!', 'success');
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
