'use strict';
/* Вкладка «Сессии» — тильт-детектор. Режем историю на сессии (между играми < часа),
   смотрим, как падает винрейт по ходу вечера и после сливов, и выводим стоп-правило. */

const SESSION_GAP = 60 * 60; // больше часа между концом игры и началом следующей — новая сессия
const MMR_PER_GAME = 25;     // грубо: ±25 за рейтинговую игру

function splitSessions(list) {
  const asc = [...list].sort((a, b) => a.start_time - b.start_time);
  const out = [];
  let cur = null;
  for (const m of asc) {
    if (!cur || m.start_time - cur.end > SESSION_GAP) { cur = { games: [], start: m.start_time, end: 0 }; out.push(cur); }
    cur.games.push(m);
    cur.end = Math.max(cur.end, m.start_time + (m.duration || 0));
  }
  for (const s of out) {
    s.w = s.games.filter(m => m.win).length;
    s.l = s.games.length - s.w;
    const r = s.games.filter(m => m.lobby_type === 7);
    s.ranked = r.length;
    s.net = r.filter(m => m.win).length * 2 - r.length; // побед минус сливов в рейтинге
  }
  return out;
}

function tabSessions(box, p, list, id) {
  const sessions = splitSessions(list);
  const games = sessions.reduce((s, x) => s + x.games.length, 0);
  if (games < 20 || sessions.length < 5) { box.innerHTML = '<div class="empty-state">Мало игр для анализа сессий (нужно 20+)</div>'; return; }
  const base = agg(list).wr;

  // винрейт по номеру игры в сессии
  const MAXN = 6;
  const byIdx = Array.from({ length: MAXN }, () => ({ n: 0, w: 0 }));
  // винрейт после серий внутри сессии
  const pat = { W: { n: 0, w: 0 }, L: { n: 0, w: 0 }, WW: { n: 0, w: 0 }, LL: { n: 0, w: 0 }, LLL: { n: 0, w: 0 }, first: { n: 0, w: 0 } };
  // винрейт после долгой сессии (> 3 часов от начала)
  const late = { n: 0, w: 0 }, early = { n: 0, w: 0 };
  for (const s of sessions) {
    s.games.forEach((m, i) => {
      const b = byIdx[Math.min(i, MAXN - 1)];
      b.n++; if (m.win) b.w++;
      const prev = s.games.slice(Math.max(0, i - 3), i).map(x => x.win ? 'W' : 'L').join('');
      const add = k => { pat[k].n++; if (m.win) pat[k].w++; };
      if (i === 0) add('first');
      if (prev.endsWith('W')) add('W');
      if (prev.endsWith('L')) add('L');
      if (prev.endsWith('WW')) add('WW');
      if (prev.endsWith('LL')) add('LL');
      if (prev.endsWith('LLL')) add('LLL');
      const t = (m.start_time - s.start) / 3600;
      const tgt = t >= 3 ? late : early;
      tgt.n++; if (m.win) tgt.w++;
    });
  }
  const wr = x => x.n ? x.w / x.n : null;

  // стоп-правило: самое плохое условие с нормальной выборкой
  const conds = [
    { k: 'после слива', ...pat.L }, { k: 'после 2 сливов подряд', ...pat.LL }, { k: 'после 3 сливов подряд', ...pat.LLL },
    { k: 'после 3 часов игры', ...late },
    ...byIdx.slice(2).map((b, i) => ({ k: i + 3 === MAXN ? `с ${MAXN}-й игры за сессию` : `на ${i + 3}-й игре за сессию`, ...b })),
  ].filter(c => c.n >= 12).map(c => Object.assign(c, { wr: c.w / c.n }));
  // худшее условие, где винрейт заметно ниже среднего
  const bad = conds.filter(c => c.wr < base - 0.04).sort((a, b) => a.wr - b.wr);
  // выключать имеет смысл, только если дальше реально в минус (< 50%); иначе это просто просадка
  const stop = bad.find(c => c.wr < 0.5);
  const dip = stop ? null : bad[0];

  // сколько ММР ты бы сэкономил, если бы выключал по правилу
  let saved = null;
  if (stop && stop.k.includes('слив')) {
    const need = stop.k.includes('3') ? 'LLL' : stop.k.includes('2') ? 'LL' : 'L';
    let lost = 0, after = 0;
    for (const s of sessions) {
      let streak = '';
      let cut = false;
      for (const m of s.games) {
        if (cut) { if (m.lobby_type === 7) { lost += m.win ? 1 : -1; after++; } continue; }
        streak = (streak + (m.win ? 'W' : 'L')).slice(-3);
        if (streak.endsWith(need)) cut = true;
      }
    }
    saved = { net: lost, games: after };
  }

  // распределение длины сессий
  const lens = [...groupBy(sessions, s => Math.min(s.games.length, 8))].sort((a, b) => a[0] - b[0]);
  const longSessWr = (() => { const ss = sessions.filter(s => s.games.length >= 5); const g = ss.reduce((a, s) => a + s.games.length, 0); return g ? ss.reduce((a, s) => a + s.w, 0) / g : null; })();
  const shortSessWr = (() => { const ss = sessions.filter(s => s.games.length <= 3); const g = ss.reduce((a, s) => a + s.games.length, 0); return g ? ss.reduce((a, s) => a + s.w, 0) / g : null; })();

  const tipW = (label, x) => `<b>${label}</b><br>${x.n ? pct(x.w / x.n) : '—'} · ${x.w}–${x.n - x.w}`;
  const colr = v => v == null ? 'var(--muted)' : v >= 0.5 ? 'var(--win)' : 'var(--loss)';
  S.charts.push({ id: 'sidx', type: 'bar', title: 'Винрейт по номеру игры', yMin: 0.3, yMax: 0.7, ref: base, fmtY: v => Math.round(v * 100) + '%',
    data: byIdx.map((b, i) => ({ label: i + 1 === MAXN ? MAXN + '+' : String(i + 1), value: b.n >= 5 ? b.w / b.n : null, color: colr(wr(b)), tip: tipW(i + 1 === MAXN ? `${MAXN}-я игра и дальше` : `${i + 1}-я игра за сессию`, b) })) });
  const PL = [['first', 'Первая'], ['W', 'После W'], ['WW', 'После WW'], ['L', 'После L'], ['LL', 'После LL'], ['LLL', 'После LLL']];
  S.charts.push({ id: 'spat', type: 'bar', title: 'Винрейт после серий', yMin: 0.3, yMax: 0.7, ref: base, fmtY: v => Math.round(v * 100) + '%', labelW: 30,
    data: PL.map(([k, l]) => ({ label: l, value: pat[k].n >= 5 ? wr(pat[k]) : null, color: colr(wr(pat[k])), tip: tipW(l, pat[k]) + (pat[k].n < 5 ? "<br><span class='k'>мало игр</span>" : '') })) });

  const ins = [];
  if (stop) {
    ins.push({ cls: 'bad', icon: '⛔', title: `Стоп-правило: выключай ${stop.k}`,
      text: `Дальше у тебя ${pct(stop.wr)} винрейта на ${stop.n} играх против ${pct(base)} в среднем.` +
        (saved && saved.games && saved.net < 0 ? ` Если бы выключал, сэкономил бы ≈${Math.abs(saved.net * MMR_PER_GAME)} ММР (${saved.games} рейтинговых игр после этого ушли в минус).` : '') });
  } else if (dip) {
    ins.push({ cls: 'info', icon: '📉', title: `Проседаешь ${dip.k}`,
      text: `Там ${pct(dip.wr)} против ${pct(base)} в среднем — хуже, но всё ещё в плюс, так что выключать необязательно. Просто будь внимательнее.` });
  } else {
    ins.push({ cls: 'good', icon: '🧊', title: 'Тильта не видно', text: 'Ни после сливов, ни к концу вечера твой винрейт заметно не падает. Ледяной.' });
  }
  if (pat.L.n >= 12 && pat.W.n >= 12) {
    const d = wr(pat.W) - wr(pat.L);
    if (Math.abs(d) > 0.05) ins.push(d > 0
      ? { cls: 'info', icon: '🎢', title: 'Ты играешь на эмоциях', text: `После победы ${pct(wr(pat.W))}, после слива ${pct(wr(pat.L))}. Настроение решает больше, чем кажется.` }
      : { cls: 'good', icon: '😤', title: 'Слив тебя бодрит', text: `После слива ${pct(wr(pat.L))}, после победы всего ${pct(wr(pat.W))} — расслабляешься.` });
  }
  if (pat.first.n >= 12 && Math.abs(wr(pat.first) - base) > 0.04) ins.push(wr(pat.first) < base
    ? { cls: 'info', icon: '🥶', title: 'Первая игра — разминка', text: `Первая игра за сессию ${pct(wr(pat.first))} против ${pct(base)} в среднем. Начинай с турбо или обычки.` }
    : { cls: 'good', icon: '🔥', title: 'Свежая голова — твоё всё', text: `Первая игра за сессию ${pct(wr(pat.first))} против ${pct(base)} в среднем.` });
  if (longSessWr != null && shortSessWr != null && Math.abs(longSessWr - shortSessWr) > 0.04) ins.push(longSessWr < shortSessWr
    ? { cls: 'bad', icon: '🕒', title: 'Длинные сессии тебя убивают', text: `В сессиях по 5+ игр ${pct(longSessWr)}, в коротких (до 3) ${pct(shortSessWr)}.` }
    : { cls: 'good', icon: '🕒', title: 'Разыгрываешься к концу', text: `В длинных сессиях (5+) ${pct(longSessWr)}, в коротких ${pct(shortSessWr)}.` });

  const recent = [...sessions].reverse().slice(0, 25);
  const avgLen = games / sessions.length;
  box.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v num">${fmt(sessions.length)}</div><div class="l">сессий</div><div class="s">${avgLen.toFixed(1)} игр в среднем</div></div>
      <div class="tile"><div class="v num ${wrCls(wr(pat.L) ?? 0.5)}">${pat.L.n ? pct(wr(pat.L)) : '—'}</div><div class="l">после слива</div><div class="s">${pat.L.n} игр</div></div>
      <div class="tile"><div class="v num ${wrCls(wr(pat.LL) ?? 0.5)}">${pat.LL.n ? pct(wr(pat.LL)) : '—'}</div><div class="l">после 2 сливов</div><div class="s">${pat.LL.n} игр</div></div>
      <div class="tile"><div class="v num ${wrCls(wr(late) ?? 0.5)}">${late.n ? pct(wr(late)) : '—'}</div><div class="l">после 3 часов</div><div class="s">${late.n} игр</div></div>
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <div class="grid" style="align-content:start">
        <section class="card"><h2>Винрейт по номеру игры за сессию <small>пунктир — твой средний ${pct(base)}</small></h2>${chartBox('sidx', 190)}</section>
        <section class="card"><h2>Винрейт после серий <small>внутри одной сессии</small></h2>${chartBox('spat', 190)}</section>
      </div>
      <section class="card" style="align-content:start"><h2>Диагноз</h2>
        <div class="insights">${ins.map(i => `<div class="ins ${i.cls}"><span class="i">${i.icon}</span><div><b>${esc(i.title)}</b><div class="t">${esc(i.text)}</div></div></div>`).join('')}</div>
        <div class="muted" style="font-size:12px;margin:14px 0 6px">Сколько игр за сессию</div>
        ${lens.map(([k, ss]) => { const g = ss.reduce((a, s) => a + s.games.length, 0), w = ss.reduce((a, s) => a + s.w, 0);
          return `<div class="slen"><span>${k === 8 ? '8+' : k}</span><span class="bar"><i style="width:${(ss.length / sessions.length * 100).toFixed(1)}%;background:var(--gold)"></i></span><span class="num muted">${ss.length}</span><span class="num ${wrCls(w / g)}">${pct(w / g, 0)}</span></div>`; }).join('')}
      </section>
    </div>
    <section class="card" style="margin-top:16px"><h2>Последние сессии <small>ММР примерно, ±${MMR_PER_GAME} за рейтинговую игру</small></h2>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Когда</th><th class="r">Длилась</th><th class="r">Игр</th><th class="r">W–L</th><th class="r">ММР</th><th>Игры</th></tr></thead>
      <tbody>${recent.map(s => `<tr><td>${dateTime(s.start)}</td><td class="num r">${dur(s.end - s.start)}</td><td class="num r">${s.games.length}</td>
        <td class="num r"><span class="win">${s.w}</span>–<span class="loss">${s.l}</span></td>
        <td class="num r ${s.net > 0 ? 'win' : s.net < 0 ? 'loss' : 'muted'}">${s.ranked ? (s.net > 0 ? '+' : s.net < 0 ? '−' : '±') + Math.abs(s.net * MMR_PER_GAME) : '—'}</td>
        <td><div class="form sform">${s.games.map(m => `<a href="#/m/${m.match_id}/${id}" class="${m.win ? 'w' : 'l'}" data-tip="<b>${esc(hero(m.hero_id).name)}</b><br>${m.win ? 'Победа' : 'Поражение'} · ${m.kills}/${m.deaths}/${m.assists}${m.lobby_type === 7 ? '' : "<br><span class='k'>не рейтинг</span>"}">${m.win ? 'W' : 'L'}</a>`).join('')}</div></td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:12px 0 0">Сессия — игры с перерывом меньше часа. Учитываются текущие фильтры сверху. Стоп-правило выбирается только если там 12+ игр и винрейт заметно ниже твоего среднего.</p>
    </section>`;
}
