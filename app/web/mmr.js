'use strict';
/* Вкладка «ММР»: примерная кривая ММР по рейтинговым играм, прогноз до следующей звезды/медали,
   и откуда ММР приходит/уходит (герои, линии, пати, время суток).
   Точный ММР OpenDota не знает — считаем ±25 за игру, якорим к текущей медали. */

const STAR_MMR = 154; // примерно столько ММР на одну звезду медали

// нижняя граница звезды: Herald 1 = 0, каждая звезда +154. Immortal — 5620+
function tierFloor(t) {
  if (!t) return null;
  const m = Math.floor(t / 10), s = Math.max(1, t % 10);
  if (m >= 8) return 5620;
  return ((m - 1) * 5 + (s - 1)) * STAR_MMR;
}
function tierFromMmr(v) {
  if (v >= 5620) return 80;
  const k = Math.max(0, Math.floor(v / STAR_MMR));
  return (Math.min(7, Math.floor(k / 5) + 1)) * 10 + Math.min(5, k % 5 + 1);
}

function tabMmr(box, p, list, id) {
  const ranked = list.filter(m => m.lobby_type === 7).sort((a, b) => a.start_time - b.start_time);
  if (ranked.length < 10) { box.innerHTML = '<div class="empty-state">Мало рейтинговых игр (нужно 10+)</div>'; return; }

  // кривая: якорим конец к середине текущей звезды (если ранг известен), иначе стартуем с нуля
  const net = ranked.reduce((s, m) => s + (m.win ? 1 : -1), 0) * MMR_PER_GAME;
  const floor = tierFloor(p.rank_tier);
  const nowMmr = floor != null ? floor + STAR_MMR / 2 : null;
  let v = nowMmr != null ? nowMmr - net : 0;
  const pts = [{ t: ranked[0].start_time, v, m: null }];
  for (const m of ranked) { v += m.win ? MMR_PER_GAME : -MMR_PER_GAME; pts.push({ t: m.start_time, v, m }); }
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a)), low = pts.reduce((a, b) => (b.v < a.v ? b : a));
  const abs = nowMmr != null;
  const show = x => abs ? fmt(x) : (x >= 0 ? '+' : '−') + fmt(Math.abs(x));

  // прореживаем для графика (не больше ~300 точек)
  const stepN = Math.max(1, Math.ceil(pts.length / 300));
  const chart = pts.filter((_, i) => i % stepN === 0 || i === pts.length - 1).map(x => ({
    label: new Date(x.t * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    value: x.v,
    tip: `<b>${date(x.t)}</b><br>${abs ? '≈' : ''}${show(x.v)} ММР${abs ? ` · ${esc(rankName(tierFromMmr(x.v)))}` : ''}${x.m ? `<br>${esc(hero(x.m.hero_id).name)} · ${x.m.win ? 'победа' : 'слив'}` : ''}`,
  }));
  S.charts.push({ id: 'mmr', type: 'line', title: 'ММР', color: 'var(--gold)', fmtY: v => abs ? Math.round(v) : (v > 0 ? '+' : '') + Math.round(v), data: chart });

  // темп: последние 50 рейтинговых
  const last = ranked.slice(-50);
  const pace = last.reduce((s, m) => s + (m.win ? 1 : -1), 0) * MMR_PER_GAME / last.length; // ММР за игру
  const lastWr = last.filter(m => m.win).length / last.length;
  let forecast = '';
  if (abs && p.rank_tier && Math.floor(p.rank_tier / 10) < 8) {
    const toStar = (floor + STAR_MMR) - nowMmr;
    const m = Math.floor(p.rank_tier / 10);
    const toMedal = (m * 5) * STAR_MMR - nowMmr;
    const games = need => pace > 0 ? Math.ceil(need / pace) : null;
    const gs = games(toStar), gm = games(toMedal);
    forecast = pace > 0
      ? `При текущем темпе (${pct(lastWr)} за последние ${last.length}) до следующей звезды ≈${gs} ${plural(gs, 'игра', 'игры', 'игр')}, до ${MEDALS[m + 1] || 'Immortal'} ≈${gm} ${plural(gm, 'игра', 'игры', 'игр')}.`
      : `За последние ${last.length} игр у тебя ${pct(lastWr)} — с таким темпом не апнешься. Нужно выше 50%.`;
  }

  // откуда ММР
  const src = (keyFn, nameFn, minN = 5) => [...groupBy(ranked, keyFn)].map(([k, ms]) => ({
    k, name: nameFn(k), n: ms.length, wr: ms.filter(m => m.win).length / ms.length,
    net: ms.reduce((s, m) => s + (m.win ? 1 : -1), 0) * MMR_PER_GAME })).filter(x => x.n >= minN);
  const heroes = src(m => m.hero_id, k => hero(k).name, 3);
  const top = [...heroes].sort((a, b) => b.net - a.net).slice(0, 6).filter(x => x.net > 0);
  const bottom = [...heroes].sort((a, b) => a.net - b.net).slice(0, 6).filter(x => x.net < 0);
  const lanes = src(m => m.lane_role || null, k => LANES[k] || k);
  const party = src(m => (m.party_size > 1 ? 'party' : m.party_size === 1 ? 'solo' : null), k => k === 'party' ? 'В пати' : 'Соло');
  const tod = src(m => { const h = new Date(m.start_time * 1000).getHours(); return h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3; }, k => ['Ночь (0–6)', 'Утро (6–12)', 'День (12–18)', 'Вечер (18–24)'][k]);
  const maxAbs = Math.max(1, ...[...heroes, ...lanes, ...party, ...tod].map(x => Math.abs(x.net)));
  const netRow = (x, img) => `<div class="mrow" data-tip="<b>${esc(x.name)}</b><br>${x.n} ${plural(x.n, 'игра', 'игры', 'игр')} · ${pct(x.wr)}">
    ${img ? heroCell(x.k, `${x.n} ${plural(x.n, 'игра', 'игры', 'игр')}`, true) : `<span>${esc(x.name)}</span>`}
    <span class="mbar"><i class="${x.net >= 0 ? 'p' : 'n'}" style="width:${(Math.abs(x.net) / maxAbs * 50).toFixed(1)}%"></i></span>
    <span class="num ${x.net >= 0 ? 'win' : 'loss'}">${x.net >= 0 ? '+' : '−'}${fmt(Math.abs(x.net))}</span></div>`;

  const nowMed = p.rank_tier ? rankName(p.rank_tier) : null;
  box.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v num">${abs ? '≈' + fmt(nowMmr) : '—'}</div><div class="l">сейчас</div><div class="s">${nowMed ? esc(nowMed) : 'ранг скрыт'}</div></div>
      <div class="tile"><div class="v num ${net >= 0 ? 'win' : 'loss'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</div><div class="l">за выборку</div><div class="s">${ranked.length} рейтинговых</div></div>
      <div class="tile"><div class="v num win">${abs ? '≈' : ''}${show(peak.v)}</div><div class="l">пик</div><div class="s">${date(peak.t)}</div></div>
      <div class="tile"><div class="v num loss">${abs ? '≈' : ''}${show(low.v)}</div><div class="l">дно</div><div class="s">${date(low.t)}</div></div>
      <div class="tile"><div class="v num ${pace >= 0 ? 'win' : 'loss'}">${pace >= 0 ? '+' : '−'}${Math.abs(pace).toFixed(1)}</div><div class="l">ММР за игру</div><div class="s">темп, последние ${last.length}</div></div>
    </div>
    ${forecast ? `<div class="ins ${pace > 0 ? 'good' : 'bad'}" style="margin-top:14px"><span class="i">${pace > 0 ? '🎯' : '🧱'}</span><div><b>Прогноз</b><div class="t">${esc(forecast)}</div></div></div>` : ''}
    <section class="card" style="margin-top:16px"><h2>ММР во времени <small>${abs ? 'примерно: конец графика привязан к твоей медали, ±25 за игру' : 'ранг скрыт — показываю изменение от начала, ±25 за игру'}</small></h2>${chartBox('mmr', 240)}</section>
    <div class="grid g2" style="margin-top:16px">
      <section class="card"><h2>Кормят ММР <small>герои, давшие больше всего плюса</small></h2>${top.map(x => netRow(x, true)).join('') || '<div class="muted">Никто не в плюсе 💀</div>'}</section>
      <section class="card"><h2>Жрут ММР <small>герои, слившие больше всего</small></h2>${bottom.map(x => netRow(x, true)).join('') || '<div class="muted">Никто не в минусе</div>'}</section>
    </div>
    <div class="grid g3" style="margin-top:16px">
      <section class="card"><h2>По линиям</h2>${lanes.sort((a, b) => b.net - a.net).map(x => netRow(x)).join('') || '<div class="muted">Линии неизвестны</div>'}</section>
      <section class="card"><h2>Соло / пати</h2>${party.sort((a, b) => b.net - a.net).map(x => netRow(x)).join('') || '<div class="muted">Нет данных</div>'}</section>
      <section class="card"><h2>Время суток</h2>${tod.sort((a, b) => b.net - a.net).map(x => netRow(x)).join('') || '<div class="muted">Нет данных</div>'}</section>
    </div>
    <p class="muted" style="font-size:12px;margin-top:14px">ММР примерный: Valve не отдаёт точный, поэтому ±${MMR_PER_GAME} за рейтинговую игру и ~${STAR_MMR} ММР на звезду. Учитываются фильтры сверху (кроме режима — тут только рейтинг).</p>`;
}
