'use strict';
/* Вкладка «Цели»: свои цели на неделю/месяц/последние 20 игр + автоподсказки по слабым местам.
   Цели хранятся в браузере (localStorage) для каждого игрока отдельно. */

const GOAL_METRICS = {
  wr: { name: 'Винрейт', fmt: v => pct(v), better: 1, calc: a => a.wr, unit: '%', step: 0.01, toInput: v => (v * 100).toFixed(0), fromInput: v => v / 100 },
  deaths: { name: 'Смертей за игру', fmt: v => v.toFixed(1), better: -1, calc: a => a.d, step: 0.1 },
  kda: { name: 'KDA', fmt: v => v.toFixed(2), better: 1, calc: a => a.kda, step: 0.1 },
  gpm: { name: 'GPM', fmt: v => fmt(v), better: 1, calc: a => a.gpm, step: 10 },
  xpm: { name: 'XPM', fmt: v => fmt(v), better: 1, calc: a => a.xpm, step: 10 },
  lh: { name: 'Крипов за игру', fmt: v => fmt(v), better: 1, calc: a => a.lh, step: 5 },
  games: { name: 'Сыграть игр', fmt: v => fmt(v), better: 1, calc: a => a.n, step: 1, count: true },
  mmr: { name: 'ММР (примерно)', fmt: v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v)), better: 1, calc: (a, ms) => ms.filter(m => m.lobby_type === 7).reduce((s, m) => s + (m.win ? 1 : -1), 0) * MMR_PER_GAME, step: 25, count: true },
};
const GOAL_PERIODS = { week: 'на неделю', month: 'на месяц', last20: 'на последние 20 игр' };
const GOAL_MODES = { all: 'все игры', ranked: 'рейтинг' };

const goalsKey = id => 'goals:' + id;
const loadGoals = id => lsGet(goalsKey(id)) || [];
const saveGoals = (id, g) => lsSet(goalsKey(id), g);

// начало текущего периода и N прошлых
function periodStart(kind, back = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (kind === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * back); }
  else { d.setDate(1); d.setMonth(d.getMonth() - back); }
  return d.getTime() / 1000;
}

function goalGames(list, g, back = 0) {
  let ms = list;
  if (g.mode === 'ranked') ms = ms.filter(m => m.lobby_type === 7);
  if (g.hero) ms = ms.filter(m => m.hero_id === g.hero);
  if (g.period === 'last20') return ms.slice(back * 20, back * 20 + 20);
  const from = periodStart(g.period, back), to = back ? periodStart(g.period, back - 1) : Infinity;
  return ms.filter(m => m.start_time >= from && m.start_time < to);
}

function goalEval(list, g, back = 0) {
  const ms = goalGames(list, g, back);
  const M = GOAL_METRICS[g.metric];
  const val = ms.length ? M.calc(agg(ms), ms) : null;
  const done = val != null && (M.better > 0 ? val >= g.target : val <= g.target) && (M.count || ms.length >= 3);
  // прогресс 0..1: для «больше — лучше» — val/target, для «меньше — лучше» — target/val
  let prog = 0;
  if (val != null) prog = M.better > 0 ? (g.target > 0 ? val / g.target : (val >= g.target ? 1 : 0)) : (val > 0 ? g.target / val : 1);
  return { ms, val, done, prog: Math.max(0, Math.min(1, prog)) };
}

// автоподсказки: берём твой средний за последние 2 месяца и просим чуть лучше
function suggestGoals(list) {
  const recent = list.filter(m => m.start_time > Date.now() / 1000 - 60 * DAY && m.game_mode !== 23);
  if (recent.length < 15) return [];
  const a = agg(recent);
  const r = (v, s) => Math.round(v / s) * s;
  const out = [
    { metric: 'deaths', target: Math.max(2, +(a.d * 0.85).toFixed(1)), why: `сейчас ${a.d.toFixed(1)} — умирать на 15% меньше` },
    { metric: 'wr', target: Math.min(0.65, Math.max(0.5, Math.ceil((a.wr + 0.03) * 100) / 100)), why: `сейчас ${pct(a.wr)} — плюс 3%` },
    { metric: 'gpm', target: r(a.gpm * 1.08, 10), why: `сейчас ${fmt(a.gpm)} — фарм на 8% выше` },
    { metric: 'kda', target: +(a.kda * 1.15).toFixed(1), why: `сейчас ${a.kda.toFixed(2)} — на 15% лучше` },
  ];
  // самый частый герой с винрейтом ниже 50% — подтянуть
  const weak = heroStats(recent).filter(h => h.n >= 6 && h.wr < 0.5).sort((x, y) => y.n - x.n)[0];
  if (weak) out.push({ metric: 'wr', hero: weak.id, target: 0.5, why: `${hero(weak.id).name}: ${pct(weak.wr)} на ${weak.n} играх — вывести в плюс` });
  return out;
}

function tabGoals(box, p, _list, id) {
  const list = p.list; // цели считаются по всем играм, фильтры сверху тут не нужны
  const goals = loadGoals(id);
  const isMe = S.cfg.account_id === id;
  const sug = suggestGoals(list).filter(s => !goals.some(g => g.metric === s.metric && (g.hero || 0) === (s.hero || 0)));
  const played = [...new Set(list.map(m => m.hero_id))].filter(h => S.C.heroes[h]).sort((a, b) => hero(a).name.localeCompare(hero(b).name));

  const goalCard = (g, i) => {
    const M = GOAL_METRICS[g.metric];
    const cur = goalEval(list, g);
    const hist = [1, 2, 3, 4].map(b => goalEval(list, g, b));
    const title = `${M.name} ${M.better > 0 ? '≥' : '≤'} ${M.fmt(g.target)}`;
    const left = cur.val == null ? '' : cur.done ? 'Выполнено 🔥' : M.count
      ? `осталось ${M.fmt(Math.max(0, g.target - cur.val))}`.replace('осталось +', 'осталось ')
      : M.better > 0 ? `не хватает ${M.fmt(g.target - cur.val)}` : `лишних ${M.fmt(cur.val - g.target)}`;
    const histLbl = g.period === 'week' ? 'прошлые недели' : g.period === 'month' ? 'прошлые месяцы' : 'прошлые 20-ки';
    return `<div class="goal ${cur.done ? 'done' : ''}">
      <div class="gh"><div><b>${esc(title)}</b>
        <div class="muted" style="font-size:12px">${GOAL_PERIODS[g.period]} · ${GOAL_MODES[g.mode]}${g.hero ? ' · ' + esc(hero(g.hero).name) : ''}</div></div>
        ${g.hero ? `<img class="ghero" src="${esc(heroImg(g.hero))}" alt="">` : ''}
        <button class="gx" data-del="${i}" title="Удалить цель">✕</button></div>
      <div class="gv"><span class="num ${cur.done ? 'win' : ''}">${cur.val == null ? '—' : M.fmt(cur.val)}</span><span class="muted">из ${M.fmt(g.target)} · ${cur.ms.length} ${plural(cur.ms.length, 'игра', 'игры', 'игр')}</span></div>
      <span class="gbar"><i style="width:${(cur.prog * 100).toFixed(1)}%"></i></span>
      <div class="gf"><span class="${cur.done ? 'win' : 'muted'}">${left}</span>
        <span class="ghist" title="${histLbl}">${hist.reverse().map(h => `<i class="${h.val == null ? '' : h.done ? 'w' : 'l'}" data-tip="${h.val == null ? 'нет игр' : `${M.fmt(h.val)} · ${h.ms.length} игр · ${h.done ? 'выполнено' : 'мимо'}`}"></i>`).join('')}</span></div>
    </div>`;
  };

  box.innerHTML = `
    ${isMe ? '' : '<p class="muted" style="margin:0 0 12px">Это чужой профиль — цели можно ставить, но хранятся они у тебя в браузере.</p>'}
    <div class="grid g-main">
      <div class="grid" style="align-content:start">
        <section class="card"><h2>Цели <small>${goals.length ? `${goals.filter(g => goalEval(list, g).done).length} из ${goals.length} выполнено` : 'пока пусто — добавь справа или возьми из подсказок'}</small></h2>
          ${goals.length ? `<div class="goals">${goals.map(goalCard).join('')}</div>` : '<div class="empty-state">Нет целей</div>'}
        </section>
        ${sug.length ? `<section class="card"><h2>Подсказки <small>по твоим играм за 2 месяца, клик — добавить на неделю</small></h2>
          ${sug.map((s, i) => `<button class="gsug" data-sug="${i}"><span><b>${esc(GOAL_METRICS[s.metric].name)} ${GOAL_METRICS[s.metric].better > 0 ? '≥' : '≤'} ${GOAL_METRICS[s.metric].fmt(s.target)}</b>${s.hero ? ' · ' + esc(hero(s.hero).name) : ''}<div class="muted" style="font-size:12px">${esc(s.why)}</div></span><span class="gplus">+</span></button>`).join('')}
        </section>` : ''}
      </div>
      <section class="card" style="align-content:start"><h2>Новая цель</h2>
        <form id="gform" class="gform">
          <label>Что<select name="metric">${Object.entries(GOAL_METRICS).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join('')}</select></label>
          <label>Цель <span class="muted" id="gdir"></span><input class="inp" name="target" type="number" required></label>
          <label>Период<select name="period">${Object.entries(GOAL_PERIODS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
          <label>Игры<select name="mode">${Object.entries(GOAL_MODES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
          <label>Герой<select name="hero"><option value="">любой</option>${played.map(h => `<option value="${h}">${esc(hero(h).name)}</option>`).join('')}</select></label>
          <button class="btn primary">Добавить цель</button>
        </form>
        <p class="muted" style="font-size:12px;margin:14px 0 0">Неделя считается с понедельника, месяц — с 1-го числа. Кружочки справа внизу у цели — выполнял ли ты её в прошлые периоды. Цели хранятся в этом браузере.</p>
      </section>
    </div>`;

  const f = $('#gform', box);
  const syncForm = () => {
    const M = GOAL_METRICS[f.metric.value];
    f.target.step = M.unit ? 1 : M.step;
    $('#gdir', box).textContent = (M.better > 0 ? '(не меньше' : '(не больше') + (M.unit ? ', в %)' : ')');
    // подставляем «чуть лучше твоего среднего» как стартовое значение
    const a = agg(list.slice(0, 60).filter(m => m.game_mode !== 23));
    let v = M.count ? (f.metric.value === 'mmr' ? 100 : 20) : M.calc(a, []) * (M.better > 0 ? 1.05 : 0.9);
    f.target.value = M.toInput ? M.toInput(v) : (M.step < 1 ? (+v).toFixed(1) : Math.round(v / M.step) * M.step);
  };
  f.metric.onchange = syncForm;
  syncForm();
  f.onsubmit = e => {
    e.preventDefault();
    const M = GOAL_METRICS[f.metric.value];
    const raw = parseFloat(f.target.value);
    if (!isFinite(raw)) return;
    goals.push({ metric: f.metric.value, target: M.fromInput ? M.fromInput(raw) : raw, period: f.period.value, mode: f.mode.value, hero: f.hero.value ? +f.hero.value : 0 });
    saveGoals(id, goals);
    toast('Цель добавлена');
    tabGoals(box, p, _list, id);
  };
  $$('[data-del]', box).forEach(b => b.onclick = () => { goals.splice(+b.dataset.del, 1); saveGoals(id, goals); tabGoals(box, p, _list, id); });
  $$('[data-sug]', box).forEach(b => b.onclick = () => {
    const s = sug[+b.dataset.sug];
    goals.push({ metric: s.metric, target: s.target, period: 'week', mode: 'all', hero: s.hero || 0 });
    saveGoals(id, goals);
    tabGoals(box, p, _list, id);
  });
}
