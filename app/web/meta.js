'use strict';
/* Мета героев: про-сцена, паблик по рангам, турбо. Страница героя с контрпиками и закупом.
   Плюс вкладка «Матчапы» у игрока и сравнение его героев с метой его ранга.
   Грузится после app.js и пользуется его хелперами. */

const BRACKETS = [['pro', 'Про-сцена'], ['all', 'Все паблики'], ['1', 'Herald'], ['2', 'Guardian'], ['3', 'Crusader'],
  ['4', 'Archon'], ['5', 'Legend'], ['6', 'Ancient'], ['7', 'Divine'], ['8', 'Immortal'], ['turbo', 'Турбо']];
const TIERS = ['S', 'A', 'B', 'C', 'D'];
const ATTRS = [['', 'Все'], ['str', 'Сила'], ['agi', 'Ловка'], ['int', 'Инта'], ['all', 'Универсалы']];
const ROLES_RU = { Carry: 'Керри', Support: 'Саппорт', Nuker: 'Нюкер', Disabler: 'Контроль', Jungler: 'Лесник',
  Durable: 'Танк', Escape: 'Эскейп', Pusher: 'Пушер', Initiator: 'Инициатор' };

S.meta = null;
S.metaOpt = Object.assign({ src: 'pro', attr: '', role: '', q: '', sort: 'tier', asc: false }, lsGet('metaOpt') || {});
S.pheroes = new Map();

async function loadMeta(soft = false) {
  if (S.meta) return S.meta;
  try {
    const m = await api('/meta');
    S.meta = { byId: new Map(m.heroes.map(h => [h.id, h])), list: m.heroes };
    return S.meta;
  } catch (e) {
    if (soft) return null; // мета — бонус, без неё страница игрока всё равно живёт
    throw e;
  }
}

// пики/победы героя в выбранном источнике
function srcPW(h, src) {
  if (src === 'pro') return [h.pro_pick, h.pro_win];
  if (src === 'turbo') return [h.turbo_picks, h.turbo_wins];
  if (src === 'all') {
    let p = 0, w = 0;
    for (let b = 1; b <= 8; b++) { p += h[b + '_pick']; w += h[b + '_win']; }
    return [p, w];
  }
  return [h[src + '_pick'], h[src + '_win']];
}

const brName = src => (BRACKETS.find(b => b[0] === String(src)) || [, src])[1];
const myBracket = p => p && p.rank_tier ? String(Math.min(8, Math.floor(p.rank_tier / 10))) : 'all';

// Считает пикрейт, винрейт, тир. Тир = перцентиль смеси «надёжный винрейт» + популярность.
function metaRows(src) {
  const rows = S.meta.list.filter(h => S.C.heroes[h.id]).map(h => {
    const [n, w] = srcPW(h, src);
    return { id: h.id, n, w, wr: n ? w / n : 0, ban: src === 'pro' ? h.pro_ban : 0, score: wilson(w, n) };
  });
  const games = rows.reduce((s, r) => s + r.n, 0) / 10 || 1;
  for (const r of rows) {
    r.pr = r.n / games;
    r.contest = (r.n + r.ban) / games;
  }
  const pctRank = key => {
    const sorted = [...rows].sort((a, b) => a[key] - b[key]);
    sorted.forEach((r, i) => { r['p_' + key] = sorted.length > 1 ? i / (sorted.length - 1) : 0.5; });
  };
  pctRank('score'); pctRank(src === 'pro' ? 'contest' : 'pr');
  for (const r of rows) {
    r.meta = src === 'pro' ? 0.5 * r.p_score + 0.5 * r.p_contest : 0.65 * r.p_score + 0.35 * r.p_pr;
  }
  const byMeta = [...rows].sort((a, b) => b.meta - a.meta);
  const cut = [0.08, 0.25, 0.55, 0.8];
  byMeta.forEach((r, i) => {
    const q = i / byMeta.length;
    r.tier = q < cut[0] ? 0 : q < cut[1] ? 1 : q < cut[2] ? 2 : q < cut[3] ? 3 : 4;
    r.rank = i + 1;
  });
  return { rows, games };
}

function tierBadge(t) { return `<span class="tier t${t}">${TIERS[t]}</span>`; }

function me() { return S.cfg.account_id ? S.players.get(S.cfg.account_id) : null; }

// ─────────────────────────────────────────────────────────────────────────────
// Страница меты
// ─────────────────────────────────────────────────────────────────────────────
async function viewMeta(seq) {
  if (!S.meta) loading('Тяну мету с OpenDota…');
  await loadMeta();
  if (seq !== routeSeq) return;
  // свой профиль подгружаем в фоне, чтоб показать «ты на этом герое»
  if (S.cfg.account_id && !S.players.has(S.cfg.account_id)) {
    loadPlayer(S.cfg.account_id).then(() => { if (location.hash.startsWith('#/meta') && seq === routeSeq) renderMeta(); }).catch(() => {});
  }
  renderMeta();
  // последние про-матчи — отдельно, не держим из-за них страницу
  api('/promatches').then(rows => {
    const el = $('#promatches');
    if (!el || seq !== routeSeq) return;
    el.innerHTML = rows.length ? rows.map(m => `<a class="pm" href="#/m/${m.match_id}">
      <span class="${m.radiant_win ? 'win' : ''}">${esc(m.radiant_name || 'Radiant')}</span>
      <span class="num sc">${m.radiant_score ?? '?'}:${m.dire_score ?? '?'}</span>
      <span class="${m.radiant_win ? '' : 'win'}">${esc(m.dire_name || 'Dire')}</span>
      <small class="muted">${esc(m.league_name || '')} · ${dur(m.duration)} · ${ago(m.start_time)}</small></a>`).join('')
      : '<div class="muted">Пусто</div>';
  }).catch(e => { const el = $('#promatches'); if (el) el.innerHTML = `<div class="muted">${esc(e.message)}</div>`; });
}

const META_COLS = [['tier', 'Тир'], ['n', 'Пиков'], ['pr', 'Пикрейт'], ['wr', 'Винрейт'], ['ban', 'Банов'], ['contest', 'Контест'], ['mine', 'Ты']];

function renderMeta() {
  const o = S.metaOpt;
  const { rows, games } = metaRows(o.src);
  const mine = me();
  const myHs = mine ? new Map(heroStats(mine.list).map(h => [h.id, h])) : null;
  const q = o.q.toLowerCase();
  let list = rows.filter(r => {
    const h = hero(r.id);
    if (o.attr && h.attr !== o.attr) return false;
    if (o.role && !(h.roles || []).includes(o.role)) return false;
    if (q && !h.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const val = (r, k) => k === 'tier' ? r.meta : k === 'mine' ? (myHs && myHs.get(r.id) ? myHs.get(r.id).n : -1) : r[k];
  list.sort((a, b) => (o.asc ? 1 : -1) * (val(a, o.sort) - val(b, o.sort)) || a.rank - b.rank);
  const cols = META_COLS.filter(([k]) => (o.src === 'pro' || !['ban', 'contest'].includes(k)) && (k !== 'mine' || myHs));
  const maxPr = Math.max(...rows.map(r => o.src === 'pro' ? r.contest : r.pr), 0.0001);

  // кратко: топ-3 по тиру и самые контестящиеся
  const top = [...rows].sort((a, b) => a.rank - b.rank).slice(0, 5);
  const myBr = mine ? myBracket(mine) : null;

  const cell = (r, k) => {
    if (k === 'tier') return `<td>${tierBadge(r.tier)}</td>`;
    if (k === 'n') return `<td class="num r">${fmt(r.n)}</td>`;
    if (k === 'pr') return `<td><div class="cellbar"><span class="num">${pct(r.pr)}</span><span class="bar"><i style="width:${(r.pr / maxPr * 100).toFixed(1)}%;background:var(--gold)"></i></span></div></td>`;
    if (k === 'wr') return `<td><div class="cellbar"><span class="num ${wrCls(r.wr)}">${r.n ? pct(r.wr) : '—'}</span><span class="bar"><i class="${wrCls(r.wr)}" style="width:${(r.wr * 100).toFixed(1)}%"></i></span></div></td>`;
    if (k === 'ban') return `<td class="num r">${fmt(r.ban)}</td>`;
    if (k === 'contest') return `<td><div class="cellbar"><span class="num">${pct(r.contest)}</span><span class="bar"><i style="width:${(r.contest / maxPr * 100).toFixed(1)}%;background:var(--accent)"></i></span></div></td>`;
    if (k === 'mine') {
      const h = myHs.get(r.id);
      return h ? `<td class="r num" data-tip="Твои ${h.n} ${plural(h.n, 'игра', 'игры', 'игр')} на герое"><span class="${wrCls(h.wr)}">${pct(h.wr, 0)}</span> <span class="muted">· ${h.n}</span></td>` : '<td class="r muted">—</td>';
    }
    return '<td></td>';
  };

  app.innerHTML = `<section class="mhero-head">
      <div><h1>Мета героев</h1>
      <div class="muted">${o.src === 'pro' ? `Про-матчи за последний период · ≈${fmt(games)} ${plural(Math.round(games), 'игра', 'игры', 'игр')}` : `${brName(o.src)} · ≈${fmt(games)} ${plural(Math.round(games), 'игра', 'игры', 'игр')} за неделю`} · данные OpenDota</div></div>
      <button class="btn primary" id="pickme" title="Сильный герой твоего ранга, на котором ты почти не играл">🎲 Что пикнуть?</button>
      <div class="top5">${top.map(r => `<a href="#/meta/${r.id}" data-tip="<b>${esc(hero(r.id).name)}</b><br>Тир ${TIERS[r.tier]} · WR ${pct(r.wr)} · ${o.src === 'pro' ? 'контест ' + pct(r.contest) : 'пикрейт ' + pct(r.pr)}"><img src="${esc(heroImg(r.id))}" alt="">${tierBadge(r.tier)}</a>`).join('')}</div>
    </section>
    <div class="filters">
      <div class="seg" id="msrc">${BRACKETS.map(([v, l]) => `<button data-v="${v}" class="${o.src === v ? 'on' : ''}">${l}${myBr === v ? ' ◉' : ''}</button>`).join('')}</div>
    </div>
    <div class="filters">
      <div class="seg" id="mattr">${ATTRS.map(([v, l]) => `<button data-v="${v}" class="${o.attr === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="mrole"><option value="">Любая роль</option>${Object.entries(ROLES_RU).map(([k, n]) => `<option value="${k}" ${o.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input class="inp" id="mq" placeholder="Найти героя…" value="${esc(o.q)}" style="width:200px">
      <span class="fcount">${list.length} ${plural(list.length, 'герой', 'героя', 'героев')}</span>
    </div>
    <div class="grid g-main">
      <section class="card">
        <div class="scroll-x"><table class="tbl" id="mtbl">
          <thead><tr><th class="r">#</th><th>Герой</th>${cols.map(([k, n]) => `<th class="sortable${['wr', 'pr', 'contest', 'tier'].includes(k) ? '' : ' r'}${o.sort === k ? ' sorted' + (o.asc ? ' asc' : '') : ''}" data-k="${k}">${n}</th>`).join('')}</tr></thead>
          <tbody>${list.map(r => `<tr class="click" data-href="#/meta/${r.id}"><td class="num r muted">${r.rank}</td><td>${heroCell(r.id, esc((hero(r.id).roles || []).slice(0, 3).map(x => ROLES_RU[x] || x).join(' · ')))}</td>${cols.map(([k]) => cell(r, k)).join('')}</tr>`).join('') || '<tr><td colspan="9" class="empty-state">Никого под фильтр</td></tr>'}</tbody>
        </table></div>
        <p class="muted" style="font-size:12px;margin:12px 0 0">Тир — смесь надёжного винрейта (нижняя граница Вилсона, чтоб героя с 3 играми не задирало)
          и популярности${o.src === 'pro' ? ' (пики + баны: на про-сцене бан тоже значит «герой имба»)' : ''}. S — топ-8%, A — до 25%, B — до 55%, C — до 80%, остальные D.</p>
      </section>
      <div class="grid" style="align-content:start">
        ${mine ? metaForMe(mine) : `<section class="card"><h2>Ты в мете</h2><div class="muted">Укажи свой ID (кнопка «Я» сверху) — покажу, какие мета-герои у тебя заходят, а какие ты зря игноришь.</div></section>`}
        <section class="card"><h2>Последние про-матчи</h2><div id="promatches" class="pms"><div class="muted">Гружу…</div></div></section>
      </div>
    </div>`;

  $('#pickme').onclick = pickForMe;
  const save = () => { o.touched = true; lsSet('metaOpt', o); renderMeta(); };
  $('#msrc').onclick = e => { const b = e.target.closest('button'); if (b) { o.src = b.dataset.v; save(); } };
  $('#mattr').onclick = e => { const b = e.target.closest('button'); if (b) { o.attr = b.dataset.v; save(); } };
  $('#mrole').onchange = e => { o.role = e.target.value; save(); };
  const mq = $('#mq');
  mq.oninput = () => { o.q = mq.value; const pos = mq.selectionStart; renderMeta(); const n = $('#mq'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('#mtbl th.sortable').forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    o.asc = o.sort === k ? !o.asc : false;
    o.sort = k;
    save();
  });
  bindRowLinks(app);
}

// карточка «ты в мете» — в мете твоего ранга
function metaForMe(p) {
  const br = myBracket(p);
  const { rows } = metaRows(br);
  const byId = new Map(rows.map(r => [r.id, r]));
  const hs = heroStats(p.list.filter(m => m.start_time > Date.now() / 1000 - 365 * DAY));
  const myById = new Map(hs.map(h => [h.id, h]));
  // S/A-тир твоего ранга, на которых у тебя меньше 3 игр за год
  const missing = rows.filter(r => r.tier <= 1 && !(myById.get(r.id) && myById.get(r.id).n >= 3)).sort((a, b) => a.rank - b.rank).slice(0, 8);
  // твои мейны, которые в мете проседают
  const mains = hs.filter(h => h.n >= 10).sort((a, b) => b.n - a.n).slice(0, 8).map(h => ({ h, r: byId.get(h.id) })).filter(x => x.r);
  return `<section class="card">
    <h2>Ты в мете <small>${esc(brName(br))}, твои игры за год</small></h2>
    ${mains.length ? `<div class="muted" style="font-size:12px;margin-bottom:6px">Твои мейны и их тир сейчас</div>
      <div class="mylist">${mains.map(({ h, r }) => `<a href="#/meta/${h.id}" data-tip="<b>${esc(hero(h.id).name)}</b><br>У тебя ${pct(h.wr)} на ${h.n} играх<br>В среднем на ${esc(brName(br))}: ${pct(r.wr)}">
        <img src="${esc(heroImg(h.id))}" alt="">${tierBadge(r.tier)}<span class="num ${wrCls(h.wr)}">${pct(h.wr, 0)}</span></a>`).join('')}</div>` : ''}
    ${missing.length ? `<div class="muted" style="font-size:12px;margin:12px 0 6px">Имба твоего ранга, которую ты почти не трогаешь</div>
      <div class="mylist">${missing.map(r => `<a href="#/meta/${r.id}" data-tip="<b>${esc(hero(r.id).name)}</b><br>Тир ${TIERS[r.tier]} · WR ${pct(r.wr)} · пикрейт ${pct(r.pr)}"><img src="${esc(heroImg(r.id))}" alt="">${tierBadge(r.tier)}</a>`).join('')}</div>` : ''}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Страница героя в мете
// ─────────────────────────────────────────────────────────────────────────────
async function viewMetaHero(hid, seq) {
  loading('Тяну контрпики и закуп…');
  const [, d] = await Promise.all([loadMeta(), api('/meta/hero/' + hid)]);
  if (seq !== routeSeq) return;
  const h = hero(hid);
  const m = S.meta.byId.get(hid);
  if (!m) { app.innerHTML = '<div class="err"><h3>Такого героя нет в мете</h3><a class="btn" href="#/meta">К мете</a></div>'; return; }
  const pro = metaRows('pro').rows.find(r => r.id === hid);
  const pub = metaRows('all').rows.find(r => r.id === hid);
  const turbo = metaRows('turbo').rows.find(r => r.id === hid);
  const mine = me();
  const myGames = mine ? mine.list.filter(x => x.hero_id === hid) : [];
  const my = myGames.length ? agg(myGames) : null;
  const myBr = mine ? myBracket(mine) : null;

  // контрпики (про-матчи): кого бьёт / от кого страдает, с поправкой на выборку
  const mu = (d.matchups || []).filter(x => x.hero_id !== hid && x.games_played >= 5 && S.C.heroes[x.hero_id]).map(x => ({
    id: x.hero_id, n: x.games_played, w: x.wins, wr: x.wins / x.games_played,
    good: wilson(x.wins, x.games_played), bad: wilson(x.games_played - x.wins, x.games_played) }));
  const beats = [...mu].sort((a, b) => b.good - a.good).slice(0, 8);
  const loses = [...mu].sort((a, b) => b.bad - a.bad).slice(0, 8);
  const muList = (arr, good) => arr.length ? arr.map(x => `<a class="mu" href="#/meta/${x.id}">${heroCell(x.id, `${x.n} ${plural(x.n, 'игра', 'игры', 'игр')}`, true)}<span class="num ${good ? 'win' : 'loss'}">${pct(x.wr)}</span></a>`).join('')
    : '<div class="muted">Мало про-игр для выводов</div>';

  // закуп по фазам
  const PH = [['start_game_items', 'Старт'], ['early_game_items', 'Ранняя'], ['mid_game_items', 'Мид'], ['late_game_items', 'Лейт']];
  const items = PH.map(([k, n]) => {
    const o = (d.items || {})[k] || {};
    const tot = Object.values(o).reduce((s, v) => s + v, 0) || 1;
    const top = Object.entries(o).filter(([id]) => item(+id)).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return top.length ? `<div class="iph"><div class="muted">${n}</div><div class="irow">${top.map(([id, c]) => `<div data-tip="<b>${esc(item(+id).name)}</b><br>${fmt(c)} раз · ${pct(c / tot, 0)} закупов фазы"><img src="${esc(itemImg(+id))}" alt=""></div>`).join('')}</div></div>` : '';
  }).join('');

  // графики: винрейт по рангам и по длительности
  const brData = [];
  for (let b = 1; b <= 8; b++) {
    const n = m[b + '_pick'], w = m[b + '_win'];
    brData.push({ label: MEDALS[b].slice(0, 4), value: n ? w / n : null, color: String(b) === myBr ? 'var(--accent-hi)' : (n && w / n >= 0.5 ? 'var(--win)' : 'var(--loss)'),
      tip: `<b>${MEDALS[b]}</b><br>WR ${n ? pct(w / n) : '—'} · ${fmt(n)} ${plural(n, 'пик', 'пика', 'пиков')}${String(b) === myBr ? '<br><span class="k">твой ранг</span>' : ''}` });
  }
  const brVals = brData.map(x => x.value).filter(v => v != null);
  S.charts.push({ id: 'mbr', type: 'bar', title: 'Винрейт по рангам', yMin: Math.min(0.45, ...brVals.map(v => v - 0.02)), yMax: Math.max(0.55, ...brVals.map(v => v + 0.02)), ref: 0.5, fmtY: v => Math.round(v * 100) + '%', data: brData });
  const durs = (d.durations || []).map(x => ({ min: Math.round(+x.duration_bin >= 200 ? +x.duration_bin / 60 : +x.duration_bin), n: x.games_played, w: x.wins }))
    .filter(x => x.n >= 3 && x.min >= 10 && x.min <= 80).sort((a, b) => a.min - b.min);
  if (durs.length >= 3) {
    S.charts.push({ id: 'mdur', type: 'bar', title: 'Винрейт по длительности', yMin: 0, yMax: 1, ref: 0.5, fmtY: v => Math.round(v * 100) + '%', labelW: 30,
      data: durs.map(x => ({ label: x.min + '′', value: x.w / x.n, color: x.w / x.n >= 0.5 ? 'var(--win)' : 'var(--loss)', tip: `<b>${x.min}–${x.min + 5} мин</b><br>WR ${pct(x.w / x.n)} · ${x.n} ${plural(x.n, 'игра', 'игры', 'игр')}` })) });
  }

  app.innerHTML = `<a class="btn sm" href="#/meta">‹ к мете</a>
    <section class="phead" style="margin-top:12px">
      <img class="ava" src="${esc(heroImg(hid))}" alt="" style="width:150px;height:84px">
      <div class="who"><h1>${esc(h.name)}</h1>
        <div class="sub"><span>${esc((h.roles || []).map(x => ROLES_RU[x] || x).join(' · '))}</span><span>${h.attack === 'Melee' ? 'Ближний бой' : 'Дальний бой'}</span>
        <a href="https://www.dotabuff.com/heroes/${esc(h.key.replace(/_/g, '-'))}" target="_blank">Dotabuff ↗</a></div></div>
      <div class="stats">
        <div class="stat"><div class="v">${tierBadge(pro.tier)}</div><div class="l">тир про</div></div>
        <div class="stat"><div class="v">${tierBadge(pub.tier)}</div><div class="l">тир паблик</div></div>
        ${myBr ? `<div class="stat"><div class="v">${tierBadge(metaRows(myBr).rows.find(r => r.id === hid).tier)}</div><div class="l">на твоём ранге</div></div>` : ''}
      </div>
    </section>
    <div class="tiles" style="margin-top:16px">
      <div class="tile"><div class="v num">${fmt(pro.n)}</div><div class="l">про-пиков</div><div class="s">#${pro.rank} в мете</div></div>
      <div class="tile"><div class="v num ${wrCls(pro.wr)}">${pro.n ? pct(pro.wr) : '—'}</div><div class="l">WR на про</div><div class="s">${fmt(pro.w)}–${fmt(pro.n - pro.w)}</div></div>
      <div class="tile"><div class="v num">${fmt(pro.ban)}</div><div class="l">про-банов</div><div class="s">контест ${pct(pro.contest)}</div></div>
      <div class="tile"><div class="v num ${wrCls(pub.wr)}">${pct(pub.wr)}</div><div class="l">WR в пабах</div><div class="s">пикрейт ${pct(pub.pr)}</div></div>
      <div class="tile"><div class="v num ${wrCls(turbo.wr)}">${turbo.n ? pct(turbo.wr) : '—'}</div><div class="l">WR в турбо</div><div class="s">${fmt(turbo.n)} игр</div></div>
      ${my ? `<div class="tile"><div class="v num ${wrCls(my.wr)}">${pct(my.wr)}</div><div class="l">твой WR</div><div class="s"><a href="#/p/${S.cfg.account_id}/matches" id="mymatches">${my.n} ${plural(my.n, 'игра', 'игры', 'игр')} →</a></div></div>`
        : `<div class="tile"><div class="v num muted">—</div><div class="l">твой WR</div><div class="s">${mine ? 'ни разу не брал' : 'укажи свой ID'}</div></div>`}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <section class="card"><h2>Винрейт по рангам <small>паблики, неделя</small></h2>${chartBox('mbr', 190)}</section>
      <section class="card"><h2>Винрейт по длительности <small>про-матчи</small></h2>${durs.length >= 3 ? chartBox('mdur', 190) : '<div class="empty-state">Мало про-игр</div>'}</section>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <section class="card"><h2>Кого контрит <small>про-матчи, против кого винрейт выше</small></h2><div class="mus">${muList(beats, true)}</div></section>
      <section class="card"><h2>Кто контрит его <small>против кого сливает</small></h2><div class="mus">${muList(loses, false)}</div></section>
    </div>
    <section class="card" style="margin-top:16px"><h2>Что собирают <small>про-матчи, по фазам игры</small></h2>${items || '<div class="muted">Нет данных по закупу</div>'}</section>
    ${my && my.n >= 3 ? `<section class="card" style="margin-top:16px"><h2>Ты против всех <small>на этом герое</small></h2>
      <div class="tiles">
        <div class="tile"><div class="v num">${my.kda.toFixed(2)}</div><div class="l">KDA</div><div class="s num">${my.k.toFixed(1)} / ${my.d.toFixed(1)} / ${my.a.toFixed(1)}</div></div>
        <div class="tile"><div class="v num">${fmt(my.gpm)}</div><div class="l">GPM</div><div class="s">XPM ${fmt(my.xpm)}</div></div>
        <div class="tile"><div class="v num">${fmt(my.lh)}</div><div class="l">крипов</div><div class="s">в среднем</div></div>
        <div class="tile"><div class="v num ${my.wr - (myBr ? srcWr(m, myBr) : pub.wr) >= 0 ? 'win' : 'loss'}">${signPct(my.wr - (myBr ? srcWr(m, myBr) : pub.wr))}</div><div class="l">vs средний ${esc(brName(myBr || 'all'))}</div><div class="s">${pct(myBr ? srcWr(m, myBr) : pub.wr)} у всех</div></div>
      </div></section>` : ''}`;
  const mm = $('#mymatches');
  if (mm) mm.onclick = () => { S.filters.hero = String(hid); S.page = 0; lsSet('filters', S.filters); };
  drawCharts();
}

function srcWr(h, src) { const [n, w] = srcPW(h, src); return n ? w / n : 0; }
function signPct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1); }

// ─────────────────────────────────────────────────────────────────────────────
// Вкладка игрока «Матчапы»: против каких героев сливаешь, с кем в тиме заходит
// ─────────────────────────────────────────────────────────────────────────────
async function tabMatchups(box, p, _list, id, seq) {
  const f = S.filters;
  const qs = new URLSearchParams();
  if (f.period !== 'all') qs.set('date', f.period);
  if (f.mode === 'ranked') qs.set('lobby_type', '7');
  if (f.mode === 'turbo') qs.set('game_mode', '23');
  if (f.mode === 'normal') { qs.set('lobby_type', '0'); qs.set('game_mode', '22'); }
  if (f.hero) qs.set('hero_id', f.hero);
  if (f.lane) qs.set('lane_role', f.lane);
  const key = id + '?' + qs;
  if (!S.pheroes.has(key)) {
    box.innerHTML = '<div class="loading"><div class="spin"></div><div>Считаю матчапы…</div></div>';
    S.pheroes.set(key, await api(`/player/${id}/heroes?${qs}`));
    if (seq !== routeSeq) return;
  }
  const rows = S.pheroes.get(key).filter(r => S.C.heroes[r.hero_id]);
  const minN = S.muMin || 5;
  const mk = (g, wk) => rows.filter(r => r[g] >= minN).map(r => { const n = r[g], w = Math.min(n, r[wk] || 0);
    return { id: r.hero_id, n, w, wr: w / n, good: wilson(w, n), bad: wilson(n - w, n) }; });
  const vs = mk('against_games', 'against_win'), wt = mk('with_games', 'with_win');
  // в «хорошие» только выше 50%, в «плохие» только ниже — чтоб один герой не торчал в обоих списках
  const top = (arr, k) => arr.filter(x => k === 'good' ? x.wr > 0.5 : x.wr < 0.5).sort((a, b) => b[k] - a[k]).slice(0, 10);
  const list = (arr, good, tipWord) => arr.length ? `<table class="tbl"><tbody>${arr.map(x => `<tr class="click" data-href="#/meta/${x.id}" data-tip="${tipWord} <b>${esc(hero(x.id).name)}</b>: ${x.w}–${x.n - x.w}">
      <td>${heroCell(x.id, '', true)}</td><td class="num r muted">${x.n}</td>
      <td style="width:45%"><div class="cellbar"><span class="num ${wrCls(x.wr)}">${pct(x.wr)}</span><span class="bar"><i class="${wrCls(x.wr)}" style="width:${(x.wr * 100).toFixed(1)}%"></i></span></div></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty-state">Нет героев с ${minN}+ играми</div>`;
  const allVs = vs.reduce((s, x) => s + x.n, 0);
  box.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <label class="muted">мин. игр</label>
      <select id="mumin">${[3, 5, 10, 20, 50].map(n => `<option ${n === minN ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="muted" style="font-size:12px">Сортировка по надёжности (Вилсон), а не голому проценту · клик по герою → его мета</span>
    </div>
    <div class="grid g2">
      <section class="card"><h2>Об кого убиваешься <small>враг в другой тиме</small></h2>${list(top(vs, 'bad'), false, 'Против')}</section>
      <section class="card"><h2>Кого фармишь <small>враг в другой тиме</small></h2>${list(top(vs, 'good'), true, 'Против')}</section>
      <section class="card"><h2>С кем заходит <small>герой в твоей тиме</small></h2>${list(top(wt, 'good'), true, 'Вместе с')}</section>
      <section class="card"><h2>С кем не клеится <small>герой в твоей тиме</small></h2>${list(top(wt, 'bad'), false, 'Вместе с')}</section>
    </div>
    ${allVs ? '' : '<p class="muted">OpenDota не отдал матчапы под эти фильтры.</p>'}`;
  $('#mumin', box).onchange = e => { S.muMin = +e.target.value; tabMatchups(box, p, _list, id, seq); };
  bindRowLinks(box);
}

// ─────────────────────────────────────────────────────────────────────────────
// «Против меты» — для обзора и таблицы героев игрока
// ─────────────────────────────────────────────────────────────────────────────
// Дельта твоего винрейта к среднему на твоём ранге (по каждому герою)
function metaDelta(p) {
  if (!S.meta) return null;
  const br = myBracket(p);
  return { br, of: hid => { const h = S.meta.byId.get(hid); return h ? srcWr(h, br) : null; } };
}

function vsMetaCard(p, list) {
  const md = metaDelta(p);
  if (!md) return '';
  const hs = heroStats(list).filter(h => h.n >= 10).map(h => {
    const base = md.of(h.id);
    return base == null ? null : Object.assign(h, { base, delta: h.wr - base, dScore: h.score - base });
  }).filter(Boolean);
  if (hs.length < 2) return '';
  const best = [...hs].sort((a, b) => b.dScore - a.dScore).slice(0, 4);
  const worst = [...hs].sort((a, b) => a.delta - b.delta).filter(h => h.delta < 0).slice(0, 4);
  const row = h => `<a href="#/meta/${h.id}" class="vm" data-tip="<b>${esc(hero(h.id).name)}</b><br>У тебя ${pct(h.wr)} на ${h.n} играх<br>Средний ${esc(brName(md.br))}: ${pct(h.base)}">
    ${heroCell(h.id, `${h.n} ${plural(h.n, 'игра', 'игры', 'игр')}`, true)}<span class="num ${h.delta >= 0 ? 'win' : 'loss'}">${signPct(h.delta)}</span></a>`;
  return `<section class="card">
    <h2>Ты против меты <small>vs средний ${esc(brName(md.br))}</small></h2>
    <div class="muted" style="font-size:12px;margin-bottom:4px">Тащишь лучше остальных</div>${best.map(row).join('')}
    ${worst.length ? `<div class="muted" style="font-size:12px;margin:10px 0 4px">Играешь хуже среднего</div>${worst.map(row).join('')}` : ''}
  </section>`;
}
