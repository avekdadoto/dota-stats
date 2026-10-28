'use strict';
/* «Рейтинг кентов»: ты + до 7 главных тиммейтов (по числу игр вместе) в одной таблице.
   Грузим их истории по очереди (по одной, чтоб не упереться в лимит OpenDota) и сравниваем
   за выбранный период. Плюс номинации: кто тащит, кто фидит, кто тильтует. */

S.squadPeriod = '180';

async function tabSquad(box, p, _l, id, seq) {
  box.innerHTML = '<div class="loading"><div class="spin"></div><div id="sqprog">Ищу твоих кентов…</div></div>';
  if (!S.peers.has(id)) S.peers.set(id, await api(`/player/${id}/peers`));
  if (seq !== routeSeq) return;
  const friends = S.peers.get(id).filter(x => x.account_id && x.with_games >= 10).sort((a, b) => b.with_games - a.with_games).slice(0, 7);
  if (!friends.length) { box.innerHTML = '<div class="empty-state">Нет кентов с 10+ играми вместе</div>'; return; }

  const crew = [{ id, p, together: null }];
  let i = 0;
  for (const f of friends) {
    const el = $('#sqprog');
    if (el) el.textContent = `Тяну историю ${f.personaname || f.account_id}… ${++i}/${friends.length}`;
    try { crew.push({ id: f.account_id, p: await loadPlayer(f.account_id), together: f }); }
    catch { crew.push({ id: f.account_id, p: null, together: f, err: true }); } // закрытый профиль
    if (seq !== routeSeq) return;
  }
  renderSquad(box, p, id, crew);
}

function renderSquad(box, p, id, crew) {
  const since = S.squadPeriod === 'all' ? 0 : Date.now() / 1000 - (+S.squadPeriod) * DAY;
  const rows = crew.filter(c => c.p).map(c => {
    const ms = c.p.list.filter(m => m.start_time >= since && m.game_mode !== 23);
    const a = agg(ms);
    const ranked = ms.filter(m => m.lobby_type === 7);
    const net = ranked.reduce((s, m) => s + (m.win ? 1 : -1), 0);
    const sess = splitSessions(ms);
    // тильт: винрейт после слива внутри сессии
    let al = 0, alw = 0;
    for (const s of sess) s.games.forEach((m, k) => { if (k && !s.games[k - 1].win) { al++; if (m.win) alw++; } });
    const hs = heroStats(ms).sort((x, y) => y.n - x.n);
    return { c, name: c.p.name, avatar: c.p.avatar, rank: c.p.rank_tier, n: ms.length, a, net, pace: ranked.length ? net * MMR_PER_GAME / ranked.length : null,
      afterL: al >= 8 ? alw / al : null, main: hs[0], hours: ms.reduce((s, m) => s + m.duration, 0) / 3600 };
  }).filter(r => r.n >= 5);
  const closed = crew.filter(c => !c.p);

  // номинации
  const by = (k, dir = 1, f = r => r.a[k]) => [...rows].filter(r => f(r) != null).sort((x, y) => dir * (f(y) - f(x)))[0];
  const noms = [
    ['👑', 'Тащер пати', by('wr'), r => `винрейт ${pct(r.a.wr)}`],
    ['💀', 'Главный фидер', by('d'), r => `${r.a.d.toFixed(1)} смертей за игру`],
    ['💰', 'Фармила', by('gpm'), r => `${fmt(r.a.gpm)} GPM`],
    ['🔪', 'Убийца', by('k'), r => `${r.a.k.toFixed(1)} убийств за игру`],
    ['🤝', 'Помогатор', by('a'), r => `${r.a.a.toFixed(1)} ассистов за игру`],
    ['🕹', 'Задрот', by('n', 1, r => r.n), r => `${r.n} игр, ${Math.round(r.hours)} ч`],
    ['📈', 'Апается', by('pace', 1, r => r.pace), r => `${r.pace >= 0 ? '+' : '−'}${Math.abs(r.pace).toFixed(1)} ММР за игру`],
    ['🌋', 'Тильтер', by('afterL', -1, r => r.afterL), r => `${pct(r.afterL)} после слива`],
  ].filter(n => n[2]);

  const COLS = [['n', 'Игр', r => r.n, v => fmt(v)], ['wr', 'Винрейт', r => r.a.wr, v => pct(v)], ['kda', 'KDA', r => r.a.kda, v => v.toFixed(2)],
    ['k', 'Убийств', r => r.a.k, v => v.toFixed(1)], ['d', 'Смертей', r => r.a.d, v => v.toFixed(1), -1], ['gpm', 'GPM', r => r.a.gpm, v => fmt(v)],
    ['xpm', 'XPM', r => r.a.xpm, v => fmt(v)], ['dmg', 'Урон', r => r.a.dmg, v => fmtK(v)], ['pace', 'ММР/игра', r => r.pace, v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1)],
    ['afterL', 'После слива', r => r.afterL, v => pct(v)]];
  const best = {};
  for (const [k, , f, , dir = 1] of COLS) {
    const vals = rows.map(f).filter(v => v != null);
    if (vals.length > 1) best[k] = dir > 0 ? Math.max(...vals) : Math.min(...vals);
  }
  rows.sort((x, y) => y.a.wr - x.a.wr);
  const sel = [['90', '3 мес'], ['180', '6 мес'], ['365', 'Год'], ['all', 'Всё время']];

  box.innerHTML = `
    <div class="filters" style="margin-top:0"><div class="seg" id="sqper">${sel.map(([v, l]) => `<button data-v="${v}" class="${S.squadPeriod === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="fcount">ты и ${rows.length - 1} ${plural(rows.length - 1, 'кент', 'кента', 'кентов')} · без турбо</span></div>
    <div class="noms">${noms.map(([ic, t, r, f]) => `<a class="nom" href="#/p/${r.c.id}"><span class="ni">${ic}</span><div><div class="nt">${t}</div><b>${esc(r.name)}</b><div class="muted">${esc(f(r))}</div></div></a>`).join('')}</div>
    <section class="card" style="margin-top:16px"><h2>Рейтинг <small>по винрейту, лучший в каждой колонке подсвечен</small></h2>
      <div class="scroll-x"><table class="tbl sq"><thead><tr><th>#</th><th>Игрок</th><th>Мейн</th>${COLS.map(c => `<th class="r">${c[1]}</th>`).join('')}<th class="r">Вместе</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="click${r.c.id === id ? ' me' : ''}" data-href="#/p/${r.c.id}">
        <td class="num muted">${i + 1}</td>
        <td><div class="sqp">${r.avatar ? `<img src="${esc(r.avatar)}" alt="">` : ''}<span>${esc(r.name)}${r.c.id === id ? ' <span class="badge acc">ты</span>' : ''}<small class="muted">${esc(rankName(r.rank))}</small></span></div></td>
        <td>${r.main ? `<img class="sqh" src="${esc(heroImg(r.main.id))}" alt="" data-tip="${esc(hero(r.main.id).name)} · ${r.main.n} игр">` : ''}</td>
        ${COLS.map(([k, , f, fv]) => { const v = f(r); return `<td class="num r${v != null && best[k] === v ? ' best' : ''}">${v == null ? '—' : fv(v)}</td>`; }).join('')}
        <td class="num r">${r.c.together ? `<a href="#/cmp/${id}/${r.c.id}" class="${wrCls(r.c.together.with_win / r.c.together.with_games)}" data-tip="${r.c.together.with_games} игр вместе — сравнить">${pct(r.c.together.with_win / r.c.together.with_games, 0)}</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>
      ${closed.length ? `<p class="muted" style="font-size:12px;margin:10px 0 0">Закрытые профили: ${closed.map(c => esc(c.together.personaname || c.id)).join(', ')}</p>` : ''}
    </section>`;
  $('#sqper', box).onclick = e => { const b = e.target.closest('button'); if (b) { S.squadPeriod = b.dataset.v; renderSquad(box, p, id, crew); } };
  bindRowLinks(box);
}
