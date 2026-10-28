'use strict';
/* Досье «ты на герое»: #/p/<id>/hero/<hid>. Всё по матчам игрока на этом герое
   + матчапы именно когда он на нём (OpenDota /players/{id}/heroes?hero_id=…) + мета. */

async function viewMyHero(id, hid, seq) {
  if (!S.players.has(id)) loading('Тяну матчи…');
  const p = await loadPlayer(id);
  await loadMeta(true);
  if (seq !== routeSeq) return;
  const all = p.list.filter(m => m.hero_id === hid);
  const h = hero(hid);
  const back = `<a class="btn sm" href="#/p/${id}/heroes">‹ к героям</a>`;
  if (!all.length) {
    app.innerHTML = `${back}<div class="err"><h3>${esc(p.name)} ни разу не играл на ${esc(h.name)}</h3><a class="btn" href="#/meta/${hid}">Мета героя</a></div>`;
    return;
  }
  const a = agg(all);
  const asc = [...all].sort((x, y) => x.start_time - y.start_time);
  const others = heroStats(p.list).sort((x, y) => y.n - x.n);
  const place = others.findIndex(x => x.id === hid) + 1;
  const br = myBracket(p);
  const mh = S.meta && S.meta.byId.get(hid);
  const base = mh ? srcWr(mh, br) : null;
  const tierRow = S.meta ? metaRows(br).rows.find(r => r.id === hid) : null;

  // скользящий винрейт по играм на герое
  const W = Math.max(5, Math.min(20, Math.floor(asc.length / 4)));
  const roll = [];
  for (let i = W - 1; i < asc.length; i++) {
    const s = asc.slice(i - W + 1, i + 1), w = s.filter(m => m.win).length;
    roll.push({ label: String(i + 1), value: w / W, tip: `<b>${i + 1}-я игра на герое</b><br>${pct(w / W)} за последние ${W}<br><span class='k'>${date(asc[i].start_time)}</span>` });
  }
  if (roll.length >= 2) S.charts.push({ id: 'mhroll', type: 'line', title: 'Винрейт по ходу игр', yMin: 0, yMax: 1, ref: base ?? 0.5, fmtY: v => Math.round(v * 100) + '%', color: 'var(--accent-hi)', data: roll });
  // первые 10 vs последние 10
  const first = agg(asc.slice(0, Math.min(10, Math.floor(asc.length / 2)))), lastA = agg(asc.slice(-Math.min(10, Math.floor(asc.length / 2))));

  const split = (keyFn, nameFn, minN = 3) => [...groupBy(all, keyFn)].map(([k, ms]) => Object.assign(agg(ms), { k, name: nameFn(k) })).filter(x => x.n >= minN).sort((x, y) => y.n - x.n);
  const lanes = split(m => m.lane_role || null, k => LANES[k] || k);
  const party = split(m => m.party_size > 1 ? 'p' : m.party_size === 1 ? 's' : null, k => k === 'p' ? 'В пати' : 'Соло');
  const durs = split(m => m.duration < 1800 ? 0 : m.duration < 2700 ? 1 : 2, k => ['До 30 мин', '30–45 мин', '45+ мин'][k]);
  const modes = split(m => m.lobby_type === 7 ? 'r' : m.game_mode === 23 ? 't' : 'n', k => ({ r: 'Рейтинг', t: 'Турбо', n: 'Обычные' }[k]));
  const splitBlock = (title, arr) => `<section class="card"><h2>${title}</h2>${arr.length ? arr.map(x => `<div class="slen" style="grid-template-columns:90px 1fr 40px 56px" data-tip="${x.w}–${x.l} · KDA ${x.kda.toFixed(2)} · GPM ${fmt(x.gpm)}">
      <span>${esc(x.name)}</span><span class="bar"><i class="${wrCls(x.wr)}" style="width:${(x.wr * 100).toFixed(1)}%"></i></span>
      <span class="num muted">${x.n}</span><span class="num ${wrCls(x.wr)}">${pct(x.wr, 0)}</span></div>`).join('') : '<div class="muted">Мало игр</div>'}</section>`;

  const real = all.filter(m => m.duration > 600 && m.lobby_type !== 1 && m.lobby_type !== 4);
  const best = f => real.reduce((b, m) => (m[f] != null && (!b || m[f] > b[f]) ? m : b), null);
  const recs = [['Убийств', best('kills'), m => m.kills], ['GPM', best('gold_per_min'), m => m.gold_per_min], ['Урон', best('hero_damage'), m => fmtK(m.hero_damage)], ['KDA', best('kda'), m => m.kda.toFixed(1)]].filter(r => r[1]);
  const fastWin = real.filter(m => m.win).sort((x, y) => x.duration - y.duration)[0];

  app.innerHTML = `${back}
    <section class="phead" style="margin-top:12px">
      <img class="ava" src="${esc(heroImg(hid))}" alt="" style="width:150px;height:84px">
      <div class="who"><h1>${esc(h.name)}</h1>
        <div class="sub"><a href="#/p/${id}">${esc(p.name)}</a><span>#${place} по числу игр</span><span>последняя ${ago(asc[asc.length - 1].start_time)}</span>
        <a href="#/meta/${hid}">мета героя →</a></div></div>
      <div class="stats">
        <div class="stat"><div class="v num">${fmt(a.n)}</div><div class="l">игр</div></div>
        <div class="stat"><div class="v num ${wrCls(a.wr)}">${pct(a.wr)}</div><div class="l">винрейт</div></div>
        ${tierRow ? `<div class="stat"><div class="v">${tierBadge(tierRow.tier)}</div><div class="l">тир ${esc(brName(br))}</div></div>` : ''}
      </div>
    </section>
    <div class="tiles" style="margin-top:16px">
      <div class="tile"><div class="v num">${a.kda.toFixed(2)}</div><div class="l">KDA</div><div class="s num">${a.k.toFixed(1)} / ${a.d.toFixed(1)} / ${a.a.toFixed(1)}</div></div>
      <div class="tile"><div class="v num">${fmt(a.gpm)}</div><div class="l">GPM</div><div class="s">XPM ${fmt(a.xpm)}</div></div>
      <div class="tile"><div class="v num">${fmt(a.lh)}</div><div class="l">крипов</div><div class="s">${dur(a.dur)} в среднем</div></div>
      ${base != null ? `<div class="tile"><div class="v num ${a.wr >= base ? 'win' : 'loss'}">${signPct(a.wr - base)}</div><div class="l">vs ${esc(brName(br))}</div><div class="s">у всех ${pct(base)}</div></div>` : ''}
      <div class="tile"><div class="v num ${lastA.wr >= first.wr ? 'win' : 'loss'}">${pct(first.wr, 0)} → ${pct(lastA.wr, 0)}</div><div class="l">первые → последние</div><div class="s">${lastA.wr > first.wr + 0.05 ? 'прогрессируешь' : lastA.wr < first.wr - 0.05 ? 'деградируешь' : 'стабильно'}</div></div>
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <section class="card"><h2>Винрейт по ходу игр <small>скользящий по ${W}, пунктир — средний на твоём ранге</small></h2>${roll.length >= 2 ? chartBox('mhroll', 220) : '<div class="empty-state">Мало игр для графика</div>'}</section>
      <div class="grid" style="align-content:start">${splitBlock('Линия', lanes)}${splitBlock('Соло / пати', party)}</div>
    </div>
    <div class="grid g2" style="margin-top:16px">${splitBlock('Длительность', durs)}${splitBlock('Режим', modes)}</div>
    <div id="mhmu" class="grid g2" style="margin-top:16px"><section class="card"><div class="muted">Считаю матчапы на герое…</div></section></div>
    <section class="card" style="margin-top:16px"><h2>Рекорды на герое</h2><div class="recs">
      ${recs.map(([l, m, f]) => recCard(l, f(m), m, id)).join('')}${fastWin ? recCard('Самая быстрая победа', dur(fastWin.duration), fastWin, id) : ''}</div></section>
    <section class="card" style="margin-top:16px"><h2>Последние матчи <span class="r"><a href="#/p/${id}/matches" id="mhall">все ${a.n} →</a></span></h2>
      <div class="scroll-x"><table class="tbl" id="mhrec"><tbody>${all.slice(0, 12).map(m => matchRow(m, id, false, true)).join('')}</tbody></table></div></section>`;
  $('#mhall').onclick = () => { S.filters = { period: 'all', mode: 'all', hero: String(hid), lane: '', result: 'all' }; S.page = 0; lsSet('filters', S.filters); };
  bindRowLinks(app);
  drawCharts();

  // матчапы именно когда игрок на этом герое
  try {
    const rows = (await api(`/player/${id}/heroes?hero_id=${hid}`)).filter(r => S.C.heroes[r.hero_id]);
    if (seq !== routeSeq) return;
    const minN = all.length >= 100 ? 5 : 3;
    const mk = (g, wk) => rows.filter(r => r[g] >= minN).map(r => { const n = r[g], w = Math.min(n, r[wk] || 0); return { id: r.hero_id, n, w, wr: w / n, good: wilson(w, n), bad: wilson(n - w, n) }; });
    const vs = mk('against_games', 'against_win'), wt = mk('with_games', 'with_win');
    const lst = (arr, k, good) => {
      const xs = arr.filter(x => good ? x.wr > 0.5 : x.wr < 0.5).sort((x, y) => y[k] - x[k]).slice(0, 6);
      return xs.length ? xs.map(x => `<a class="mu" href="#/meta/${x.id}">${heroCell(x.id, `${x.n} ${plural(x.n, 'игра', 'игры', 'игр')}`, true)}<span class="num ${good ? 'win' : 'loss'}">${pct(x.wr, 0)}</span></a>`).join('') : `<div class="muted">Нет героев с ${minN}+ играми</div>`;
    };
    $('#mhmu').innerHTML = `
      <section class="card"><h2>Против кого сливаешь <small>когда ты на ${esc(h.name)}</small></h2><div class="mus">${lst(vs, 'bad', false)}</div></section>
      <section class="card"><h2>Против кого тащишь</h2><div class="mus">${lst(vs, 'good', true)}</div></section>
      <section class="card"><h2>С кем заходит</h2><div class="mus">${lst(wt, 'good', true)}</div></section>
      <section class="card"><h2>С кем не клеится</h2><div class="mus">${lst(wt, 'bad', false)}</div></section>`;
  } catch (e) {
    const el = $('#mhmu');
    if (el) el.innerHTML = `<section class="card"><div class="muted">Матчапы не загрузились: ${esc(e.message)}</div></section>`;
  }
}
