'use strict';
/* Dota Stats — фронт. Чистый JS, без сборки и зависимостей.
   Всё по игроку приходит одним ответом (вся история матчей),
   а дальше фильтры/герои/рекорды/тренды считаются тут, мгновенно. */

const CDN = 'https://cdn.cloudflare.steamstatic.com';
const RANK_IMG = 'https://www.opendota.com/assets/images/dota2/rank_icons/';
const DAY = 86400;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const tip = $('#tip');

const S = {
  cfg: {},
  C: null,                // константы: герои, предметы
  players: new Map(),     // id -> bundle
  peers: new Map(),
  matches: new Map(),
  filters: Object.assign({ period: 'all', mode: 'all', hero: '', lane: '', result: 'all' }, lsGet('filters') || {}),
  page: 0,
  heroSort: { key: 'games', asc: false },
  peerSort: { key: 'with_games', asc: false },
  charts: [],
};

function lsGet(k) { try { return JSON.parse(localStorage.getItem('ds:' + k)); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem('ds:' + k, JSON.stringify(v)); } catch { /* похуй */ } }

async function api(path, opts) {
  if (window.STATIC_API) return window.STATIC_API(path, opts); // статический хостинг, см. static-api.js
  const r = await fetch('/api' + path, opts);
  let j;
  try { j = await r.json(); } catch { throw new Error('Сервер прислал херню вместо JSON'); }
  if (!r.ok) throw new Error(j.message || ('Ошибка ' + r.status));
  return j;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function toast(msg, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Справочники и форматирование
// ─────────────────────────────────────────────────────────────────────────────
const MODES = { 0: 'Unknown', 1: 'All Pick', 2: 'Captains Mode', 3: 'Random Draft', 4: 'Single Draft', 5: 'All Random',
  7: 'Diretide', 8: 'Reverse CM', 11: 'Mid Only', 12: 'Least Played', 16: 'Captains Draft', 18: 'Ability Draft',
  19: 'Event', 20: 'AR Deathmatch', 21: '1v1 Mid', 22: 'All Pick', 23: 'Turbo', 24: 'Mutation', 25: 'Coaches Challenge' };
const LOBBIES = { 0: 'Обычная', 1: 'Практика', 2: 'Турнир', 4: 'С ботами', 5: 'Командная', 6: 'Соло-очередь', 7: 'Рейтинг', 8: '1v1', 9: 'Battle Cup', 12: 'Ивент' };
const LANES = { 1: 'Safe lane', 2: 'Мид', 3: 'Оффлейн', 4: 'Лес' };
const MEDALS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];

const hero = id => (S.C && S.C.heroes[id]) || { name: 'Hero #' + id, img: '', icon: '', attr: 'all', roles: [] };
const heroImg = id => hero(id).img ? CDN + hero(id).img : '';
const item = id => (S.C && S.C.items[id]) || null;
const itemImg = id => { const it = item(id); return it && it.img ? CDN + it.img : ''; };

function heroCell(id, sub = '', sm = false) {
  const h = hero(id);
  return `<div class="hero${sm ? ' sm' : ''}" data-attr="${esc(h.attr)}"><img loading="lazy" src="${esc(heroImg(id))}" alt=""><span class="n">${esc(h.name)}${sub ? `<small>${sub}</small>` : ''}</span></div>`;
}

const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const fmt = n => n == null ? '—' : Math.round(n).toLocaleString('ru-RU');
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const dur = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`; };
const mmss = s => (s < 0 ? '-' : '') + dur(Math.abs(s));
const date = ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTime = ts => new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function ago(ts) {
  const d = Date.now() / 1000 - ts;
  if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' мин назад';
  if (d < DAY) return Math.round(d / 3600) + ' ч назад';
  if (d < 30 * DAY) return Math.round(d / DAY) + ' дн назад';
  return date(ts);
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  return b === 1 ? one : (b >= 2 && b <= 4 ? few : many);
}
const wrCls = wr => wr >= 0.53 ? 'win' : (wr < 0.47 ? 'loss' : '');
function rankName(t) {
  if (!t) return 'Без ранга';
  const m = Math.floor(t / 10), s = t % 10;
  return (MEDALS[m] || '?') + (m < 8 && s ? ' ' + s : '');
}
function rankBadge(t, lb) {
  const m = t ? Math.floor(t / 10) : 0, s = t ? t % 10 : 0;
  let icon = 'rank_icon_' + m + '.png';
  if (m === 8 && lb) icon = lb <= 10 ? 'rank_icon_8c.png' : (lb <= 100 ? 'rank_icon_8b.png' : 'rank_icon_8.png');
  const star = m && m < 8 && s ? `<img src="${RANK_IMG}rank_star_${s}.png" alt="">` : '';
  return `<div class="rank" title="${esc(rankName(t))}"><img src="${RANK_IMG}${icon}" alt="">${star}${m === 8 && lb ? `<span class="lb">#${lb}</span>` : ''}</div>`;
}

function wilson(w, n, z = 1.96) {
  if (!n) return 0;
  const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Данные игрока
// ─────────────────────────────────────────────────────────────────────────────
async function loadConstants() {
  if (!S.C) S.C = await api('/constants');
}

async function loadPlayer(id, fresh = false) {
  if (!fresh && S.players.has(id)) return S.players.get(id);
  const b = await api(`/player/${id}${fresh ? '?fresh=1' : ''}`);
  if (b.error) { const e = new Error(b.message); e.private = true; throw e; }
  const F = b.fields;
  b.list = b.matches.map(r => {
    const m = {};
    F.forEach((f, i) => { m[f] = r[i]; });
    m.radiant = m.player_slot < 128;
    m.win = m.radiant === m.radiant_win;
    m.kda = (m.kills + m.assists) / Math.max(1, m.deaths);
    return m;
  }).sort((a, b) => b.start_time - a.start_time);
  delete b.matches;
  b.byId = new Map(b.list.map(m => [m.match_id, m]));
  S.players.set(id, b);
  rememberMe(b);
  return b;
}

function filtered(list, f = S.filters, withResult = false) {
  const now = Date.now() / 1000;
  const from = f.period === 'all' ? 0 : now - (+f.period) * DAY;
  return list.filter(m => {
    if (m.start_time < from) return false;
    if (f.mode === 'ranked' && m.lobby_type !== 7) return false;
    if (f.mode === 'normal' && !(m.lobby_type === 0 && m.game_mode !== 23)) return false;
    if (f.mode === 'turbo' && m.game_mode !== 23) return false;
    if (f.hero && m.hero_id !== +f.hero) return false;
    if (f.lane && m.lane_role !== +f.lane) return false;
    if (withResult && f.result === 'w' && !m.win) return false;
    if (withResult && f.result === 'l' && m.win) return false;
    return true;
  });
}

function agg(list) {
  const n = list.length;
  const r = { n, w: 0, k: 0, d: 0, a: 0, gpm: 0, xpm: 0, lh: 0, dn: 0, dmg: 0, dmgN: 0, dur: 0, last: 0 };
  for (const m of list) {
    if (m.win) r.w++;
    r.k += m.kills || 0; r.d += m.deaths || 0; r.a += m.assists || 0;
    r.gpm += m.gold_per_min || 0; r.xpm += m.xp_per_min || 0;
    r.lh += m.last_hits || 0; r.dn += m.denies || 0; r.dur += m.duration || 0;
    if (m.hero_damage != null) { r.dmg += m.hero_damage; r.dmgN++; }
    if (m.start_time > r.last) r.last = m.start_time;
  }
  const div = Math.max(1, n);
  r.l = n - r.w;
  r.wr = n ? r.w / n : 0;
  r.kda = (r.k + r.a) / Math.max(1, r.d);
  ['k', 'd', 'a', 'gpm', 'xpm', 'lh', 'dn', 'dur'].forEach(x => { r[x] /= div; });
  r.dmg = r.dmgN ? r.dmg / r.dmgN : null;
  r.score = wilson(r.w, n);
  return r;
}

function groupBy(list, keyFn) {
  const g = new Map();
  for (const m of list) {
    const k = keyFn(m);
    if (k == null) continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(m);
  }
  return g;
}

function heroStats(list) {
  return [...groupBy(list, m => m.hero_id)].map(([id, ms]) => Object.assign(agg(ms), { id, name: hero(id).name }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Тултип
// ─────────────────────────────────────────────────────────────────────────────
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top + h > innerHeight - 8) top = y - h - 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
function hideTip() { tip.style.display = 'none'; }
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (t) showTip(t.dataset.tip, e.clientX, e.clientY);
});
document.addEventListener('mousemove', e => {
  if (tip.style.display === 'block' && e.target.closest('[data-tip]')) showTip(tip.innerHTML, e.clientX, e.clientY);
});
document.addEventListener('mouseout', e => { if (e.target.closest('[data-tip]')) hideTip(); });

// ─────────────────────────────────────────────────────────────────────────────
// Графики (SVG). Один Y на график, тонкие марки, тултип на каждый элемент.
// ─────────────────────────────────────────────────────────────────────────────
function chartBox(id, h = 200) { return `<div class="chart" id="ch-${id}" style="height:${h}px"></div>`; }

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0) || step0;
  const t = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}

function drawBar(id, spec) {
  const el = $('#ch-' + id);
  if (!el) return;
  const W = el.clientWidth, H = el.clientHeight;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const data = spec.data;
  if (!data.length || iw <= 0) { el.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }
  const vals = data.map(d => d.value).filter(v => v != null);
  let yMin = spec.yMin ?? Math.min(0, ...vals), yMax = spec.yMax ?? Math.max(...vals, spec.ref ?? -Infinity);
  if (yMax === yMin) yMax = yMin + 1;
  const ticks = niceTicks(yMin, yMax);
  yMin = Math.min(yMin, ticks[0]); yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const y = v => pad.t + ih - (v - yMin) / (yMax - yMin) * ih;
  const band = iw / data.length;
  const bw = Math.max(1, Math.min(28, band - 2));
  const base = y(Math.max(yMin, 0));
  const fmtY = spec.fmtY || (v => v);
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / (spec.labelW || 44)))));
  let g = '';
  for (const t of ticks) g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`;
  let bars = '', hits = '', labels = '';
  data.forEach((d, i) => {
    const x = pad.l + i * band + (band - bw) / 2;
    if (d.value != null) {
      const top = y(d.value), h = Math.abs(base - top), r = Math.min(4, bw / 2, h);
      const up = d.value >= 0 || yMin >= 0;
      const y0 = up ? top : base;
      // скругляем только «свободный» конец бара, основание прямое
      const path = up
        ? `M${x},${base}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + bw - r}Q${x + bw},${y0} ${x + bw},${y0 + r}V${base}Z`
        : `M${x},${base}V${base + h - r}Q${x},${base + h} ${x + r},${base + h}H${x + bw - r}Q${x + bw},${base + h} ${x + bw},${base + h - r}V${base}Z`;
      bars += `<path class="mark" data-i="${i}" d="${path}" fill="${d.color || spec.color || 'var(--gold)'}"/>`;
    }
    hits += `<rect class="hit" data-i="${i}" x="${pad.l + i * band}" y="${pad.t}" width="${band}" height="${ih}"/>`;
    if (spec.sparseLabels ? d.label : i % every === 0) labels += `<text class="axis" x="${pad.l + i * band + band / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  const ref = spec.ref != null ? `<line class="ref-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(spec.ref)}" y2="${y(spec.ref)}"/>` : '';
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(spec.title || '')}">${g}${bars}${ref}${labels}${hits}</svg>`;
  bindHover(el, i => {
    $$('.mark', el).forEach(m => m.classList.toggle('hl', +m.dataset.i === i));
    return data[i].tip;
  });
}

function drawLine(id, spec) {
  const el = $('#ch-' + id);
  if (!el) return;
  const W = el.clientWidth, H = el.clientHeight;
  const pad = { l: 48, r: 10, t: 10, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const data = spec.data;
  if (data.length < 2 || iw <= 0) { el.innerHTML = '<div class="empty-state">Мало данных для графика</div>'; return; }
  const vals = data.map(d => d.value);
  let yMin = spec.yMin ?? Math.min(...vals), yMax = spec.yMax ?? Math.max(...vals);
  if (spec.ref != null) { yMin = Math.min(yMin, spec.ref); yMax = Math.max(yMax, spec.ref); }
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const ticks = niceTicks(yMin, yMax);
  yMin = Math.min(yMin, ticks[0]); yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const x = i => pad.l + i / (data.length - 1) * iw;
  const y = v => pad.t + ih - (v - yMin) / (yMax - yMin) * ih;
  const fmtY = spec.fmtY || (v => v);
  let g = '';
  for (const t of ticks) g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtY(t)}</text>`;
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  let area = '';
  if (spec.diverge) {
    // заливка выше/ниже нуля своими цветами (преимущество Radiant / Dire)
    const z = y(0);
    const poly = `M${x(0)},${z}L${pts.join('L')}L${x(data.length - 1)},${z}Z`;
    area = `<defs><clipPath id="cp-up-${id}"><rect x="0" y="0" width="${W}" height="${z}"/></clipPath><clipPath id="cp-dn-${id}"><rect x="0" y="${z}" width="${W}" height="${H}"/></clipPath></defs>
      <path d="${poly}" fill="var(--win)" opacity=".18" clip-path="url(#cp-up-${id})"/><path d="${poly}" fill="var(--loss)" opacity=".18" clip-path="url(#cp-dn-${id})"/>`;
  }
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 56))));
  let labels = '';
  data.forEach((d, i) => { if (i % every === 0) labels += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`; });
  const ref = spec.ref != null ? `<line class="ref-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(spec.ref)}" y2="${y(spec.ref)}"/>` : '';
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(spec.title || '')}">${g}${area}${ref}
    <path d="M${pts.join('L')}" fill="none" stroke="${spec.color || 'var(--gold)'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" style="display:none"/>
    <circle class="dot" r="4.5" fill="${spec.color || 'var(--gold)'}" stroke="var(--surface)" stroke-width="2" style="display:none"/>
    <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}"/></svg>`;
  const svg = $('svg', el), xh = $('.xh', el), dot = $('.dot', el), hit = $('.hit', el);
  hit.addEventListener('mousemove', e => {
    const rect = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(data.length - 1, Math.round((e.clientX - rect.left - pad.l) / iw * (data.length - 1))));
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.style.display = '';
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(data[i].value)); dot.style.display = '';
    showTip(data[i].tip, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { xh.style.display = 'none'; dot.style.display = 'none'; hideTip(); });
}

function bindHover(el, onIdx) {
  $$('.hit', el).forEach(h => {
    h.addEventListener('mousemove', e => { el.classList.add('hovering'); const t = onIdx(+h.dataset.i); if (t) showTip(t, e.clientX, e.clientY); });
    h.addEventListener('mouseleave', () => { el.classList.remove('hovering'); $$('.mark', el).forEach(m => m.classList.remove('hl')); hideTip(); });
  });
}

function drawCharts() {
  for (const c of S.charts) (c.type === 'line' ? drawLine : drawBar)(c.id, c);
}
let rzT;
addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(drawCharts, 120); });

// ─────────────────────────────────────────────────────────────────────────────
// Роутер
// ─────────────────────────────────────────────────────────────────────────────
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  S.charts = [];
  hideTip();
  updateMeBtn();
  try {
    await loadConstants();
    if (seq !== routeSeq) return;
    if (!parts.length) {
      if (S.cfg.account_id) { location.replace('#/p/' + S.cfg.account_id); return; }
      return viewSetup();
    }
    if (parts[0] === 'setup') return viewSetup();
    if (parts[0] === 'p' && /^\d+$/.test(parts[1]) && parts[2] === 'hero' && /^\d+$/.test(parts[3] || '')) return await viewMyHero(+parts[1], +parts[3], seq);
    if (parts[0] === 'p' && /^\d+$/.test(parts[1])) return await viewPlayer(+parts[1], parts[2] || 'overview', seq);
    if (parts[0] === 'm' && /^\d+$/.test(parts[1])) return await viewMatch(+parts[1], parts[2] ? +parts[2] : null, seq);
    if (parts[0] === 'draft') return await viewDraft(seq);
    if (parts[0] === 'live') return await viewLive(seq);
    if (parts[0] === 'pros') return await viewPros(seq);
    if (parts[0] === 'meta' && parts[1] === 'vs' && /^\d+$/.test(parts[2] || '') && /^\d+$/.test(parts[3] || '')) return await viewHeroVs(+parts[2], +parts[3], seq);
    if (parts[0] === 'meta') return parts[1] && /^\d+$/.test(parts[1]) ? await viewMetaHero(+parts[1], seq) : await viewMeta(seq);
    if (parts[0] === 'cmp' && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) return await viewCompare(+parts[1], +parts[2], seq);
    app.innerHTML = '<div class="err"><h3>Нет такой страницы</h3><a class="btn" href="#/">На главную</a></div>';
  } catch (e) {
    if (seq !== routeSeq) return;
    app.innerHTML = `<div class="err"><h3>${e.private ? 'Профиль закрыт' : 'Чё-то пошло по пизде'}</h3><p>${esc(e.message)}</p>
      <button class="btn" onclick="route()">Ещё раз</button> <a class="btn" href="#/setup">Сменить ID</a></div>`;
  }
}
addEventListener('hashchange', route);

function loading(msg) {
  app.innerHTML = `<div class="loading"><div class="spin"></div><div>${esc(msg)}</div></div>`;
}

// Справа сверху как на дотабаффе: не вошёл — кнопка Steam, вошёл — ава, ник и меню.
function updateMeBtn() {
  const box = $('#acct');
  const id = S.cfg.account_id;
  if (!id) {
    box.innerHTML = `<button class="btn steam" id="hsteam">${STEAM_ICO}<span>Войти через Steam</span></button>`;
    $('#hsteam').onclick = steamLogin;
    return;
  }
  const me = lsGet('me') || {};
  const ava = me.id === id && me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : '<span class="noava">◉</span>';
  const name = me.id === id && me.name ? me.name : 'Мой профиль';
  box.innerHTML = `<button class="me" id="mebtn" aria-haspopup="true">${ava}<span class="nm">${esc(name)}</span><span class="car">▾</span></button>
    <div class="menu" id="memenu">
      <a href="#/p/${id}">Мой профиль</a>
      <a href="#/p/${id}/matches">Мои матчи</a>
      <a href="#/p/${id}/heroes">Мои герои</a>
      <a href="#/p/${id}/mmr">Мой ММР</a>
      <a href="#/p/${id}/skill">Мой скилл</a>
      <a href="#/p/${id}/matchups">Мои матчапы</a>
      <a href="#/p/${id}/sessions">Тильт-детектор</a>
      <a href="#/p/${id}/goals">Мои цели</a>
      <a href="#/p/${id}/wrapped">Мои итоги</a>
      <a href="#/p/${id}/squad">Рейтинг кентов</a>
      <a href="#/meta">Мета</a>
      <a href="#/draft">Контрпик</a>
      <a href="#/live">Лайв</a>
      <a href="#/pros">Про-игроки</a>
      <hr><button id="logout">Выйти</button>
    </div>`;
  const menu = $('#memenu');
  $('#mebtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
  menu.onclick = () => menu.classList.remove('open');
  $('#logout').onclick = async () => {
    S.cfg = await post('/config', { account_id: null });
    lsSet('me', null);
    toast('Вышел');
    location.hash = '#/setup';
    updateMeBtn();
  };
}
document.addEventListener('click', e => { const m = $('#memenu'); if (m && !e.target.closest('#acct')) m.classList.remove('open'); });

// запоминаем ник и аву своего профиля для шапки
function rememberMe(p) {
  if (p && p.account_id === S.cfg.account_id) {
    const old = lsGet('me') || {};
    if (old.id !== p.account_id || old.name !== p.name || old.avatar !== p.avatar) {
      lsSet('me', { id: p.account_id, name: p.name, avatar: p.avatar });
      updateMeBtn();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Вход через Steam (OpenID 2.0). Просто узнаём твой steamID и подставляем как свой профиль.
// Подпись ответа не проверяем (для этого нужен сервер), и это ок: логин ничего приватного
// не открывает, вся стата публичная. Пароль вводится только на steamcommunity.com.
// ─────────────────────────────────────────────────────────────────────────────
const STEAM_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-9.96 9.04l5.35 2.21a2.83 2.83 0 0 1 1.6-.49h.16l2.38-3.45v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.4 2.42v.13a2.83 2.83 0 0 1-5.62.47L2.4 14.5A10 10 0 1 0 12 2Zm-4.72 15.2-1.22-.5a2.13 2.13 0 1 0 1.17-2.9l1.27.52a1.57 1.57 0 1 1-1.22 2.88Zm9.2-6.6a2.51 2.51 0 1 0-2.51-2.51 2.51 2.51 0 0 0 2.51 2.5Zm0-4.4a1.89 1.89 0 1 1-1.88 1.89 1.89 1.89 0 0 1 1.88-1.89Z"/></svg>';

function steamLogin() {
  const back = location.origin + location.pathname;
  const q = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': back,
    'openid.realm': back,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  location.href = 'https://steamcommunity.com/openid/login?' + q;
}

// вернулись со Стима: ?openid.claimed_id=https://steamcommunity.com/openid/id/7656119...
async function steamReturn() {
  const qs = new URLSearchParams(location.search);
  if (!qs.has('openid.mode')) return false;
  const clean = location.origin + location.pathname;
  const m = (qs.get('openid.claimed_id') || '').match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (qs.get('openid.mode') !== 'id_res' || !m) {
    history.replaceState(null, '', clean + '#/setup');
    toast('Вход через Steam не прошёл');
    return false;
  }
  const r = await api('/resolve?q=' + m[1]);
  S.cfg = await post('/config', { account_id: r.account_id });
  history.replaceState(null, '', clean + '#/p/' + r.account_id);
  updateMeBtn();
  toast('Зашёл через Steam');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Онбординг
// ─────────────────────────────────────────────────────────────────────────────
function viewSetup() {
  const favs = (S.cfg.favorites || []).map(id => {
    const p = S.players.get(id);
    return `<a href="#/p/${id}">${p && p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : ''}<span>${esc(p ? p.name : 'ID ' + id)}</span></a>`;
  }).join('');
  app.innerHTML = `<div class="onb">
    <h1>Dota Stats <span class="muted" style="font-size:18px;font-weight:500">by avekda</span></h1>
    <p>Свой дотабафф, только без рекламы и удобнее.</p>
    ${S.cfg.account_id ? `<a class="btn primary big" href="#/p/${S.cfg.account_id}">Мой профиль →</a>`
      : `<button class="btn steam big" id="steamlogin" type="button">${STEAM_ICO} Войти через Steam</button>`}
    <div class="or"><span>или посмотреть любого игрока</span></div>
    <form id="setup">
      <input class="inp" id="sid" placeholder="Friend ID, steamID64 или ссылка">
      <button class="btn">Открыть</button>
    </form>
    <div id="serr" class="loss"></div>
    ${favs ? `<div class="favs">${favs}</div>` : ''}
    <div class="help">
      <b>Где взять чужой ID:</b>
      <ul>
        <li>В доте: профиль, число <b>Friend ID</b> под ником.</li>
        <li>Или ссылка на профиль Steam/Dotabuff/OpenDota, приложение само вытащит ID.</li>
      </ul>
      <b>Вход через Steam</b> — как на дотабаффе: пароль вводишь только на сайте Стима, сюда он не попадает.<br>
      Если пусто: в доте <b>Настройки → Опции → Расширенные → «Открыть доступ к истории матчей»</b>.
    </div>
  </div>`;
  const sl = $('#steamlogin');
  if (sl) sl.onclick = steamLogin;
  $('#setup').onsubmit = async e => {
    e.preventDefault();
    const v = $('#sid').value.trim();
    try {
      const r = await api('/resolve?q=' + encodeURIComponent(v));
      if (!r.account_id) throw new Error('Не понял ID. Дай число или ссылку.');
      location.hash = '#/p/' + r.account_id;
    } catch (err) { $('#serr').textContent = err.message; }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Страница игрока
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [['overview', 'Обзор'], ['matches', 'Матчи'], ['heroes', 'Герои'], ['skill', 'Скилл'], ['records', 'Рекорды'],
  ['trends', 'Тренды'], ['mmr', 'ММР'], ['sessions', 'Сессии'], ['matchups', 'Матчапы'], ['peers', 'Друзья'], ['squad', 'Кенты-топ'], ['compare', 'Сравнить'], ['goals', 'Цели'], ['wrapped', 'Итоги']];

async function viewPlayer(id, tab, seq) {
  if (!S.players.has(id)) loading('Тяну всю историю матчей… в первый раз секунд 5–10, потом из кэша мгновенно');
  const p = await loadPlayer(id);
  if (['overview', 'heroes'].includes(tab)) await loadMeta(true); // для «против меты», не критично
  if (seq !== routeSeq) return;
  const isMe = S.cfg.account_id === id;
  const fav = (S.cfg.favorites || []).includes(id);
  const all = agg(p.list);
  const last = p.list[0];

  const head = `<section class="phead">
    <img class="ava" src="${esc(p.avatar)}" alt="" onerror="this.style.visibility='hidden'">
    <div class="who">
      <h1>${esc(p.name)} <button class="star${fav ? ' on' : ''}" id="favbtn" title="В избранное">★</button></h1>
      <div class="sub">
        <span>ID <span class="num">${id}</span></span>
        ${last ? `<span>последняя игра ${ago(last.start_time)}</span>` : ''}
        ${p.profileurl ? `<a href="${esc(p.profileurl)}" target="_blank">Steam ↗</a>` : ''}
        <a href="https://www.opendota.com/players/${id}" target="_blank">OpenDota ↗</a>
        <a href="https://www.dotabuff.com/players/${id}" target="_blank">Dotabuff ↗</a>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        ${isMe ? '<span class="badge acc">это ты</span>' : ''}
        <button class="btn sm" id="refresh" title="Попросить OpenDota подтянуть свежие матчи">↻ Обновить</button>
        <button class="btn sm" id="csvbtn" title="Скачать все матчи таблицей (Excel, Google Sheets)">⤓ CSV</button>
      </div>
    </div>
    ${rankBadge(p.rank_tier, p.leaderboard_rank)}
    <div class="stats">
      <div class="stat"><div class="v num">${fmt(all.n)}</div><div class="l">матчей</div></div>
      <div class="stat"><div class="v num"><span class="win">${fmt(all.w)}</span>–<span class="loss">${fmt(all.l)}</span></div><div class="l">побед–сливов</div></div>
      <div class="stat"><div class="v num ${wrCls(all.wr)}">${pct(all.wr, 2)}</div><div class="l">винрейт</div></div>
    </div>
  </section>`;

  const tabs = `<nav class="tabs">${TABS.map(([k, n]) => `<a href="#/p/${id}/${k}" class="${k === tab ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
  const needFilters = !['peers', 'squad', 'compare', 'wrapped', 'goals'].includes(tab);
  app.innerHTML = head + tabs + (needFilters ? filterBar(p, tab) : '') + '<div id="tab"></div>';

  $('#favbtn').onclick = async () => {
    const f = new Set(S.cfg.favorites || []);
    f.has(id) ? f.delete(id) : f.add(id);
    S.cfg = await post('/config', { favorites: [...f] });
    $('#favbtn').classList.toggle('on', f.has(id));
  };
  $('#refresh').onclick = async e => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = '↻ Обновляю…';
    try { await post('/refresh/' + id); } catch { /* не критично */ }
    toast('Попросил OpenDota подтянуть свежие матчи, подожди секунд 15…', 15000);
    setTimeout(async () => {
      try { await loadPlayer(id, true); toast('Обновил'); } catch (err) { toast(esc(err.message)); }
      if (location.hash.includes('/p/' + id)) route();
    }, 15000);
  };
  $('#csvbtn').onclick = () => exportCsv(p);
  rememberRecent(p);
  if (needFilters) bindFilters();

  const box = $('#tab');
  const list = filtered(p.list);
  const fc = $('.fcount');
  if (fc) fc.textContent = `${fmt(list.length)} ${plural(list.length, 'матч', 'матча', 'матчей')} в выборке`;
  ({ overview: tabOverview, matches: tabMatches, heroes: tabHeroes, records: tabRecords, trends: tabTrends,
    skill: tabSkill, sessions: tabSessions, wrapped: tabWrapped, goals: tabGoals, mmr: tabMmr, squad: tabSquad, matchups: tabMatchups, peers: tabPeers, compare: tabCompare }[tab] || tabOverview)(box, p, list, id, seq);
  drawCharts();
}

function seg(name, opts, cur) {
  return `<div class="seg" data-f="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function filterBar(p, tab) {
  const f = S.filters;
  const played = [...new Set(p.list.map(m => m.hero_id))].filter(h => h && S.C.heroes[h]).map(id => [id, hero(id).name]).sort((a, b) => a[1].localeCompare(b[1]));
  return `<div class="filters">
    ${seg('period', [['all', 'Всё время'], ['365', 'Год'], ['180', '6 мес'], ['90', '3 мес'], ['30', 'Месяц']], f.period)}
    ${seg('mode', [['all', 'Все'], ['ranked', 'Рейтинг'], ['normal', 'Обычные'], ['turbo', 'Турбо']], f.mode)}
    ${tab === 'matches' ? seg('result', [['all', 'W+L'], ['w', 'Победы'], ['l', 'Сливы']], f.result) : ''}
    <select data-f="hero"><option value="">Все герои</option>${played.map(([id, n]) => `<option value="${id}" ${f.hero !== '' && +f.hero === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <select data-f="lane"><option value="">Все линии</option>${Object.entries(LANES).map(([k, n]) => `<option value="${k}" ${f.lane === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    ${(f.period !== 'all' || f.mode !== 'all' || f.hero || f.lane || f.result !== 'all') ? '<button class="btn sm" id="freset">Сбросить</button>' : ''}
    <span class="fcount"></span>
  </div>`;
}

function setFilter(k, v) {
  S.filters[k] = v;
  S.page = 0;
  lsSet('filters', S.filters);
  route();
}

function bindFilters() {
  $$('.filters .seg').forEach(s => s.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) setFilter(s.dataset.f, b.dataset.v);
  }));
  $$('.filters select').forEach(s => s.addEventListener('change', () => setFilter(s.dataset.f, s.value)));
  const r = $('#freset');
  if (r) r.onclick = () => { S.filters = { period: 'all', mode: 'all', hero: '', lane: '', result: 'all' }; S.page = 0; lsSet('filters', S.filters); route(); };
}

function matchRow(m, aid, compact = false, noLh = false) {
  const mode = MODES[m.game_mode] || '';
  const lobby = m.lobby_type === 7 ? 'Рейтинг' : (LOBBIES[m.lobby_type] || '');
  const sub = m.lane_role ? LANES[m.lane_role] : (m.party_size > 1 ? `пати ${m.party_size}` : '');
  return `<tr class="click" data-href="#/m/${m.match_id}/${aid}">
    <td>${heroCell(m.hero_id, esc(sub), compact)}</td>
    <td><div class="res ${m.win ? 'win' : 'loss'}">${m.win ? 'Победа' : 'Поражение'}<small>${ago(m.start_time)}</small></div></td>
    ${compact ? '' : `<td class="dim">${esc(lobby)}<div class="muted" style="font-size:11px">${esc(mode)}</div></td>`}
    <td class="num r">${dur(m.duration)}</td>
    <td class="num r"><span class="win">${m.kills}</span>/<span class="loss">${m.deaths}</span>/<span>${m.assists}</span>
      ${compact ? '' : `<div class="muted" style="font-size:11px">KDA ${m.kda.toFixed(2)}</div>`}</td>
    ${compact ? '' : `<td class="num r">${m.gold_per_min} <span class="muted">/ ${m.xp_per_min}</span></td>
    ${noLh ? '' : `<td class="num r">${m.last_hits} <span class="muted">/ ${m.denies ?? 0}</span></td>`}
    <td class="num r">${fmtK(m.hero_damage)}</td>`}
  </tr>`;
}

function bindRowLinks(root) {
  root.addEventListener('click', e => {
    const tr = e.target.closest('[data-href]');
    if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.href;
  });
}

// ── Обзор ──
function tabOverview(box, p, list, id) {
  if (!list.length) { box.innerHTML = '<div class="empty-state">Под эти фильтры матчей нет</div>'; return; }
  const a = agg(list);
  const hs = heroStats(list).sort((x, y) => y.n - x.n);
  const recent = list.slice(0, 15);
  const form = list.slice(0, 30);
  const lanes = [...groupBy(list, m => m.lane_role || null)].map(([k, ms]) => Object.assign(agg(ms), { k })).sort((x, y) => y.n - x.n);
  const lanesKnown = lanes.reduce((s, x) => s + x.n, 0);

  box.innerHTML = `
  <div class="tiles">
    <div class="tile"><div class="v num ${wrCls(a.wr)}">${pct(a.wr)}</div><div class="l">винрейт</div><div class="s">${fmt(a.w)}–${fmt(a.l)}</div></div>
    <div class="tile"><div class="v num">${a.kda.toFixed(2)}</div><div class="l">KDA</div><div class="s num">${a.k.toFixed(1)} / ${a.d.toFixed(1)} / ${a.a.toFixed(1)}</div></div>
    <div class="tile"><div class="v num">${fmt(a.gpm)}</div><div class="l">GPM</div><div class="s">XPM ${fmt(a.xpm)}</div></div>
    <div class="tile"><div class="v num">${fmt(a.lh)}</div><div class="l">крипов</div><div class="s">денаев ${a.dn.toFixed(1)}</div></div>
    <div class="tile"><div class="v num">${fmtK(a.dmg)}</div><div class="l">урон по героям</div><div class="s">в среднем</div></div>
    <div class="tile"><div class="v num">${dur(a.dur)}</div><div class="l">длит. матча</div><div class="s">${hs.length} ${plural(hs.length, 'герой', 'героя', 'героев')}</div></div>
  </div>
  <div class="grid g-main">
    <div class="grid">
      <section class="card">
        <h2>Последние матчи <span class="r"><a href="#/p/${id}/matches">все матчи →</a></span></h2>
        <div class="scroll-x"><table class="tbl" id="recent">
          <thead><tr><th>Герой</th><th>Результат</th><th>Тип</th><th class="r">Время</th><th class="r">K/D/A</th><th class="r">GPM/XPM</th><th class="r">Урон</th></tr></thead>
          <tbody>${recent.map(m => matchRow(m, id, false, true)).join('')}</tbody></table></div>
      </section>
      <section class="card">
        <h2>Чаще всего играешь <span class="r"><a href="#/p/${id}/heroes">все герои →</a></span></h2>
        <div class="scroll-x"><table class="tbl" id="tophero">
          <thead><tr><th>Герой</th><th class="r">Матчей</th><th>Винрейт</th><th class="r">KDA</th><th class="r">GPM</th></tr></thead>
          <tbody>${hs.slice(0, 10).map(h => heroRow(h, id, ['n', 'wr', 'kda', 'gpm'])).join('')}</tbody></table></div>
      </section>
    </div>
    <div class="grid" style="align-content:start">
      <section class="card">
        <h2>Форма <small>последние ${form.length}, свежие слева</small></h2>
        <div class="form">${form.map(m => `<a href="#/m/${m.match_id}/${id}" class="${m.win ? 'w' : 'l'}" data-tip="<b>${esc(hero(m.hero_id).name)}</b><br>${m.win ? 'Победа' : 'Поражение'} · ${m.kills}/${m.deaths}/${m.assists}<br><span class='k'>${ago(m.start_time)}</span>">${m.win ? 'W' : 'L'}</a>`).join('')}</div>
      </section>
      <section class="card">
        <h2>Советы <small>посчитано по твоим матчам</small></h2>
        <div class="insights">${insights(list).map(i => `<div class="ins ${i.cls}"><span class="i">${i.icon}</span><div><b>${i.title}</b><div class="t">${i.text}</div></div></div>`).join('') || '<div class="muted">Мало матчей для выводов</div>'}</div>
      </section>
      ${vsMetaCard(p, list)}
      <section class="card">
        <h2>Линии <small>${lanesKnown ? `известна у ${fmt(lanesKnown)} матчей` : ''}</small></h2>
        ${lanes.length ? lanes.map(l => `<div style="display:grid;grid-template-columns:90px 1fr 60px 64px;gap:10px;align-items:center;padding:4px 0">
          <span>${LANES[l.k] || l.k}</span><span class="bar"><i class="${wrCls(l.wr)}" style="width:${(l.wr * 100).toFixed(1)}%"></i></span>
          <span class="num r muted" style="text-align:right">${fmt(l.n)}</span><span class="num ${wrCls(l.wr)}" style="text-align:right">${pct(l.wr)}</span></div>`).join('')
          : '<div class="muted">OpenDota не знает линий для этих матчей (нужен парсинг)</div>'}
      </section>
    </div>
  </div>
  <section class="card" style="margin-top:16px">
    <h2>Активность за год</h2>
    ${heatmap(p.list, id)}
  </section>`;
  $('#tophero tbody', box).onclick = e => { const tr = e.target.closest('[data-hero]'); if (tr) location.hash = `#/p/${id}/hero/${tr.dataset.hero}`; };
  bindRowLinks(box);
}

function heroRow(h, aid, cols) {
  const c = {
    n: `<td class="num r">${fmt(h.n)}</td>`,
    wr: `<td><div class="cellbar"><span class="num ${wrCls(h.wr)}">${pct(h.wr)}</span><span class="bar"><i class="${wrCls(h.wr)}" style="width:${(h.wr * 100).toFixed(1)}%"></i></span></div></td>`,
    kda: `<td class="num r">${h.kda.toFixed(2)}</td>`,
    kda3: `<td class="num r muted">${h.k.toFixed(1)}/${h.d.toFixed(1)}/${h.a.toFixed(1)}</td>`,
    gpm: `<td class="num r">${fmt(h.gpm)}</td>`,
    xpm: `<td class="num r">${fmt(h.xpm)}</td>`,
    lh: `<td class="num r">${fmt(h.lh)}</td>`,
    dmg: `<td class="num r">${fmtK(h.dmg)}</td>`,
    dur: `<td class="num r">${dur(h.dur)}</td>`,
    score: `<td class="num r muted" data-tip="Нижняя граница винрейта с учётом числа игр (Вилсон). Чем выше, тем увереннее герой твой.">${pct(h.score)}</td>`,
    last: `<td class="r muted">${ago(h.last)}</td>`,
    vsm: h.vsm == null ? '<td class="r muted">—</td>' : `<td class="num r ${h.vsm >= 0 ? 'win' : 'loss'}" data-tip="Твой винрейт минус средний на этом герое у всех на твоём ранге (${pct(h.base)})">${signPct(h.vsm)}</td>`,
  };
  return `<tr class="click" data-hero="${h.id}">${`<td>${heroCell(h.id)}</td>`}${cols.map(k => c[k]).join('')}</tr>`;
}

function heatmap(list, id) {
  const days = new Map();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const start = new Date(now); start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // с понедельника
  const fromTs = start.getTime() / 1000;
  for (const m of list) {
    if (m.start_time < fromTs) break; // список отсортирован по убыванию даты
    const d = new Date(m.start_time * 1000); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    const v = days.get(k) || { n: 0, w: 0 };
    v.n++; if (m.win) v.w++;
    days.set(k, v);
  }
  let cells = '', total = 0;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const v = days.get(d.getTime());
    const n = v ? v.n : 0;
    total += n;
    const l = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4;
    const ds = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const t = n ? `<b>${ds}</b><br>${n} ${plural(n, 'матч', 'матча', 'матчей')} · <span class='win'>${v.w}W</span> <span class='loss'>${n - v.w}L</span>` : `<b>${ds}</b><br>не играл`;
    cells += `<i data-l="${l}" data-tip="${t}"></i>`;
  }
  return `<div class="heat">${cells}</div>
    <div class="heat-legend"><span>${fmt(total)} ${plural(total, 'матч', 'матча', 'матчей')} за год (без учёта фильтров) ·</span> меньше
      <i style="background:var(--surface-3)"></i><i style="background:#4a1814"></i><i style="background:#7a2018"></i><i style="background:#b02b20"></i><i style="background:#ff4b3e"></i> больше</div>`;
}

// Выводы, которых нет на дотабаффе: тильт, время суток, соло/пати, лейт/ранняя игра.
function insights(list) {
  const out = [];
  const asc = [...list].reverse();
  if (list.length >= 3) {
    const w = list[0].win;
    let s = 0;
    while (s < list.length && list[s].win === w) s++;
    if (s >= 3) out.push(w
      ? { cls: 'good', icon: '▲', title: `${s} ${plural(s, 'победа', 'победы', 'побед')} подряд`, text: 'Ты в огне, катай дальше, пока прёт.' }
      : { cls: 'bad', icon: '▼', title: `${s} ${plural(s, 'слив', 'слива', 'сливов')} подряд`, text: 'Стрик сливов. Сделай перерыв, а не лезь отыгрываться.' });
  }
  const hs = heroStats(list).filter(h => h.n >= 15);
  const spam = hs.filter(h => h.wr >= 0.52).sort((a, b) => b.score - a.score)[0];
  if (spam) out.push({ cls: 'good', icon: '✓', title: `Спамь ${esc(spam.name)}`, text: `${pct(spam.wr)} на ${fmt(spam.n)} играх, это не случайность.` });
  const avoid = hs.filter(h => h.wr < 0.46).sort((a, b) => a.wr - b.wr)[0];
  if (avoid) out.push({ cls: 'bad', icon: '✕', title: `Завязывай с ${esc(avoid.name)}`, text: `${pct(avoid.wr)} на ${fmt(avoid.n)} играх. Не бери в ранге.` });

  // тильт: исход следующей катки в той же сессии (перерыв < 2 ч) после слива/победы
  let aw = 0, an = 0, lw = 0, ln = 0, l2w = 0, l2n = 0;
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1], cur = asc[i];
    if (cur.start_time - (prev.start_time + prev.duration) > 2 * 3600) continue;
    if (prev.win) { an++; if (cur.win) aw++; } else { ln++; if (cur.win) lw++; }
    if (i >= 2 && !prev.win && !asc[i - 2].win && cur.start_time - (asc[i - 2].start_time + asc[i - 2].duration) < 4 * 3600) { l2n++; if (cur.win) l2w++; }
  }
  if (an >= 40 && ln >= 40) {
    const d = aw / an - lw / ln;
    if (d > 0.03) out.push({ cls: 'bad', icon: '!', title: 'Тебя тильтует', text: `После слива следующую выигрываешь в ${pct(lw / ln)} случаев, после победы в ${pct(aw / an)}.${l2n >= 25 ? ` После двух сливов подряд: ${pct(l2w / l2n)}.` : ''} Слил две, иди пожри.` });
    else out.push({ cls: 'info', icon: '≈', title: 'Не тильтуешь', text: `После слива ${pct(lw / ln)}, после победы ${pct(aw / an)}. Голова холодная.` });
  }

  // время суток
  const blocks = [['ночью (0–6)', 0, 6], ['утром (6–12)', 6, 12], ['днём (12–18)', 12, 18], ['вечером (18–24)', 18, 24]]
    .map(([n, a, b]) => { const ms = list.filter(m => { const h = new Date(m.start_time * 1000).getHours(); return h >= a && h < b; }); return { ...agg(ms), name: n }; })
    .filter(b => b.n >= 40);
  if (blocks.length >= 2) {
    const best = blocks.reduce((x, y) => y.wr > x.wr ? y : x), worst = blocks.reduce((x, y) => y.wr < x.wr ? y : x);
    if (best.wr - worst.wr >= 0.03) out.push({ cls: 'info', icon: '◷', title: `Лучше всего играешь ${best.name}`, text: `${pct(best.wr)}, а ${worst.name} всего ${pct(worst.wr)}.` });
  }

  // соло vs пати
  const solo = agg(list.filter(m => m.party_size === 1)), party = agg(list.filter(m => m.party_size > 1));
  if (solo.n >= 40 && party.n >= 40) {
    const better = party.wr > solo.wr;
    out.push({ cls: 'info', icon: better ? '+' : '1', title: better ? 'С пати заходит лучше' : 'Соло ты сильнее', text: `Соло ${pct(solo.wr)} (${fmt(solo.n)}), в пати ${pct(party.wr)} (${fmt(party.n)}).` });
  }

  // ранняя игра vs лейт
  const early = agg(list.filter(m => m.duration < 30 * 60 && m.duration > 600)), late = agg(list.filter(m => m.duration >= 45 * 60));
  if (early.n >= 40 && late.n >= 40 && Math.abs(early.wr - late.wr) >= 0.04) {
    out.push(early.wr > late.wr
      ? { cls: 'info', icon: '»', title: 'Ты сильнее в коротких играх', text: `До 30 мин ${pct(early.wr)}, после 45 мин ${pct(late.wr)}. Закрывай игры быстрее.` }
      : { cls: 'info', icon: '«', title: 'Ты лейтовый', text: `После 45 мин ${pct(late.wr)}, до 30 мин ${pct(early.wr)}. Не форси ранние драки.` });
  }

  // последние 50 vs всё остальное
  if (list.length >= 200) {
    const r = agg(list.slice(0, 50)), rest = agg(list.slice(50));
    const d = r.wr - rest.wr;
    if (Math.abs(d) >= 0.05) out.push(d > 0
      ? { cls: 'good', icon: '↗', title: 'Ты апаешься', text: `Последние 50 игр ${pct(r.wr)} против ${pct(rest.wr)} в среднем.` }
      : { cls: 'bad', icon: '↘', title: 'Просел по форме', text: `Последние 50 игр ${pct(r.wr)} против ${pct(rest.wr)} в среднем.` });
  }
  return out;
}

// ── Матчи ──
function tabMatches(box, p, _list, id) {
  const list = filtered(p.list, S.filters, true);
  const fc = $('.fcount');
  if (fc) fc.textContent = `${fmt(list.length)} ${plural(list.length, 'матч', 'матча', 'матчей')}`;
  const PER = 50, pages = Math.max(1, Math.ceil(list.length / PER));
  S.page = Math.min(S.page, pages - 1);
  const rows = list.slice(S.page * PER, S.page * PER + PER);
  box.innerHTML = `<section class="card">
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>Герой</th><th>Результат</th><th>Тип</th><th class="r">Время</th><th class="r">K/D/A</th><th class="r">GPM/XPM</th><th class="r">LH/DN</th><th class="r">Урон</th></tr></thead>
      <tbody>${rows.map(m => matchRow(m, id)).join('') || '<tr><td colspan="8" class="empty-state">Пусто</td></tr>'}</tbody></table></div>
    ${pages > 1 ? `<div class="pager">
      <button class="btn sm" data-pg="0" ${S.page === 0 ? 'disabled' : ''}>«</button>
      <button class="btn sm" data-pg="${S.page - 1}" ${S.page === 0 ? 'disabled' : ''}>‹ Назад</button>
      <span class="num">${S.page + 1} / ${pages}</span>
      <button class="btn sm" data-pg="${S.page + 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>Вперёд ›</button>
      <button class="btn sm" data-pg="${pages - 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>»</button></div>` : ''}
  </section>`;
  bindRowLinks(box);
  $$('[data-pg]', box).forEach(b => b.onclick = () => { S.page = +b.dataset.pg; route(); scrollTo(0, 0); });
}

// ── Герои ──
const HERO_COLS = [['n', 'Матчей'], ['wr', 'Винрейт'], ['score', 'Надёжность'], ['kda', 'KDA'], ['kda3', 'K/D/A'],
  ['vsm', 'vs ранг'], ['gpm', 'GPM'], ['xpm', 'XPM'], ['lh', 'Крипы'], ['dmg', 'Урон'], ['dur', 'Длит.'], ['last', 'Последний']];
function tabHeroes(box, p, list, id) {
  const q = (S.heroQ || '').toLowerCase();
  const minN = S.heroMin || 1;
  let hs = heroStats(list).filter(h => h.n >= minN && (!q || h.name.toLowerCase().includes(q)));
  const md = metaDelta(p);
  for (const h of hs) { h.base = md ? md.of(h.id) : null; h.vsm = h.base == null ? null : h.wr - h.base; }
  const { key, asc } = S.heroSort;
  const sk = key === 'kda3' ? 'k' : key;
  hs.sort((a, b) => (asc ? 1 : -1) * ((a[sk] ?? -1) - (b[sk] ?? -1)) || b.n - a.n);
  box.innerHTML = `<section class="card">
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <input class="inp" id="hq" placeholder="Найти героя…" value="${esc(S.heroQ || '')}" style="width:220px">
      <label class="muted">мин. матчей</label>
      <select id="hmin">${[1, 5, 10, 25, 50, 100].map(n => `<option ${n === minN ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="muted" style="margin-left:auto;font-size:12px">${hs.length} ${plural(hs.length, 'герой', 'героя', 'героев')} · клик по герою → твоё досье на нём</span>
    </div>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>Герой</th>${HERO_COLS.map(([k, n]) => `<th class="sortable${k === 'wr' ? '' : ' r'}${key === k ? ' sorted' + (asc ? ' asc' : '') : ''}" data-k="${k}">${n}</th>`).join('')}</tr></thead>
      <tbody>${hs.map(h => heroRow(h, id, HERO_COLS.map(c => c[0]))).join('')}</tbody></table></div>
  </section>`;
  $$('th.sortable', box).forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    S.heroSort = { key: k, asc: S.heroSort.key === k ? !S.heroSort.asc : false };
    tabHeroes(box, p, list, id);
  });
  const hq = $('#hq', box);
  hq.oninput = () => { S.heroQ = hq.value; const pos = hq.selectionStart; tabHeroes(box, p, list, id); const n = $('#hq', box); n.focus(); n.setSelectionRange(pos, pos); };
  $('#hmin', box).onchange = e => { S.heroMin = +e.target.value; tabHeroes(box, p, list, id); };
  box.querySelector('tbody').onclick = e => {
    const tr = e.target.closest('[data-hero]');
    if (tr) location.hash = `#/p/${id}/hero/${tr.dataset.hero}`;
  };
}

// ── Рекорды ──
function tabRecords(box, p, list, id) {
  // практис-лобби (там -gold читы) и игры с ботами в рекорды не берём
  const real = list.filter(m => m.duration > 600 && !m.leaver_status && m.lobby_type !== 1 && m.lobby_type !== 4);
  const recs = [
    ['Больше всего убийств', 'kills', v => v], ['Больше всего ассистов', 'assists', v => v],
    ['Больше всего смертей', 'deaths', v => v, 'позорный'], ['Лучший KDA', 'kda', v => v.toFixed(2)],
    ['Максимальный GPM', 'gold_per_min', v => fmt(v)], ['Максимальный XPM', 'xp_per_min', v => fmt(v)],
    ['Больше всего крипов', 'last_hits', v => fmt(v)], ['Больше всего денаев', 'denies', v => fmt(v)],
    ['Урон по героям', 'hero_damage', v => fmt(v)], ['Урон по строениям', 'tower_damage', v => fmt(v)],
    ['Лечение', 'hero_healing', v => fmt(v)], ['Самая долгая игра', 'duration', v => dur(v)],
  ];
  const cards = recs.map(([label, f, fv, tag]) => {
    let best = null;
    for (const m of real) if (m[f] != null && (!best || m[f] > best[f])) best = m;
    return best ? recCard(label, fv(best[f]), best, id, tag) : '';
  });
  const wins = real.filter(m => m.win);
  if (wins.length) {
    const fast = wins.reduce((a, b) => b.duration < a.duration ? b : a);
    cards.push(recCard('Самая быстрая победа', dur(fast.duration), fast, id));
  }
  // самые длинные стрики
  let bw = 0, bl = 0, cw = 0, cl = 0;
  for (const m of [...list].reverse()) {
    if (m.win) { cw++; cl = 0; } else { cl++; cw = 0; }
    bw = Math.max(bw, cw); bl = Math.max(bl, cl);
  }
  box.innerHTML = `<div class="recs">${cards.join('')}
    <div class="rec" style="cursor:default"><div class="l">Лучший винстрик</div><div class="v num win">${bw}</div><div class="m">${plural(bw, 'победа', 'победы', 'побед')} подряд</div></div>
    <div class="rec" style="cursor:default"><div class="l">Худший лузстрик</div><div class="v num loss">${bl}</div><div class="m">${plural(bl, 'слив', 'слива', 'сливов')} подряд</div></div>
  </div>
  <p class="muted" style="font-size:12px;margin-top:14px">Игры короче 10 минут, с ливерами, практис-лобби и игры с ботами в рекордах не учитываются.</p>`;
  bindRowLinks(box);
}
function recCard(label, value, m, id, tag) {
  return `<div class="rec" data-href="#/m/${m.match_id}/${id}">
    <div class="l">${label}${tag ? ` <span class="badge">${tag}</span>` : ''}</div>
    <div class="v num">${value}</div>
    ${heroCell(m.hero_id, `<span class="${m.win ? 'win' : 'loss'}">${m.win ? 'Победа' : 'Поражение'}</span> · ${date(m.start_time)}`, true)}
  </div>`;
}

// ── Тренды ──
function tabTrends(box, p, list) {
  if (list.length < 10) { box.innerHTML = '<div class="empty-state">Мало матчей для трендов</div>'; return; }
  const asc = [...list].reverse();
  const months = groupBy(asc, m => { const d = new Date(m.start_time * 1000); return d.getFullYear() * 100 + d.getMonth(); });
  // заполняем пустые месяцы, чтоб ось была честной
  const keys = [...months.keys()];
  const mk = [];
  for (let k = keys[0]; k <= keys[keys.length - 1];) {
    mk.push(k);
    let y = Math.floor(k / 100), mo = k % 100 + 1;
    if (mo > 11) { y++; mo = 0; }
    k = y * 100 + mo;
  }
  const mLabel = k => { const y = Math.floor(k / 100), mo = k % 100; return mk.length > 30 ? (mo === 0 ? String(y) : '') : new Date(y, mo).toLocaleDateString('ru-RU', { month: 'short' }) + (mo === 0 ? ' ' + String(y).slice(2) : ''); };
  const shortMonth = k => String(k % 100 + 1).padStart(2, '0') + '.' + String(Math.floor(k / 100)).slice(2);
  const mFull = k => new Date(Math.floor(k / 100), k % 100).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const mAgg = mk.map(key => ({ ...agg(months.get(key) || []), key }));
  const wrTip = (title, a) => `<b>${title}</b><br>${a.n ? `${pct(a.wr)} · ${a.w}W ${a.l}L` : 'нет игр'}`;
  const wrColor = a => a.wr >= 0.5 ? 'var(--win)' : 'var(--loss)';

  S.charts.push({ id: 'games', type: 'bar', title: 'Матчей в месяц', sparseLabels: mk.length > 30,
    data: mAgg.map(a => ({ label: mLabel(a.key), value: a.n, tip: `<b>${mFull(a.key)}</b><br>${a.n} ${plural(a.n, 'матч', 'матча', 'матчей')}` })) });
  S.charts.push({ id: 'mwr', type: 'bar', title: 'Винрейт по месяцам', yMin: 0, yMax: 1, ref: 0.5, fmtY: v => Math.round(v * 100) + '%', sparseLabels: mk.length > 30,
    data: mAgg.map(a => ({ label: mLabel(a.key), value: a.n >= 5 ? a.wr : null, color: wrColor(a), tip: wrTip(mFull(a.key), a) + (a.n && a.n < 5 ? '<br><span class="k">меньше 5 игр, не рисую</span>' : '') })) });

  // скользящий винрейт
  const last = asc.slice(-600), W = 50, roll = [];
  for (let i = W; i <= last.length; i++) {
    const w = last.slice(i - W, i).filter(m => m.win).length;
    roll.push({ label: new Date(last[i - 1].start_time * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), value: w / W, tip: `<b>${date(last[i - 1].start_time)}</b><br>винрейт за последние ${W}: ${pct(w / W)}` });
  }
  if (roll.length >= 2) S.charts.push({ id: 'roll', type: 'line', title: 'Скользящий винрейт', ref: 0.5, fmtY: v => Math.round(v * 100) + '%', color: 'var(--accent-hi)', data: roll });

  S.charts.push({ id: 'gpm', type: 'line', title: 'GPM по месяцам', color: 'var(--gold)',
    data: mAgg.filter(a => a.n).map(a => ({ label: shortMonth(a.key), value: Math.round(a.gpm), tip: `<b>${mFull(a.key)}</b><br>GPM ${fmt(a.gpm)} · XPM ${fmt(a.xpm)}` })) });

  const hours = Array.from({ length: 24 }, (_, h) => ({ ...agg(list.filter(m => new Date(m.start_time * 1000).getHours() === h)), h }));
  S.charts.push({ id: 'hour', type: 'bar', title: 'Винрейт по часам', yMin: 0.3, yMax: 0.7, ref: 0.5, fmtY: v => Math.round(v * 100) + '%', labelW: 22,
    data: hours.map(a => ({ label: String(a.h), value: a.n >= 10 ? a.wr : null, color: wrColor(a), tip: wrTip(`${a.h}:00–${a.h}:59`, a) })) });

  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const wd = WD.map((n, i) => ({ ...agg(list.filter(m => (new Date(m.start_time * 1000).getDay() + 6) % 7 === i)) }));
  S.charts.push({ id: 'wd', type: 'bar', title: 'Винрейт по дням недели', yMin: 0.3, yMax: 0.7, ref: 0.5, fmtY: v => Math.round(v * 100) + '%',
    data: wd.map((a, i) => ({ label: WD[i], value: a.n >= 10 ? a.wr : null, color: wrColor(a), tip: wrTip(WD[i], a) })) });

  const buckets = [[0, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 999]];
  const bd = buckets.map(([a, b]) => ({ ...agg(list.filter(m => m.duration >= a * 60 && m.duration < b * 60)), lab: b === 999 ? `${a}+` : (a === 0 ? `<${b}` : `${a}–${b}`) }));
  S.charts.push({ id: 'dur', type: 'bar', title: 'Винрейт по длительности', yMin: 0.3, yMax: 0.7, ref: 0.5, fmtY: v => Math.round(v * 100) + '%',
    data: bd.map(a => ({ label: a.lab, value: a.n >= 10 ? a.wr : null, color: wrColor(a), tip: wrTip(a.lab + ' минут', a) })), labelW: 30 });

  const ps = [1, 2, 3, 4, 5].map(n => ({ ...agg(list.filter(m => (m.party_size || 0) === n)), n0: n }));
  S.charts.push({ id: 'party', type: 'bar', title: 'Соло и пати', yMin: 0.3, yMax: 0.7, ref: 0.5, fmtY: v => Math.round(v * 100) + '%',
    data: ps.map(a => ({ label: a.n0 === 1 ? 'соло' : `пати ${a.n0}`, value: a.n >= 10 ? a.wr : null, color: wrColor(a), tip: wrTip(a.n0 === 1 ? 'Соло' : `Пати из ${a.n0}`, a) })) });

  const lg = '<div class="legend"><span><i style="background:var(--win)"></i>выше 50%</span><span><i style="background:var(--loss)"></i>ниже 50%</span><span>пунктир: 50%</span></div>';
  box.innerHTML = `<div class="grid">
    <section class="card"><h2>Матчей в месяц</h2>${chartBox('games', 180)}</section>
    <section class="card"><h2>Винрейт по месяцам <small>месяцы с 5+ играми</small></h2>${chartBox('mwr', 200)}${lg}</section>
    <div class="grid g2">
      <section class="card"><h2>Скользящий винрейт <small>окно ${W} игр, последние ${last.length}</small></h2>${chartBox('roll', 200)}</section>
      <section class="card"><h2>GPM по месяцам</h2>${chartBox('gpm', 200)}</section>
    </div>
    <section class="card"><h2>Винрейт по времени суток <small>по твоему локальному времени, 10+ игр в часе</small></h2>${chartBox('hour', 190)}${lg}</section>
    <div class="grid g3">
      <section class="card"><h2>По дням недели</h2>${chartBox('wd', 180)}</section>
      <section class="card"><h2>По длительности <small>минуты</small></h2>${chartBox('dur', 180)}</section>
      <section class="card"><h2>Соло / пати</h2>${chartBox('party', 180)}</section>
    </div>
  </div>`;
}

// ── Друзья ──
async function tabPeers(box, p, _l, id, seq) {
  box.innerHTML = '<div class="loading"><div class="spin"></div></div>';
  if (!S.peers.has(id)) S.peers.set(id, await api(`/player/${id}/peers`));
  if (seq !== routeSeq) return;
  const draw = () => {
    const q = (S.peerQ || '').toLowerCase();
    const rows = S.peers.get(id).filter(r => r.with_games + r.against_games > 0 && (!q || (r.personaname || '').toLowerCase().includes(q)))
      .map(r => Object.assign({}, r, { with_wr: r.with_games ? r.with_win / r.with_games : 0, ag_wr: r.against_games ? r.against_win / r.against_games : 0 }));
    const { key, asc } = S.peerSort;
    rows.sort((a, b) => (asc ? 1 : -1) * ((a[key] ?? 0) - (b[key] ?? 0)));
    const th = (k, n) => `<th class="sortable r${key === k ? ' sorted' + (asc ? ' asc' : '') : ''}" data-k="${k}">${n}</th>`;
    box.innerHTML = `<section class="card">
      <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center">
        <input class="inp" id="pq" placeholder="Найти кента…" value="${esc(S.peerQ || '')}" style="width:220px">
        <span class="muted" style="margin-left:auto;font-size:12px">за всё время, фильтры тут не работают</span></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Игрок</th>${th('with_games', 'Вместе')}${th('with_wr', 'Винрейт вместе')}${th('against_games', 'Против')}${th('ag_wr', 'Ты выиграл против')}${th('last_played', 'Последняя')}<th></th></tr></thead>
      <tbody>${rows.slice(0, 300).map(r => `<tr class="click" data-href="#/p/${r.account_id}">
        <td><div class="hero"><img src="${esc(r.avatarfull || '')}" style="width:30px;height:30px" alt="" loading="lazy"><span class="n">${esc(r.personaname || 'ID ' + r.account_id)}</span></div></td>
        <td class="num r">${fmt(r.with_games)}</td>
        <td class="num r ${r.with_games ? wrCls(r.with_wr) : ''}">${r.with_games ? pct(r.with_wr) : '—'}</td>
        <td class="num r">${fmt(r.against_games)}</td>
        <td class="num r ${r.against_games ? wrCls(r.ag_wr) : ''}">${r.against_games ? `${r.against_win}/${r.against_games}` : '—'}</td>
        <td class="r muted">${r.last_played ? ago(r.last_played) : '—'}</td>
        <td><a class="btn sm" href="#/cmp/${id}/${r.account_id}">сравнить</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">Никого</td></tr>'}</tbody></table></div>
    </section>`;
    $$('th.sortable', box).forEach(t => t.onclick = () => { const k = t.dataset.k; S.peerSort = { key: k, asc: S.peerSort.key === k ? !S.peerSort.asc : false }; draw(); });
    const pq = $('#pq', box);
    pq.oninput = () => { S.peerQ = pq.value; const pos = pq.selectionStart; draw(); const n = $('#pq', box); n.focus(); n.setSelectionRange(pos, pos); };
  };
  draw();
  bindRowLinks(box);
}

// ── Сравнить (выбор соперника) ──
async function tabCompare(box, p, _l, id, seq) {
  box.innerHTML = `<section class="card">
    <h2>С кем сравнить?</h2>
    <div class="search" style="max-width:none"><span class="ico">⌕</span><input class="inp" id="cq" placeholder="Ник, Friend ID или ссылка" style="width:100%;padding-left:34px"><div class="drop" id="cdrop"></div></div>
    <h2 style="margin-top:20px">Или выбери из тех, с кем часто играешь</h2><div id="cpeers" class="favs" style="justify-content:flex-start"><div class="spin"></div></div>
  </section>`;
  attachSearch($('#cq', box), $('#cdrop', box), r => `#/cmp/${id}/${r.account_id}`, false);
  try {
    if (!S.peers.has(id)) S.peers.set(id, await api(`/player/${id}/peers`));
  } catch { /* без кентов переживём */ }
  if (seq !== routeSeq) return;
  const top = (S.peers.get(id) || []).slice().sort((a, b) => b.with_games - a.with_games).slice(0, 16);
  $('#cpeers', box).innerHTML = top.map(r => `<a href="#/cmp/${id}/${r.account_id}"><img src="${esc(r.avatarfull || '')}" alt=""><span>${esc(r.personaname || r.account_id)}</span><span class="muted num">${r.with_games}</span></a>`).join('') || '<span class="muted">Нет данных о кентах</span>';
}

// ─────────────────────────────────────────────────────────────────────────────
// Сравнение двух игроков
// ─────────────────────────────────────────────────────────────────────────────
async function viewCompare(ida, idb, seq) {
  loading('Тяну обоих игроков…');
  const [a, b] = await Promise.all([loadPlayer(ida), loadPlayer(idb)]);
  if (seq !== routeSeq) return;
  const la = filtered(a.list), lb = filtered(b.list);
  const A = agg(la), B = agg(lb);
  const ha = new Map(heroStats(la).map(h => [h.id, h])), hb = new Map(heroStats(lb).map(h => [h.id, h]));
  const bestHero = hs => [...hs.values()].filter(h => h.n >= 15).sort((x, y) => y.score - x.score)[0];
  const topHero = hs => [...hs.values()].sort((x, y) => y.n - x.n)[0];

  // общие матчи — по пересечению match_id, с учётом фильтров
  const together = [], against = [];
  for (const m of la) {
    const o = b.byId.get(m.match_id);
    if (!o) continue;
    (m.radiant === o.radiant ? together : against).push([m, o]);
  }
  const tw = together.filter(([m]) => m.win).length, aw = against.filter(([m]) => m.win).length;

  const row = (k, va, vb, na, nb, hb = true) => {
    const ca = na != null && nb != null && na !== nb ? ((na > nb) === hb ? 'best' : '') : '';
    const cb = na != null && nb != null && na !== nb ? ((nb > na) === hb ? 'best' : '') : '';
    return `<tr><td class="a ${ca}">${va}</td><td class="k">${k}</td><td class="b ${cb}">${vb}</td></tr>`;
  };
  const ba = bestHero(ha), bb = bestHero(hb), ta = topHero(ha), tb = topHero(hb);
  const common = [...ha.keys()].filter(k => hb.has(k) && ha.get(k).n >= 5 && hb.get(k).n >= 5)
    .map(k => [ha.get(k), hb.get(k)]).sort((x, y) => (y[0].n + y[1].n) - (x[0].n + x[1].n)).slice(0, 15);
  const pl = (p, id, cls) => `<a class="pl ${cls}" href="#/p/${id}"><img src="${esc(p.avatar)}" alt=""><div><h3>${esc(p.name)}</h3><div class="muted">${esc(rankName(p.rank_tier))}${p.leaderboard_rank ? ' #' + p.leaderboard_rank : ''}</div></div></a>`;

  app.innerHTML = `<div class="cmp-head">${pl(a, ida, 'a')}<div class="vs">VS</div>${pl(b, idb, 'b')}</div>
  ${filterBar({ list: a.list.concat(b.list) }, 'compare').replace('<span class="fcount"></span>', `<span class="fcount">${fmt(la.length)} vs ${fmt(lb.length)} матчей</span>`)}
  <div class="grid g2">
    <section class="card"><h2>Лоб в лоб</h2>
      <table class="tbl cmp-tbl"><tbody>
        ${row('матчей', fmt(A.n), fmt(B.n), A.n, B.n)}
        ${row('винрейт', pct(A.wr), pct(B.wr), A.wr, B.wr)}
        ${row('KDA', A.kda.toFixed(2), B.kda.toFixed(2), A.kda, B.kda)}
        ${row('убийств', A.k.toFixed(1), B.k.toFixed(1), A.k, B.k)}
        ${row('смертей', A.d.toFixed(1), B.d.toFixed(1), A.d, B.d, false)}
        ${row('ассистов', A.a.toFixed(1), B.a.toFixed(1), A.a, B.a)}
        ${row('GPM', fmt(A.gpm), fmt(B.gpm), A.gpm, B.gpm)}
        ${row('XPM', fmt(A.xpm), fmt(B.xpm), A.xpm, B.xpm)}
        ${row('крипов', fmt(A.lh), fmt(B.lh), A.lh, B.lh)}
        ${row('урон', fmtK(A.dmg), fmtK(B.dmg), A.dmg, B.dmg)}
        ${row('героев', ha.size, hb.size)}
        ${row('главный герой', ta ? esc(ta.name) : '—', tb ? esc(tb.name) : '—')}
        ${row('лучший герой', ba ? `${esc(ba.name)} <span class="muted">${pct(ba.wr, 0)}</span>` : '—', bb ? `<span class="muted">${pct(bb.wr, 0)}</span> ${esc(bb.name)}` : '—')}
      </tbody></table></section>
    <div class="grid" style="align-content:start">
      <section class="card"><h2>Вместе и друг против друга</h2>
        <div class="tiles" style="margin:0">
          <div class="tile"><div class="v num">${fmt(together.length)}</div><div class="l">игр в одной тиме</div><div class="s ${together.length ? wrCls(tw / together.length) : ''}">${together.length ? 'винрейт ' + pct(tw / together.length) : 'не играли'}</div></div>
          <div class="tile"><div class="v num">${fmt(against.length)}</div><div class="l">друг против друга</div><div class="s">${against.length ? `${esc(a.name)}: ${aw} · ${esc(b.name)}: ${against.length - aw}` : 'не пересекались'}</div></div>
        </div></section>
      ${together.length + against.length ? `<section class="card"><h2>Последние общие матчи</h2>
        <table class="tbl"><tbody>${together.concat(against).sort((x, y) => y[0].start_time - x[0].start_time).slice(0, 10).map(([m, o]) => `<tr class="click" data-href="#/m/${m.match_id}/${ida}">
          <td>${heroCell(m.hero_id, '', true)}</td><td class="muted">${m.radiant === o.radiant ? 'вместе' : 'против'}</td><td>${heroCell(o.hero_id, '', true)}</td>
          <td class="${m.win ? 'win' : 'loss'}">${m.win ? 'W' : 'L'}</td><td class="r muted">${ago(m.start_time)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    </div>
  </div>
  ${common.length ? `<section class="card" style="margin-top:16px"><h2>Общие герои <small>5+ игр у обоих</small></h2>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>Герой</th><th class="r">${esc(a.name)}</th><th class="r">винрейт</th><th class="r">KDA</th><th class="r">${esc(b.name)}</th><th class="r">винрейт</th><th class="r">KDA</th><th>Кто лучше</th></tr></thead>
    <tbody>${common.map(([x, y]) => `<tr><td>${heroCell(x.id, '', true)}</td>
      <td class="num r muted">${x.n}</td><td class="num r ${wrCls(x.wr)}">${pct(x.wr)}</td><td class="num r">${x.kda.toFixed(2)}</td>
      <td class="num r muted">${y.n}</td><td class="num r ${wrCls(y.wr)}">${pct(y.wr)}</td><td class="num r">${y.kda.toFixed(2)}</td>
      <td>${esc(x.score >= y.score ? a.name : b.name)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  bindFilters();
  bindRowLinks(app);
}

// ─────────────────────────────────────────────────────────────────────────────
// Матч
// ─────────────────────────────────────────────────────────────────────────────
function impact(p) {
  return (p.kills || 0) * 2 + (p.assists || 0) - (p.deaths || 0) * 1.5 + (p.hero_damage || 0) / 2000
    + (p.tower_damage || 0) / 1000 + (p.hero_healing || 0) / 2000 + (p.net_worth || 0) / 4000;
}
const BENCH = { gold_per_min: 'GPM', xp_per_min: 'XPM', kills_per_min: 'Убийства/мин', last_hits_per_min: 'Крипы/мин',
  hero_damage_per_min: 'Урон/мин', hero_healing_per_min: 'Лечение/мин', tower_damage: 'Урон строениям', stuns_per_min: 'Станы/мин', lhten: 'Крипы к 10 мин' };
const JUNK = new Set(['tpscroll', 'ward_observer', 'ward_sentry', 'ward_dispenser', 'tango', 'flask', 'clarity', 'enchanted_mango',
  'faerie_fire', 'smoke_of_deceit', 'dust', 'branches', 'blood_grenade', 'tango_single', 'famango', 'great_famango', 'greater_famango']);

async function viewMatch(mid, me, seq) {
  loading('Тяну матч…');
  if (!S.matches.has(mid)) S.matches.set(mid, await api('/match/' + mid));
  if (seq !== routeSeq) return;
  const m = S.matches.get(mid);
  if (!m.players || !m.players.length) throw new Error('OpenDota ещё не обработал этот матч. Попробуй позже.');
  const rad = m.players.filter(p => p.isRadiant ?? p.player_slot < 128), dire = m.players.filter(p => !(p.isRadiant ?? p.player_slot < 128));
  const meP = me ? m.players.find(p => p.account_id === me) : null;
  const meWin = meP ? (meP.isRadiant ?? meP.player_slot < 128) === m.radiant_win : null;
  const mvp = side => side.reduce((a, b) => impact(b) > impact(a) ? b : a, side[0]);
  const mvps = new Set([mvp(rad), mvp(dire)].filter(Boolean));
  // пати: одинаковый party_id внутри команды
  const parties = new Map();
  for (const side of [rad, dire]) {
    const g = groupBy(side.filter(p => p.party_size > 1 && p.party_id != null), p => p.party_id);
    let letter = 0;
    for (const [, ps] of g) if (ps.length > 1) { const L = 'ABCDE'[letter++]; ps.forEach(p => parties.set(p, L)); }
  }

  const back = me ? `<a class="btn sm" href="#/p/${me}/matches">‹ к матчам</a>` : `<a class="btn sm" href="javascript:history.back()">‹ назад</a>`;
  const advs = (m.radiant_gold_adv || []).length > 1;
  app.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">${back}
      <span class="muted">Матч <span class="num">${mid}</span></span>
      <span class="spacer" style="flex:1"></span>
      ${m.parsed ? '<span class="badge gold">распарсен</span>' : `<button class="btn sm" id="parse" title="Запросить у OpenDota полный разбор реплея">Запросить парсинг</button>`}
      <a class="btn sm" href="https://www.opendota.com/matches/${mid}" target="_blank">OpenDota ↗</a>
      <a class="btn sm" href="https://www.dotabuff.com/matches/${mid}" target="_blank">Dotabuff ↗</a></div>
    <section class="mhead">
      <div>
        <div class="winner ${meP ? (meWin ? 'win' : 'loss') : (m.radiant_win ? 'win' : 'loss')}">${meP ? (meWin ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ') : (m.radiant_win ? 'Победа Radiant' : 'Победа Dire')}</div>
        ${meP ? `<div class="muted">ты на ${esc(hero(meP.hero_id).name)} · ${m.radiant_win ? 'победили Radiant' : 'победили Dire'}</div>` : ''}
      </div>
      <div class="score"><span class="rad">${m.radiant_score ?? '?'}</span><span class="muted">:</span><span class="dire">${m.dire_score ?? '?'}</span></div>
      <div class="meta">
        <div><span>длительность</span><b class="num">${dur(m.duration)}</b></div>
        <div><span>режим</span>${esc(MODES[m.game_mode] || '?')}</div>
        <div><span>лобби</span>${esc(LOBBIES[m.lobby_type] || '?')}</div>
        <div><span>когда</span>${dateTime(m.start_time)}</div>
        ${m.first_blood_time != null ? `<div><span>первая кровь</span><b class="num">${mmss(m.first_blood_time)}</b></div>` : ''}
        ${m.region != null && S.C.regions[m.region] ? `<div><span>регион</span>${esc(S.C.regions[m.region])}</div>` : ''}
      </div>
    </section>
    ${advs ? `<section class="card" style="margin-top:16px"><h2>Преимущество <span class="r">${seg('adv', [['gold', 'Золото'], ['xp', 'Опыт']], S.adv || 'gold')}</span></h2>
      ${chartBox('adv', 200)}<div class="legend"><span><i style="background:var(--win)"></i>выше нуля: Radiant впереди</span><span><i style="background:var(--loss)"></i>ниже нуля: Dire впереди</span></div></section>` : ''}
    ${matchAnalysis(m, meP)}
    <div id="draftan" style="margin-top:16px"></div>
    ${teamTable('Radiant', 'rad', rad, m.radiant_win, me, mvps, parties)}
    ${teamTable('Dire', 'dire', dire, !m.radiant_win, me, mvps, parties)}
    ${!m.parsed ? '<p class="muted" style="font-size:12px">Матч не распарсен: нет графика золота, закупов и бенчмарков. Жми «Запросить парсинг», через пару минут обнови страницу.</p>' : '<p class="muted" style="font-size:12px">Клик по игроку → закуп, бенчмарки и детали.</p>'}`;

  if (advs) {
    const pushAdv = () => {
      const key = (S.adv || 'gold') === 'gold' ? 'radiant_gold_adv' : 'radiant_xp_adv';
      const arr = m[key] || [];
      S.charts = [{ id: 'adv', type: 'line', title: 'Преимущество', diverge: true, ref: 0, color: 'var(--text-2)', fmtY: fmtK,
        data: arr.map((v, i) => ({ label: i + "'", value: v, tip: `<b>${i}-я минута</b><br>${v >= 0 ? '<span class="win">Radiant</span>' : '<span class="loss">Dire</span>'} +${fmt(Math.abs(v))} ${key.includes('gold') ? 'золота' : 'опыта'}` })) }];
      drawCharts();
    };
    pushAdv();
    $('.seg[data-f="adv"]').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.adv = b.dataset.v; $$('.seg[data-f="adv"] button').forEach(x => x.classList.toggle('on', x === b)); pushAdv(); };
  }
  const pb = $('#parse');
  draftAnalysis(m, meP, seq);
  if (pb) pb.onclick = async () => {
    pb.disabled = true;
    const r = await post('/parse/' + mid).catch(e => ({ ok: false, message: e.message }));
    if (r.ok) { S.matches.delete(mid); toast('Запросил парсинг. Через 1–3 минуты обнови страницу.', 6000); }
    else { toast('Не вышло: ' + esc(r.message || '')); pb.disabled = false; }
  };
  $$('.team tbody').forEach(tb => tb.addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-slot]');
    if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); return; }
    const p = m.players.find(x => x.player_slot === +tr.dataset.slot);
    tr.insertAdjacentHTML('afterend', `<tr class="detail"><td colspan="11">${playerDetail(p, m)}</td></tr>`);
  }));
  // свой ряд сразу раскрываем
  if (meP) { const tr = $(`tr[data-slot="${meP.player_slot}"]`); if (tr) tr.click(); }
}

function itemsCell(p) {
  const main = [0, 1, 2, 3, 4, 5].map(i => p['item_' + i]).map(id => id ? `<img src="${esc(itemImg(id))}" alt="" data-tip="${esc(item(id) ? item(id).name : '')}">` : '<span class="ph"></span>').join('');
  const bp = [0, 1, 2].map(i => p['backpack_' + i]).filter(Boolean).map(id => `<img class="bp" src="${esc(itemImg(id))}" alt="" data-tip="${esc((item(id) || {}).name || '')} (рюкзак)">`).join('');
  const neu = p.item_neutral ? `<img class="neu" src="${esc(itemImg(p.item_neutral))}" alt="" data-tip="${esc((item(p.item_neutral) || {}).name || '')}">` : '';
  const buffs = (p.aghanims_scepter ? '<span class="badge gold" data-tip="Aghanim\'s Scepter">A</span>' : '') + (p.aghanims_shard ? '<span class="badge gold" data-tip="Aghanim\'s Shard">S</span>' : '') + (p.moonshard ? '<span class="badge gold" data-tip="Moon Shard">M</span>' : '');
  return `<div class="items">${main}${neu}${bp ? `<span style="margin-left:6px;display:flex;gap:2px">${bp}</span>` : ''}${buffs}</div>`;
}

function teamTable(name, cls, ps, won, me, mvps, parties) {
  const tot = k => ps.reduce((s, p) => s + (p[k] || 0), 0);
  const rows = ps.sort((a, b) => a.player_slot - b.player_slot).map(p => {
    const nm = p.personaname || p.name || 'Аноним';
    const link = p.account_id ? `<a href="#/p/${p.account_id}" title="Профиль">${esc(nm)}</a>` : `<span class="muted">${esc(nm)}</span>`;
    const tags = (mvps.has(p) ? '<span class="badge gold" data-tip="Грубая оценка вклада: убийства, урон, фарм, лечение">MVP</span>' : '')
      + (parties.has(p) ? `<span class="badge" data-tip="В одной пати">пати ${parties.get(p)}</span>` : '')
      + (p.leaver_status ? '<span class="badge acc" data-tip="Ливнул">ливер</span>' : '')
      + (p.randomed ? '<span class="badge">рандом</span>' : '');
    return `<tr class="click${me && p.account_id === me ? ' me' : ''}" data-slot="${p.player_slot}">
      <td>${heroCell(p.hero_id, `ур. ${p.level ?? '?'}${p.lane_role ? ' · ' + LANES[p.lane_role] : ''}`)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${link}${tags}${p.rank_tier ? `<div class="muted" style="font-size:11px">${esc(rankName(p.rank_tier))}</div>` : ''}</td>
      <td class="num r"><span class="win">${p.kills}</span>/<span class="loss">${p.deaths}</span>/${p.assists}</td>
      <td class="num r" style="color:var(--gold)">${fmtK(p.net_worth)}</td>
      <td class="num r">${p.last_hits}<span class="muted">/${p.denies}</span></td>
      <td class="num r">${p.gold_per_min}<span class="muted">/${p.xp_per_min}</span></td>
      <td class="num r">${fmtK(p.hero_damage)}</td>
      <td class="num r">${fmtK(p.hero_healing)}</td>
      <td class="num r">${fmtK(p.tower_damage)}</td>
      <td>${itemsCell(p)}</td></tr>`;
  }).join('');
  return `<section class="card team ${cls}" style="margin-top:16px">
    <h2><span class="side">${name}</span> ${won ? '<span class="badge gold">победа</span>' : '<span class="badge">слив</span>'}
      <span class="r num">${tot('kills')} убийств · ${fmtK(tot('net_worth'))} нетворс</span></h2>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>Герой</th><th>Игрок</th><th class="r">K/D/A</th><th class="r">NW</th><th class="r">LH/DN</th><th class="r">GPM/XPM</th><th class="r">Урон</th><th class="r">Хил</th><th class="r">Строения</th><th>Предметы</th></tr></thead>
    <tbody>${rows}</tbody></table></div></section>`;
}

function playerDetail(p, m) {
  const parts = [];
  const facts = [];
  if (p.lh_t && p.lh_t.length > 10) facts.push(['Крипы к 10 мин', p.lh_t[10]]);
  if (p.obs_placed != null) facts.push(['Варды obs/sen', `${p.obs_placed}/${p.sen_placed ?? 0}`]);
  if (p.stuns != null) facts.push(['Станы', p.stuns.toFixed(1) + ' с']);
  if (p.teamfight_participation != null) facts.push(['Участие в драках', pct(p.teamfight_participation, 0)]);
  if (p.camps_stacked != null) facts.push(['Стаков', p.camps_stacked]);
  if (p.actions_per_min != null) facts.push(['APM', p.actions_per_min]);
  if (p.buyback_count) facts.push(['Байбэков', p.buyback_count]);
  if (p.rune_pickups != null) facts.push(['Рун', p.rune_pickups]);
  if (p.tower_kills) facts.push(['Снёс башен', p.tower_kills]);
  if (p.roshan_kills) facts.push(['Рошанов', p.roshan_kills]);
  if (facts.length) parts.push(`<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));margin-bottom:12px">${facts.map(([l, v]) => `<div class="tile" style="padding:8px 10px"><div class="v num" style="font-size:17px">${v}</div><div class="l">${l}</div></div>`).join('')}</div>`);
  if (p.benchmarks) {
    parts.push(`<div class="muted" style="font-size:12px;margin-bottom:6px">Бенчмарки: лучше скольких процентов игроков на этом герое</div><div class="bench">${Object.entries(BENCH).filter(([k]) => p.benchmarks[k]).map(([k, n]) => {
      const b = p.benchmarks[k], v = b.pct || 0;
      return `<div class="row"><span>${n} <span class="muted num">${typeof b.raw === 'number' ? (b.raw < 10 ? b.raw.toFixed(2) : fmt(b.raw)) : ''}</span></span><span class="num ${v >= 0.6 ? 'win' : v < 0.4 ? 'loss' : ''}">${pct(v, 0)}</span><span class="bar"><i class="${v >= 0.6 ? 'win' : v < 0.4 ? 'loss' : ''}" style="width:${v * 100}%"></i></span></div>`;
    }).join('')}</div>`);
  }
  if (p.purchase_log && p.purchase_log.length) {
    const byKey = new Map(Object.values(S.C.items).map(it => [it.key, it]));
    const log = p.purchase_log.filter(x => !JUNK.has(x.key) && !x.key.startsWith('recipe_')).map(x => {
      const it = byKey.get(x.key);
      return it && it.img ? `<div data-tip="${esc(it.name)}"><img src="${CDN + esc(it.img)}" alt=""><span>${mmss(x.time)}</span></div>` : '';
    }).join('');
    if (log) parts.push(`<div class="muted" style="font-size:12px;margin-top:12px">Закуп по времени</div><div class="plog">${log}</div>`);
  }
  if (!parts.length) return '<span class="muted">Деталей нет: матч не распарсен.</span>';
  return parts.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Поиск
// ─────────────────────────────────────────────────────────────────────────────
function attachSearch(input, drop, hrefFor, allowMatch = true) {
  let t, sel = -1, items = [];
  const render = () => {
    drop.innerHTML = items.length ? items.map((r, i) => `<a href="${r.href}" class="${i === sel ? 'sel' : ''}">${r.img ? `<img src="${esc(r.img)}" alt="">` : '<span style="width:28px;text-align:center">#</span>'}<span>${esc(r.title)}${r.sub ? `<div class="muted" style="font-size:11px">${esc(r.sub)}</div>` : ''}</span></a>`).join('') : '<div class="empty">Никого не нашёл</div>';
    drop.classList.add('open');
  };
  const run = async () => {
    const q = input.value.trim();
    if (!q) { drop.classList.remove('open'); return; }
    items = [];
    const digits = q.replace(/\D/g, '');
    if (/^\d+$/.test(q)) {
      const aid = (await api('/resolve?q=' + q)).account_id;
      if (aid) items.push({ href: hrefFor({ account_id: aid }), title: `Игрок ${aid}`, sub: 'открыть профиль по ID' });
      if (allowMatch && digits.length >= 9) items.push({ href: `#/m/${q}${S.cfg.account_id ? '/' + S.cfg.account_id : ''}`, title: `Матч ${q}`, sub: 'открыть разбор матча' });
    } else {
      const m = q.match(/matches\/(\d+)/);
      if (m && allowMatch) items.push({ href: `#/m/${m[1]}${S.cfg.account_id ? '/' + S.cfg.account_id : ''}`, title: `Матч ${m[1]}`, sub: 'из ссылки' });
      else {
        try {
          const rs = await api('/search?q=' + encodeURIComponent(q));
          items = rs.filter(r => r.account_id).map(r => ({ href: hrefFor(r), title: r.personaname || ('ID ' + r.account_id), sub: `ID ${r.account_id}${r.last_match_time ? ' · играл ' + ago(Date.parse(r.last_match_time) / 1000) : ''}`, img: r.avatarfull }));
        } catch (e) { items = []; }
      }
    }
    if (input.value.trim() !== q) return;
    sel = items.length ? 0 : -1;
    render();
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  input.addEventListener('keydown', e => {
    if (!drop.classList.contains('open')) { if (e.key === 'Enter') run(); return; }
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) { location.hash = items[sel].href; drop.classList.remove('open'); input.blur(); }
    else if (e.key === 'Escape') { drop.classList.remove('open'); input.blur(); }
  });
  drop.addEventListener('click', () => { drop.classList.remove('open'); input.value = ''; });
  document.addEventListener('click', e => { if (!drop.contains(e.target) && e.target !== input) drop.classList.remove('open'); });
}

// хоткей: / — фокус в поиск
document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
});

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  attachSearch($('#q'), $('#drop'), r => `#/p/${r.account_id}`);
  $('#q').addEventListener('focus', () => showRecent($('#q'), $('#drop')));
  $('#q').addEventListener('input', () => { if (!$('#q').value.trim()) showRecent($('#q'), $('#drop')); });
  try { S.cfg = await api('/config'); } catch { S.cfg = {}; }
  try { await steamReturn(); } catch (e) { toast(esc(e.message)); }
  // ставится как приложение (PWA); на локальном сервере тоже работает
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  route();
})();
