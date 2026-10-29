'use strict';
/* 1) «Драфт или руки?» — в разборе матча: шанс победы по драфту (контрпики про-матчей + мета),
      лучшие и худшие пики каждой стороны, и вердикт — слили драфт или руки.
   2) «Герой против героя» — #/meta/vs/A/B: два героя бок о бок. */

const isRadP = p => p.isRadiant ?? p.player_slot < 128;
const draftProb = x => Math.max(0.1, Math.min(0.9, 1 / (1 + Math.exp(-3 * x))));

async function draftAnalysis(m, meP, seq) {
  const box = $('#draftan');
  if (!box) return;
  const R = m.players.filter(isRadP).map(p => p.hero_id).filter(Boolean);
  const D = m.players.filter(p => !isRadP(p)).map(p => p.hero_id).filter(Boolean);
  if (R.length !== 5 || D.length !== 5) { box.remove(); return; }
  box.innerHTML = '<section class="card"><div class="muted">Считаю драфт…</div></section>';
  let mus;
  try {
    await loadMeta(true);
    mus = await Promise.all(R.map(heroMetaP));
  } catch (e) {
    if (seq === routeSeq && $('#draftan')) $('#draftan').innerHTML = `<section class="card"><div class="muted">Драфт не посчитался: ${esc(e.message)}</div></section>`;
    return;
  }
  if (seq !== routeSeq || !$('#draftan')) return;

  // adv[r][d] — преимущество героя Radiant над героем Dire по про-матчам, сглаженное к 0
  const adv = R.map((r, i) => {
    const map = new Map((mus[i].matchups || []).map(x => [x.hero_id, x]));
    return D.map(d => { const x = map.get(d); const g = x ? x.games_played || 0 : 0, w = x ? Math.min(g, x.wins || 0) : 0; return { g, a: shrink(w, g) - 0.5 }; });
  });
  const metaA = hid => { const mh = S.meta && S.meta.byId.get(hid); if (!mh) return 0; const [n, w] = srcPW(mh, 'all'); return shrink(w, n, 2000) - 0.5; };
  const counter = adv.flat().reduce((s, x) => s + x.a, 0);
  const metaDiff = R.reduce((s, h) => s + metaA(h), 0) - D.reduce((s, h) => s + metaA(h), 0);
  const pR = draftProb(counter + metaDiff);
  const contrib = [
    ...R.map((h, i) => ({ h, side: 'rad', v: adv[i].reduce((s, x) => s + x.a, 0) + metaA(h) })),
    ...D.map((h, j) => ({ h, side: 'dire', v: -adv.reduce((s, row) => s + row[j].a, 0) + metaA(h) })),
  ];
  // самая жёсткая пара на всей карте
  let hard = null;
  adv.forEach((row, i) => row.forEach((x, j) => { if (x.g >= 10 && (!hard || Math.abs(x.a) > Math.abs(hard.a))) hard = { r: R[i], d: D[j], ...x }; }));

  const mySide = meP ? (isRadP(meP) ? 'rad' : 'dire') : null;
  const pUs = mySide ? (mySide === 'rad' ? pR : 1 - pR) : null;
  const won = mySide ? (mySide === 'rad') === m.radiant_win : null;
  let verdict = null;
  if (mySide) {
    if (won && pUs < 0.42) verdict = { cls: 'good', icon: '💪', t: 'Вытащили руками', x: `Драфт был за врагов (${pct(1 - pUs, 0)}), а вы всё равно забрали.` };
    else if (won && pUs > 0.58) verdict = { cls: 'good', icon: '🧠', t: 'Выиграли ещё на драфте', x: `Пик был за вас (${pct(pUs, 0)}) — и вы это реализовали.` };
    else if (!won && pUs > 0.58) verdict = { cls: 'bad', icon: '🤦', t: 'Слили выигранный драфт', x: `Пик был за вас (${pct(pUs, 0)}). Это руки, а не герои.` };
    else if (!won && pUs < 0.42) verdict = { cls: 'bad', icon: '🧱', t: 'Проиграли на драфте', x: `Пик был за врагов (${pct(1 - pUs, 0)}). Сложно было с самого начала.` };
    else verdict = { cls: 'info', icon: '⚖', t: 'Драфт примерно ровный', x: `${pct(pUs, 0)} на ${pct(1 - pUs, 0)} — игру решили руки.` };
  }
  const pickRow = c => `<a class="mu" href="#/meta/${c.h}">${heroCell(c.h, mySide ? (c.side === mySide ? 'ваш' : 'враг') : (c.side === 'rad' ? 'Radiant' : 'Dire'), true)}<span class="num ${c.v >= 0 ? 'win' : 'loss'}">${signPct(c.v)}</span></a>`;
  const side = s => contrib.filter(c => c.side === s).sort((a, b) => b.v - a.v);
  const radS = side('rad'), dirS = side('dire');

  $('#draftan').innerHTML = `<section class="card"><h2>Драфт или руки? <small>контрпики по про-матчам + мета пабликов</small></h2>
    <div class="dprob"><div class="dpl"><span class="win">Radiant ${pct(pR, 0)}</span><b>Шанс по драфту</b><span class="loss">${pct(1 - pR, 0)} Dire</span></div>
      <span class="dpb"><i style="width:${(pR * 100).toFixed(1)}%"></i></span></div>
    ${verdict ? `<div class="ins ${verdict.cls}" style="margin-bottom:12px"><span class="i">${verdict.icon}</span><div><b>${esc(verdict.t)}</b><div class="t">${esc(verdict.x)}</div></div></div>` : ''}
    <div class="grid g2">
      <div><div class="muted" style="font-size:12px;margin-bottom:4px">Пики Radiant, лучший сверху</div><div class="mus">${radS.map(pickRow).join('')}</div></div>
      <div><div class="muted" style="font-size:12px;margin-bottom:4px">Пики Dire, лучший сверху</div><div class="mus">${dirS.map(pickRow).join('')}</div></div>
    </div>
    ${hard ? `<p class="muted" style="font-size:12px;margin:10px 0 0">Самый жёсткий контрпик в игре: ${esc(hero(hard.a >= 0 ? hard.r : hard.d).name)} против ${esc(hero(hard.a >= 0 ? hard.d : hard.r).name)} (${signPct(Math.abs(hard.a))} на ${hard.g} про-играх).</p>` : ''}
    <p class="muted" style="font-size:12px;margin:6px 0 0">Оценка, а не приговор: не учитывает роли, линии и руки. Число у героя — сколько он добавил своей стороне.</p>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Герой против героя
// ─────────────────────────────────────────────────────────────────────────────
async function viewHeroVs(a, b, seq) {
  loading('Сравниваю героев…');
  await loadMeta();
  if (S.cfg.account_id && !S.players.has(S.cfg.account_id)) { try { await loadPlayer(S.cfg.account_id); } catch { /* без личной статы */ } }
  const [ma, mb] = await Promise.all([heroMetaP(a), heroMetaP(b)]);
  if (seq !== routeSeq) return;
  const mine = me();
  const br = mine ? myBracket(mine) : 'all';
  const myHs = mine ? new Map(heroStats(mine.list).map(h => [h.id, h])) : new Map();
  const tierOf = (src, id) => (metaRows(src).rows.find(r => r.id === id) || {});
  const stats = id => {
    const pro = tierOf('pro', id), pub = tierOf('all', id), mybr = tierOf(br, id), turbo = tierOf('turbo', id);
    return { id, pro, pub, mybr, turbo, my: myHs.get(id) };
  };
  const A = stats(a), B = stats(b);
  // лоб в лоб: в матчапах A ищем B (wins — победы A)
  const hh = (ma.matchups || []).find(x => x.hero_id === b);
  const hhG = hh ? hh.games_played || 0 : 0, hhW = hh ? Math.min(hhG, hh.wins || 0) : 0;
  const counters = (mu, self) => (mu.matchups || []).filter(x => x.hero_id !== self && x.games_played >= 10 && S.C.heroes[x.hero_id])
    .map(x => ({ id: x.hero_id, n: x.games_played, wr: x.wins / x.games_played, bad: wilson(x.games_played - x.wins, x.games_played) }))
    .sort((x, y) => y.bad - x.bad).slice(0, 4);

  const ROWS = [
    ['Тир про', s => s.pro.tier, s => s.pro.tier != null ? tierBadge(s.pro.tier) : '—', -1],
    ['Тир паблик', s => s.pub.tier, s => s.pub.tier != null ? tierBadge(s.pub.tier) : '—', -1],
    ...(br !== 'all' ? [[`Тир ${brName(br)}`, s => s.mybr.tier, s => s.mybr.tier != null ? tierBadge(s.mybr.tier) : '—', -1]] : []),
    ['WR про', s => s.pro.n ? s.pro.wr : null, s => s.pro.n ? pct(s.pro.wr) : '—', 1],
    ['Про-пиков', s => s.pro.n, s => fmt(s.pro.n), 1],
    ['Про-банов', s => s.pro.ban, s => fmt(s.pro.ban), 1],
    ['WR паблик', s => s.pub.wr, s => pct(s.pub.wr), 1],
    ['Пикрейт паблик', s => s.pub.pr, s => pct(s.pub.pr), 1],
    ...(br !== 'all' ? [[`WR ${brName(br)}`, s => s.mybr.wr, s => pct(s.mybr.wr), 1]] : []),
    ['WR турбо', s => s.turbo.n ? s.turbo.wr : null, s => s.turbo.n ? pct(s.turbo.wr) : '—', 1],
    ...(mine ? [['Твоих игр', s => s.my ? s.my.n : 0, s => s.my ? fmt(s.my.n) : '0', 1],
      ['Твой WR', s => s.my && s.my.n >= 3 ? s.my.wr : null, s => s.my && s.my.n ? pct(s.my.wr) : '—', 1]] : []),
  ];
  let scoreA = 0, scoreB = 0;
  const rowsHtml = ROWS.map(([label, val, show, dir]) => {
    const va = val(A), vb = val(B);
    let wa = false, wb = false;
    if (va != null && vb != null && va !== vb) { if ((va - vb) * dir > 0) { wa = true; scoreA++; } else { wb = true; scoreB++; } }
    return `<tr><td class="r ${wa ? 'best' : ''}">${show(A)}</td><td class="vsl">${esc(label)}</td><td class="${wb ? 'best' : ''}">${show(B)}</td></tr>`;
  }).join('');
  const all = Object.keys(S.C.heroes).map(Number).filter(id => S.meta.byId.has(id)).sort((x, y) => hero(x).name.localeCompare(hero(y).name));
  const sel = (cur, name) => `<select data-vs="${name}">${all.map(id => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(hero(id).name)}</option>`).join('')}</select>`;
  const head = s => `<div class="vsh"><a href="#/meta/${s.id}"><img src="${esc(heroImg(s.id))}" alt=""></a><h2>${esc(hero(s.id).name)}</h2></div>`;
  const ctr = (s, mu) => `<div class="mus">${counters(mu, s.id).map(x => `<a class="mu" href="#/meta/${x.id}">${heroCell(x.id, `${x.n} про-игр`, true)}<span class="num loss">${pct(x.wr, 0)}</span></a>`).join('') || '<div class="muted">Мало игр</div>'}</div>`;

  app.innerHTML = `<a class="btn sm" href="#/meta/${a}">‹ к ${esc(hero(a).name)}</a>
    <section class="card" style="margin-top:12px">
      <div class="vsgrid">${head(A)}<div class="vsmid"><div class="num vsscore"><span class="${scoreA >= scoreB ? 'win' : ''}">${scoreA}</span> : <span class="${scoreB >= scoreA ? 'win' : ''}">${scoreB}</span></div><div class="muted">по пунктам</div></div>${head(B)}</div>
      <div class="vsgrid" style="margin-top:8px">${sel(a, 'a')}<span></span>${sel(b, 'b')}</div>
      <table class="tbl vst"><tbody>${rowsHtml}</tbody></table>
    </section>
    <section class="card" style="margin-top:16px"><h2>Лоб в лоб <small>про-матчи, где они были по разные стороны</small></h2>
      ${hhG ? `<div class="dprob" style="margin:0"><div class="dpl"><span class="win">${esc(hero(a).name)} ${pct(hhW / hhG, 0)}</span><b>${hhG} ${plural(hhG, 'игра', 'игры', 'игр')}</b><span class="loss">${pct(1 - hhW / hhG, 0)} ${esc(hero(b).name)}</span></div>
        <span class="dpb"><i style="width:${(hhW / hhG * 100).toFixed(1)}%"></i></span></div>` : '<div class="muted">На про-сцене друг против друга почти не встречались.</div>'}
    </section>
    <div class="grid g2" style="margin-top:16px">
      <section class="card"><h2>Кто контрит ${esc(hero(a).name)}</h2>${ctr(A, ma)}</section>
      <section class="card"><h2>Кто контрит ${esc(hero(b).name)}</h2>${ctr(B, mb)}</section>
    </div>`;
  $$('[data-vs]').forEach(s => s.onchange = () => {
    const na = s.dataset.vs === 'a' ? +s.value : a, nb = s.dataset.vs === 'b' ? +s.value : b;
    location.hash = `#/meta/vs/${na}/${nb}`;
  });
}
