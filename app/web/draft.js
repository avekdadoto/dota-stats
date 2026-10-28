'use strict';
/* Контрпик-помощник. Отмечаешь врагов (и своих), он считает, кого брать:
   контрпики по про-матчам + мета твоего ранга + твой личный винрейт на герое.
   Всё сглажено к 50%, чтоб герой с 3 играми не вылезал в топ на рандоме. */

S.draft = Object.assign({ enemy: [], ally: [], side: 'enemy', q: '', attr: '', role: '' }, lsGet('draft') || {});
S.heroMeta = new Map(); // hid -> промис /meta/hero

function heroMetaP(hid) {
  if (!S.heroMeta.has(hid)) {
    S.heroMeta.set(hid, api('/meta/hero/' + hid).catch(e => { S.heroMeta.delete(hid); throw e; }));
  }
  return S.heroMeta.get(hid);
}

// сглаживаем винрейт к 50%: (w + k/2) / (n + k) — «как будто сыграл ещё k игр 50 на 50»
const shrink = (w, n, k = 10) => (w + k / 2) / (n + k);

async function viewDraft(seq) {
  if (!S.meta) loading('Тяну мету…');
  await loadMeta();
  if (seq !== routeSeq) return;
  if (S.cfg.account_id && !S.players.has(S.cfg.account_id)) {
    loadPlayer(S.cfg.account_id).then(() => { if (location.hash.startsWith('#/draft') && seq === routeSeq) renderDraft(seq); }).catch(() => {});
  }
  renderDraft(seq);
}

async function renderDraft(seq) {
  const d = S.draft;
  const save = () => { lsSet('draft', { enemy: d.enemy, ally: d.ally, side: d.side, attr: d.attr, role: d.role }); renderDraft(seq); };
  const taken = new Set([...d.enemy, ...d.ally]);
  const all = Object.keys(S.C.heroes).map(Number).filter(id => S.meta.byId.has(id))
    .sort((a, b) => hero(a).name.localeCompare(hero(b).name));
  const q = d.q.toLowerCase();
  const slot = (arr, max, side) => {
    let h = '';
    for (let i = 0; i < max; i++) {
      const id = arr[i];
      h += id ? `<button class="dslot full" data-rm="${side}:${id}" title="Убрать"><img src="${esc(heroImg(id))}" alt=""><span>${esc(hero(id).name)}</span></button>`
        : `<button class="dslot${d.side === side ? ' on' : ''}" data-side="${side}">+</button>`;
    }
    return h;
  };

  app.innerHTML = `<section class="mhero-head"><div><h1>Контрпик</h1>
      <div class="muted">Отметь героев врагов (и своих, если уже пикнули) — подскажу, кого брать</div></div>
      <button class="btn sm" id="dclear">Очистить</button></section>
    <div class="dteams">
      <div class="dteam enemy ${d.side === 'enemy' ? 'on' : ''}" data-side="enemy"><div class="dt">Враги <small>${d.enemy.length}/5</small></div><div class="dslots">${slot(d.enemy, 5, 'enemy')}</div></div>
      <div class="dteam ally ${d.side === 'ally' ? 'on' : ''}" data-side="ally"><div class="dt">Свои <small>${d.ally.length}/4</small></div><div class="dslots">${slot(d.ally, 4, 'ally')}</div></div>
    </div>
    <div class="grid g-main" style="margin-top:16px">
      <section class="card">
        <h2>Кого брать <small id="dsub"></small></h2>
        <div class="filters" style="margin:0 0 10px">
          <div class="seg" id="dattr">${ATTRS.map(([v, l]) => `<button data-v="${v}" class="${d.attr === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <select id="drole"><option value="">Любая роль</option>${Object.entries(ROLES_RU).map(([k, n]) => `<option value="${k}" ${d.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <div id="dres"><div class="muted">Считаю…</div></div>
      </section>
      <section class="card" style="align-content:start">
        <h2>Герои <small>клик — в ${d.side === 'enemy' ? 'врагов' : 'своих'}</small></h2>
        <input class="inp" id="dq" placeholder="Найти героя…" value="${esc(d.q)}" style="width:100%;margin-bottom:10px">
        <div class="dgrid">${all.filter(id => !q || hero(id).name.toLowerCase().includes(q)).map(id =>
          `<button class="dh${taken.has(id) ? ' taken' : ''}" data-add="${id}" title="${esc(hero(id).name)}" ${taken.has(id) ? 'disabled' : ''}><img loading="lazy" src="${esc(heroImg(id))}" alt=""><span>${esc(hero(id).name)}</span></button>`).join('')}</div>
      </section>
    </div>`;

  $$('.dteam').forEach(t => t.onclick = e => { if (!e.target.closest('[data-rm]')) { d.side = t.dataset.side; save(); } });
  $$('[data-rm]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const [side, id] = b.dataset.rm.split(':');
    d[side] = d[side].filter(x => x !== +id);
    d.side = side;
    save();
  });
  $('.dgrid').onclick = e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const id = +b.dataset.add, arr = d[d.side];
    if (arr.length >= (d.side === 'enemy' ? 5 : 4)) { toast(d.side === 'enemy' ? 'Врагов уже 5, убери кого-то' : 'Своих уже 4, пятый — это ты'); return; }
    arr.push(id);
    if (d.side === 'enemy' && arr.length === 5 && d.ally.length < 4) d.side = 'ally';
    d.q = '';
    save();
  };
  const dq = $('#dq');
  dq.oninput = () => { d.q = dq.value; const pos = dq.selectionStart; renderDraft(seq); const n = $('#dq'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#dclear').onclick = () => { d.enemy = []; d.ally = []; d.side = 'enemy'; save(); };
  $('#dattr').onclick = e => { const b = e.target.closest('button'); if (b) { d.attr = b.dataset.v; save(); } };
  $('#drole').onchange = e => { d.role = e.target.value; save(); };

  // ── расчёт ──
  let ms;
  try { ms = await Promise.all(d.enemy.map(heroMetaP)); } catch (e) {
    const r = $('#dres'); if (r) r.innerHTML = `<div class="loss">${esc(e.message)}</div>`; return;
  }
  if (seq !== routeSeq || !$('#dres')) return;
  const mine = me();
  const br = mine ? myBracket(mine) : 'all';
  const myHs = mine ? new Map(heroStats(mine.list).map(h => [h.id, h])) : new Map();

  // против врага E: в его матчапах {hero_id: X, games_played, wins} — wins это победы E над X
  const vs = ms.map((m, i) => {
    const map = new Map();
    for (const x of m.matchups || []) {
      const g = x.games_played || 0, w = Math.min(g, x.wins || 0);
      map.set(x.hero_id, { g, adv: shrink(g - w, g) - 0.5 });
    }
    return { enemy: d.enemy[i], map };
  });

  const rows = [];
  for (const id of all) {
    if (taken.has(id)) continue;
    const h = hero(id);
    if (d.attr && h.attr !== d.attr) continue;
    if (d.role && !(h.roles || []).includes(d.role)) continue;
    const mh = S.meta.byId.get(id);
    const [pn, pw] = srcPW(mh, br);
    const metaAdv = shrink(pw, pn, 2000) - 0.5;
    const per = vs.map(v => ({ enemy: v.enemy, ...(v.map.get(id) || { g: 0, adv: 0 }) }));
    const counter = per.reduce((s, x) => s + x.adv, 0);
    const my = myHs.get(id);
    const myAdv = my ? shrink(my.w, my.n) - 0.5 : 0;
    // контрпики весят больше всего, мета и личный скилл — добавкой
    const score = counter + metaAdv + 0.6 * myAdv;
    rows.push({ id, per, counter, metaAdv, my, myAdv, score });
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 15), worst = d.enemy.length ? rows.slice(-5).reverse() : [];

  const sp = x => `<span class="num ${x >= 0 ? 'win' : 'loss'}">${signPct(x)}</span>`;
  const line = r => `<tr class="click" data-href="#/meta/${r.id}">
      <td>${heroCell(r.id, esc((hero(r.id).roles || []).slice(0, 2).map(x => ROLES_RU[x] || x).join(' · ')), true)}</td>
      <td class="r">${sp(r.score)}</td>
      <td><div class="dvs">${r.per.map(p => `<span data-tip="Против <b>${esc(hero(p.enemy).name)}</b>: ${signPct(p.adv)}<br><span class='k'>${p.g} про-игр</span>"><img src="${esc(heroImg(p.enemy))}" alt=""><i class="${p.adv >= 0 ? 'win' : 'loss'}">${p.g ? signPct(p.adv) : '?'}</i></span>`).join('') || '<span class="muted">—</span>'}</div></td>
      <td class="r" data-tip="Винрейт героя на ${esc(brName(br))} против 50%">${sp(r.metaAdv)}</td>
      ${mine ? `<td class="r" data-tip="${r.my ? `У тебя ${pct(r.my.wr)} на ${r.my.n} играх` : 'Ни разу не брал'}">${r.my ? sp(r.myAdv) + ` <span class="muted num">${r.my.n}</span>` : '<span class="muted">—</span>'}</td>` : ''}
    </tr>`;
  const head = `<thead><tr><th>Герой</th><th class="r">Итог</th><th>Против врагов</th><th class="r">Мета</th>${mine ? '<th class="r">Ты</th>' : ''}</tr></thead>`;
  $('#dsub').textContent = d.enemy.length ? `против ${d.enemy.length} ${plural(d.enemy.length, 'врага', 'врагов', 'врагов')} · мета ${brName(br)}` : `врагов нет — пока просто мета ${brName(br)}${mine ? ' + твой винрейт' : ''}`;
  $('#dres').innerHTML = `<div class="scroll-x"><table class="tbl">${head}<tbody>${top.map(line).join('')}</tbody></table></div>
    ${worst.length ? `<h2 style="margin-top:18px">Лучше не брать <small>больше всего страдают от этих врагов</small></h2>
      <div class="scroll-x"><table class="tbl">${head}<tbody>${worst.map(line).join('')}</tbody></table></div>` : ''}
    <p class="muted" style="font-size:12px;margin:12px 0 0">Итог = сумма преимуществ против каждого врага (про-матчи) + винрейт героя на твоём ранге + твой личный винрейт на нём.
      Всё сглажено к 50%, так что герой с парой игр не вылезет в топ случайно. ${mine ? '' : 'Войди через Steam — добавлю твой личный винрейт.'}</p>`;
  bindRowLinks($('#dres'));
}
