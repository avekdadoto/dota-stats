'use strict';
/* Вкладка «Скилл»: каждый твой матч прогоняется через бенчмарки OpenDota
   (какая стата у 10%…99% всех игроков на этом герое) → твой перцентиль по каждой стате.
   Из этого: скилл-профиль, что решает твои игры, тренд и разбор по героям. */

const SKILL_STATS = [
  // ключ бенчмарка, название, как посчитать из матча
  ['gold_per_min', 'Фарм (GPM)', m => m.gold_per_min],
  ['xp_per_min', 'Опыт (XPM)', m => m.xp_per_min],
  ['last_hits_per_min', 'Добивание крипов', m => m.last_hits / (m.duration / 60)],
  ['kills_per_min', 'Убийства', m => m.kills / (m.duration / 60)],
  ['hero_damage_per_min', 'Урон по героям', m => m.hero_damage == null ? null : m.hero_damage / (m.duration / 60)],
  ['tower_damage', 'Урон по строениям', m => m.tower_damage],
  ['hero_healing_per_min', 'Лечение', m => m.hero_healing == null ? null : m.hero_healing / (m.duration / 60)],
];
const CORE = ['gold_per_min', 'xp_per_min', 'last_hits_per_min', 'hero_damage_per_min']; // для «общего уровня»

S.bench = new Map(); // hid -> промис бенчмарков

function benchP(hid) {
  if (!S.bench.has(hid)) S.bench.set(hid, api('/benchmarks/' + hid).catch(e => { S.bench.delete(hid); throw e; }));
  return S.bench.get(hid);
}

// значение → перцентиль по таблице [{percentile, value}], линейная интерполяция
function toPct(table, v) {
  if (v == null || !isFinite(v) || !table || table.length < 3) return null;
  const t = table.filter(x => x && x.value != null).sort((a, b) => a.percentile - b.percentile);
  if (t.length < 3 || t[Math.floor(t.length / 2)].value <= 0) return null; // стата для героя не имеет смысла (лечение у керри)
  if (v <= t[0].value) return t[0].value > 0 ? Math.max(0, t[0].percentile * v / t[0].value) : t[0].percentile;
  for (let i = 1; i < t.length; i++) {
    if (v <= t[i].value) {
      const a = t[i - 1], b = t[i];
      return a.percentile + (b.percentile - a.percentile) * (v - a.value) / Math.max(1e-9, b.value - a.value);
    }
  }
  return Math.min(1, t[t.length - 1].percentile + 0.005);
}

const pctCls = p => p == null ? 'muted' : p >= 0.65 ? 'win' : p < 0.4 ? 'loss' : '';
const pctTxt = p => p == null ? '—' : Math.round(p * 100);
function pctCell(p, tip) {
  if (p == null) return '<td class="r muted">—</td>';
  const hue = Math.round(p * 120); // 0 красный → 120 зелёный
  return `<td class="r"><span class="pcell num" style="--h:${hue}" ${tip ? `data-tip="${tip}"` : ''}>${pctTxt(p)}</span></td>`;
}

async function tabSkill(box, p, list, id, seq) {
  // турбо и короткие игры портят цифры (в турбо GPM в разы выше), их не берём
  const ms = list.filter(m => m.game_mode !== 23 && m.duration >= 15 * 60 && !m.leaver_status && m.lobby_type !== 1 && m.lobby_type !== 4);
  if (ms.length < 10) { box.innerHTML = '<div class="empty-state">Мало обычных игр (нужно 10+, турбо и игры короче 15 минут не считаются)</div>'; return; }

  const games = [...groupBy(ms, m => m.hero_id)].sort((a, b) => b[1].length - a[1].length);
  const heroes = games.filter(([, g]) => g.length >= 3).slice(0, 20).map(([h]) => h);
  const covered = new Set(heroes);
  const use = ms.filter(m => covered.has(m.hero_id));

  box.innerHTML = `<div class="loading"><div class="spin"></div><div id="skprog">Сверяю тебя со всеми игроками мира… 0/${heroes.length} героев</div></div>`;
  const bench = new Map();
  let done = 0;
  // по 3 героя за раз, чтоб не упереться в лимит OpenDota
  const queue = [...heroes];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const h = queue.shift();
      try { bench.set(h, (await benchP(h)).result); } catch { /* без этого героя */ }
      done++;
      const el = $('#skprog');
      if (el) el.textContent = `Сверяю тебя со всеми игроками мира… ${done}/${heroes.length} героев`;
    }
  }));
  if (seq !== routeSeq) return;
  if (!bench.size) { box.innerHTML = '<div class="err"><h3>OpenDota не отдал бенчмарки</h3><p>Попробуй через минуту.</p></div>'; return; }

  // перцентили по каждому матчу
  const rows = [];
  for (const m of use) {
    const b = bench.get(m.hero_id);
    if (!b) continue;
    const pc = {};
    for (const [k, , f] of SKILL_STATS) pc[k] = toPct(b[k], f(m));
    const core = CORE.map(k => pc[k]).filter(x => x != null);
    rows.push({ m, pc, core: core.length ? core.reduce((s, x) => s + x, 0) / core.length : null });
  }
  if (rows.length < 10) { box.innerHTML = '<div class="empty-state">Мало данных для разбора</div>'; return; }

  const mean = arr => { const a = arr.filter(x => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

  // ── профиль ──
  const prof = SKILL_STATS.map(([k, name]) => ({ k, name, v: mean(rows.map(r => r.pc[k])), n: rows.filter(r => r.pc[k] != null).length }))
    .filter(x => x.v != null && x.n >= 5);
  const overall = mean(rows.map(r => r.core));
  const sorted = [...prof].sort((a, b) => b.v - a.v);
  const best = sorted[0], worst = sorted[sorted.length - 1];

  // ── что решает игры: разница перцентиля в победах и сливах + винрейт при высоком/низком ──
  const wins = rows.filter(r => r.m.win), losses = rows.filter(r => !r.m.win);
  const keys = prof.map(x => ({
    ...x,
    w: mean(wins.map(r => r.pc[x.k])), l: mean(losses.map(r => r.pc[x.k])),
    hi: rows.filter(r => r.pc[x.k] != null && r.pc[x.k] >= 0.6), lo: rows.filter(r => r.pc[x.k] != null && r.pc[x.k] < 0.4),
  })).map(x => Object.assign(x, { gap: (x.w ?? 0) - (x.l ?? 0), hiWr: x.hi.length ? x.hi.filter(r => r.m.win).length / x.hi.length : null,
    loWr: x.lo.length ? x.lo.filter(r => r.m.win).length / x.lo.length : null }))
    .filter(x => x.w != null && x.l != null).sort((a, b) => b.gap - a.gap);
  const lever = keys[0];

  // ── тренд: скользящее среднее общего уровня ──
  const chron = [...rows].filter(r => r.core != null).sort((a, b) => a.m.start_time - b.m.start_time);
  const W = Math.max(5, Math.min(30, Math.floor(chron.length / 6)));
  const trend = [];
  for (let i = W - 1; i < chron.length; i++) {
    const v = mean(chron.slice(i - W + 1, i + 1).map(r => r.core));
    trend.push({ label: new Date(chron[i].m.start_time * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), value: v, tip: `<b>${date(chron[i].m.start_time)}</b><br>Уровень: лучше ${pctTxt(v)}% игроков<br><span class='k'>среднее за ${W} игр</span>` });
  }
  if (trend.length >= 2) S.charts.push({ id: 'sktr', type: 'line', title: 'Уровень игры', yMin: 0, yMax: 1, ref: 0.5, fmtY: v => Math.round(v * 100), color: 'var(--accent-hi)', data: trend });
  const half = Math.floor(chron.length / 2);
  const early = mean(chron.slice(0, half).map(r => r.core)), late = mean(chron.slice(half).map(r => r.core));
  const recent = mean(chron.slice(-20).map(r => r.core));

  // ── по героям ──
  const byHero = [...groupBy(rows, r => r.m.hero_id)].map(([hid, rs]) => {
    const pcs = {};
    for (const [k] of SKILL_STATS) pcs[k] = mean(rs.map(r => r.pc[k]));
    const a = agg(rs.map(r => r.m));
    return { hid, n: rs.length, wr: a.wr, core: mean(rs.map(r => r.core)), pcs };
  }).sort((a, b) => b.n - a.n);
  // «везёт» — винрейт сильно выше, чем уровень игры; «недооценён» — наоборот
  const lucky = byHero.filter(h => h.n >= 8 && h.core != null && h.wr - h.core > 0.12).sort((a, b) => (b.wr - b.core) - (a.wr - a.core))[0];
  const unlucky = byHero.filter(h => h.n >= 8 && h.core != null && h.core - h.wr > 0.12).sort((a, b) => (b.core - b.wr) - (a.core - a.wr))[0];

  const ins = [];
  if (best) ins.push({ cls: 'good', icon: '▲', title: `Сильная сторона — ${best.name.toLowerCase()}`, text: `Лучше ${pctTxt(best.v)}% игроков на тех же героях.` });
  if (worst && worst !== best) ins.push({ cls: 'bad', icon: '▼', title: `Слабое место — ${worst.name.toLowerCase()}`, text: `Хуже ${100 - pctTxt(worst.v)}% игроков на тех же героях. Тут больше всего можно выжать.` });
  if (lever && lever.gap > 0.05) ins.push({ cls: 'info', icon: '◆', title: `Твой главный рычаг — ${lever.name.toLowerCase()}`,
    text: `Когда он у тебя выше 60-го перцентиля, ты выигрываешь ${lever.hiWr != null ? pct(lever.hiWr, 0) : '—'}, когда ниже 40-го — ${lever.loWr != null ? pct(lever.loWr, 0) : '—'}. Сильнее всего отличает твои победы от сливов.` });
  if (early != null && late != null && Math.abs(late - early) > 0.03) ins.push(late > early
    ? { cls: 'good', icon: '↗', title: 'Растёшь', text: `Вторая половина игр — лучше ${pctTxt(late)}% игроков, первая была ${pctTxt(early)}%.` }
    : { cls: 'bad', icon: '↘', title: 'Проседаешь', text: `Вторая половина игр — лучше ${pctTxt(late)}% игроков, а было ${pctTxt(early)}%.` });
  if (lucky) ins.push({ cls: 'info', icon: '🍀', title: `${hero(lucky.hid).name}: везёт больше, чем тащишь`, text: `Винрейт ${pct(lucky.wr, 0)}, а по стате ты лучше всего ${pctTxt(lucky.core)}% игроков. Похоже, тащит тима.` });
  if (unlucky) ins.push({ cls: 'info', icon: '⚖', title: `${hero(unlucky.hid).name}: играешь лучше, чем выигрываешь`, text: `По стате лучше ${pctTxt(unlucky.core)}% игроков, а винрейт ${pct(unlucky.wr, 0)}. Не бросай героя — цифры за тебя.` });

  const statCols = SKILL_STATS.filter(([k]) => prof.some(x => x.k === k));
  box.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v num ${pctCls(overall)}">${pctTxt(overall)}</div><div class="l">общий уровень</div><div class="s">лучше ${pctTxt(overall)}% игроков</div></div>
      <div class="tile"><div class="v num ${pctCls(recent)}">${pctTxt(recent)}</div><div class="l">последние 20</div><div class="s">${recent != null && overall != null ? (recent >= overall ? 'выше' : 'ниже') + ' твоего среднего' : ''}</div></div>
      <div class="tile"><div class="v num">${fmt(rows.length)}</div><div class="l">игр разобрано</div><div class="s">${bench.size} ${plural(bench.size, 'герой', 'героя', 'героев')}</div></div>
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="grid" style="align-content:start">
        <section class="card"><h2>Скилл-профиль <small>перцентиль: лучше скольких % игроков на тех же героях</small></h2>
          ${prof.map(x => `<div class="skrow" data-tip="${esc(x.name)}: в среднем лучше ${pctTxt(x.v)}% игроков<br><span class='k'>${x.n} игр</span>">
            <span>${esc(x.name)}</span><span class="skbar"><i style="width:${(x.v * 100).toFixed(1)}%;--h:${Math.round(x.v * 120)}"></i><b style="left:50%"></b></span><span class="num ${pctCls(x.v)}">${pctTxt(x.v)}</span></div>`).join('')}
        </section>
        <section class="card"><h2>Что решает твои игры <small>средний перцентиль в победах vs сливах</small></h2>
          <div class="scroll-x"><table class="tbl"><thead><tr><th>Стата</th><th class="r">В победах</th><th class="r">В сливах</th><th class="r">Разница</th><th class="r">WR когда высоко</th><th class="r">WR когда низко</th></tr></thead>
          <tbody>${keys.map((x, i) => `<tr${i === 0 && x.gap > 0.05 ? ' class="me"' : ''}><td>${esc(x.name)}${i === 0 && x.gap > 0.05 ? ' <span class="badge gold">главное</span>' : ''}</td>
            <td class="num r win">${pctTxt(x.w)}</td><td class="num r loss">${pctTxt(x.l)}</td><td class="num r">${x.gap >= 0 ? '+' : ''}${Math.round(x.gap * 100)}</td>
            <td class="num r ${x.hiWr != null ? wrCls(x.hiWr) : 'muted'}" data-tip="${x.hi.length} игр, где стата выше 60-го перцентиля">${x.hiWr != null ? pct(x.hiWr, 0) : '—'}</td>
            <td class="num r ${x.loWr != null ? wrCls(x.loWr) : 'muted'}" data-tip="${x.lo.length} игр, где стата ниже 40-го перцентиля">${x.loWr != null ? pct(x.loWr, 0) : '—'}</td></tr>`).join('')}</tbody></table></div>
        </section>
        <section class="card"><h2>Уровень игры во времени <small>среднее фарма, опыта, крипов и урона, скользящее по ${W} игр</small></h2>${chartBox('sktr', 200)}</section>
      </div>
      <section class="card" style="align-content:start"><h2>Выводы</h2>
        <div class="insights">${ins.map(i => `<div class="ins ${i.cls}"><span class="i">${i.icon}</span><div><b>${esc(i.title)}</b><div class="t">${esc(i.text)}</div></div></div>`).join('')}</div>
      </section>
    </div>
    <section class="card" style="margin-top:16px"><h2>По героям <small>твой перцентиль по каждой стате, клик — матчи на герое</small></h2>
      <div class="scroll-x"><table class="tbl" id="skh"><thead><tr><th>Герой</th><th class="r">Игр</th><th class="r">Винрейт</th><th class="r">Уровень</th>${statCols.map(([, n]) => `<th class="r">${esc(n)}</th>`).join('')}</tr></thead>
      <tbody>${byHero.map(h => `<tr class="click" data-hero="${h.hid}"><td>${heroCell(h.hid, '', true)}</td><td class="num r">${h.n}</td>
        <td class="num r ${wrCls(h.wr)}">${pct(h.wr, 0)}</td>${pctCell(h.core)}${statCols.map(([k]) => pctCell(h.pcs[k])).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:12px 0 0">Число — перцентиль: 70 значит «лучше 70% всех игроков на этом герое». Бенчмарки OpenDota по всем рангам.
        Турбо, игры короче 15 минут, с ливерами и с ботами не считаются; герои с 3+ играми, топ-20.</p>
    </section>`;
  $('#skh tbody', box).onclick = e => {
    const tr = e.target.closest('[data-hero]');
    if (tr) { S.filters.hero = tr.dataset.hero; S.page = 0; lsSet('filters', S.filters); location.hash = `#/p/${id}/matches`; }
  };
  drawCharts();
}
