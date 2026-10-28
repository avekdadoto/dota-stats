'use strict';
/* Разбор матча: лайнинг к 10-й минуте, переломные моменты по графику золота,
   и личный вердикт по пунктам. Подключается во viewMatch через matchAnalysis(). */

const LANE_NAMES = { 1: 'Низ', 2: 'Мид', 3: 'Верх' };
const isRad = p => p.isRadiant ?? p.player_slot < 128;
const at = (arr, i) => (arr && arr.length ? arr[Math.min(i, arr.length - 1)] : null);

function laneReport(m) {
  const T = 10;
  const out = [];
  for (const lane of [1, 2, 3]) {
    const ps = m.players.filter(p => p.lane === lane && !p.is_roaming && p.gold_t && p.gold_t.length > T);
    const r = ps.filter(isRad), d = ps.filter(p => !isRad(p));
    if (!r.length || !d.length) continue;
    const sum = (xs, k) => xs.reduce((s, p) => s + (at(p[k], T) || 0), 0);
    const gold = sum(r, 'gold_t') - sum(d, 'gold_t');
    const lh = sum(r, 'lh_t') - sum(d, 'lh_t');
    // нетворс на линию считаем на героя, чтоб 2 vs 1 не выигрывали по сумме автоматом
    const per = sum(r, 'gold_t') / r.length - sum(d, 'gold_t') / d.length;
    const abs = Math.abs(per);
    const verdict = abs < 300 ? 'ровно' : abs < 900 ? 'выиграли' : 'разнесли';
    out.push({ lane, r, d, gold, lh, per, verdict, winner: abs < 300 ? null : per > 0 ? 'rad' : 'dire' });
  }
  return out;
}

function swings(m) {
  const a = m.radiant_gold_adv || [];
  if (a.length < 8) return [];
  const W = 3, cand = [];
  for (let i = 0; i + W < a.length; i++) cand.push({ i, j: i + W, d: a[i + W] - a[i] });
  cand.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const picked = [];
  for (const c of cand) {
    if (Math.abs(c.d) < 2500 || picked.length >= 3) break;
    if (picked.some(p => !(c.j <= p.i || c.i >= p.j))) continue;
    picked.push(c);
  }
  return picked.sort((x, y) => x.i - y.i).map(c => ({ ...c, from: a[c.i], to: a[c.j] }));
}

function matchAnalysis(m, meP) {
  if (!m.parsed) return '';
  const lanes = laneReport(m);
  const sw = swings(m);
  const a = m.radiant_gold_adv || [];
  const maxR = a.length ? Math.max(...a) : 0, maxD = a.length ? -Math.min(...a) : 0;
  const winner = m.radiant_win ? 'rad' : 'dire';
  const behind = winner === 'rad' ? maxD : maxR;
  // последний раз, когда лидер по золоту сменился
  let flip = null;
  for (let i = 1; i < a.length; i++) if (Math.sign(a[i]) !== Math.sign(a[i - 1]) && a[i] !== 0) flip = i;
  const side = s => s === 'rad' ? '<span class="win">Radiant</span>' : '<span class="loss">Dire</span>';
  const mySide = meP ? (isRad(meP) ? 'rad' : 'dire') : null;
  const us = s => mySide ? (s === mySide ? 'вы' : 'враги') : null;

  const story = [];
  if (behind >= 8000) story.push(`<b>Камбэк!</b> ${side(winner)} отставали на ${fmtK(behind)} золота и всё равно забрали.`);
  if (flip != null) story.push(`Последний раз лидер по золоту сменился на ${flip}-й минуте — дальше ${side(a[a.length - 1] >= 0 ? 'rad' : 'dire')} уже не отдали.`);
  else if (a.length > 5) story.push(`${side(a[a.length - 1] >= 0 ? 'rad' : 'dire')} вели по золоту почти всю игру.`);

  // ── личный вердикт ──
  const ins = [];
  if (meP) {
    const team = m.players.filter(p => isRad(p) === isRad(meP));
    const teamKills = team.reduce((s, p) => s + (p.kills || 0), 0);
    const kp = teamKills ? ((meP.kills || 0) + (meP.assists || 0)) / teamKills : null;
    const rankIn = k => [...team].sort((x, y) => (y[k] || 0) - (x[k] || 0)).indexOf(meP) + 1;
    const myLane = lanes.find(l => [...l.r, ...l.d].includes(meP));
    if (myLane) {
      const won = myLane.winner === mySide, lost = myLane.winner && myLane.winner !== mySide;
      ins.push({ cls: won ? 'good' : lost ? 'bad' : 'info', icon: won ? '⚔' : lost ? '🩸' : '⚖',
        title: won ? `Линию ${myLane.verdict === 'разнесли' ? 'разнесли' : 'выиграли'}` : lost ? `Линию ${myLane.verdict === 'разнесли' ? 'разнесли вас' : 'проиграли'}` : 'Линия вничью',
        text: `К 10-й минуте ${Math.abs(Math.round(myLane.per))} золота на героя ${myLane.per * (mySide === 'rad' ? 1 : -1) >= 0 ? 'в вашу пользу' : 'в пользу врага'}, крипов ${Math.abs(myLane.lh)} ${myLane.lh * (mySide === 'rad' ? 1 : -1) >= 0 ? 'больше' : 'меньше'}.` });
    }
    // бенчмарки: лучший и худший показатель против всех игроков на этом герое
    const B = { gold_per_min: 'фарм', xp_per_min: 'опыт', last_hits_per_min: 'добивание', hero_damage_per_min: 'урон по героям', kills_per_min: 'убийства', tower_damage: 'урон по строениям', hero_healing_per_min: 'лечение' };
    const bs = Object.entries(meP.benchmarks || {}).filter(([k, v]) => B[k] && v && v.pct != null && !(k === 'hero_healing_per_min' && !v.raw)).map(([k, v]) => ({ k, name: B[k], pct: v.pct }));
    if (bs.length) {
      bs.sort((x, y) => y.pct - x.pct);
      const top = bs[0], low = bs[bs.length - 1];
      if (top.pct >= 0.6) ins.push({ cls: 'good', icon: '▲', title: `Лучше всего — ${top.name}`, text: `Лучше ${Math.round(top.pct * 100)}% всех игроков на ${hero(meP.hero_id).name}.` });
      if (low.pct < 0.4 && low !== top) ins.push({ cls: 'bad', icon: '▼', title: `Провал — ${low.name}`, text: `Хуже ${100 - Math.round(low.pct * 100)}% игроков на этом герое.` });
    }
    if (kp != null) ins.push(kp >= 0.6 ? { cls: 'good', icon: '🤝', title: `Участие в убийствах ${pct(kp, 0)}`, text: 'Был везде, где дрались.' }
      : kp < 0.35 ? { cls: 'bad', icon: '🏝', title: `Участие в убийствах ${pct(kp, 0)}`, text: 'Тима дралась без тебя. Если ты не керри на фарме — это проблема.' }
        : { cls: 'info', icon: '🤝', title: `Участие в убийствах ${pct(kp, 0)}`, text: 'Нормально.' });
    const dRank = rankIn('deaths');
    if ((meP.deaths || 0) >= 8 && dRank === 1) ins.push({ cls: 'bad', icon: '💀', title: `${meP.deaths} смертей — больше всех в тиме`, text: `Это ≈${Math.round(meP.deaths * 35 / 60)} мин в таверне и ${fmt((meP.deaths || 0) * 150)}+ золота врагу.` });
    if (rankIn('net_worth') === 1) ins.push({ cls: 'good', icon: '💰', title: 'Самый богатый в тиме', text: `Нетворс ${fmtK(meP.net_worth)}.` });
    const sup = (meP.obs_placed || 0) + (meP.sen_placed || 0);
    const isSup = meP.lane_role === 3 && (meP.gold_per_min || 0) < 400 || (hero(meP.hero_id).roles || []).includes('Support') && (meP.gold_per_min || 0) < 420;
    if (isSup && m.duration > 1500) ins.push(sup >= m.duration / 60 / 2.5 ? { cls: 'good', icon: '👁', title: `${sup} вардов`, text: 'Карта светилась.' }
      : { cls: 'bad', icon: '🙈', title: `Всего ${sup} вардов за ${Math.round(m.duration / 60)} мин`, text: 'Для саппорта мало — тима играла вслепую.' });
    if ((meP.buyback_count || 0) > 0) ins.push({ cls: 'info', icon: '↩', title: `Выкуп ×${meP.buyback_count}`, text: meWinOf(m, meP) ? 'Окупился.' : 'Не спас.' });
  }

  const laneRow = l => {
    const names = ps => ps.map(p => `<img src="${esc(heroImg(p.hero_id))}" alt="" data-tip="${esc(hero(p.hero_id).name)}: ${fmt(at(p.gold_t, 10))} золота, ${at(p.lh_t, 10)} крипов к 10′">`).join('');
    const w = l.winner;
    return `<div class="lrow">
      <span class="lname">${LANE_NAMES[l.lane]}</span>
      <span class="lns ${w === 'rad' ? 'won' : w ? 'lost' : ''}">${names(l.r)}</span>
      <span class="lv ${w === 'rad' ? 'win' : w === 'dire' ? 'loss' : 'muted'}">${w ? `${w === 'rad' ? '◀' : ''} ${l.verdict} ${w === 'dire' ? '▶' : ''}` : 'ровно'}<small class="muted num">${l.per >= 0 ? '+' : '−'}${fmt(Math.abs(Math.round(l.per)))} на героя</small></span>
      <span class="lns ${w === 'dire' ? 'won' : w ? 'lost' : ''}">${names(l.d)}</span>
    </div>`;
  };

  return `<div class="grid ${meP ? 'g-main' : 'g2'}" style="margin-top:16px">
    <div class="grid" style="align-content:start">
      ${lanes.length ? `<section class="card"><h2>Лайнинг <small>к 10-й минуте · слева Radiant, справа Dire</small></h2>${lanes.map(laneRow).join('')}</section>` : ''}
      <section class="card"><h2>Как шла игра</h2>
        ${story.length ? `<p style="margin:0 0 10px">${story.join(' ')}</p>` : ''}
        ${sw.length ? sw.map(s => `<div class="swing"><span class="num muted">${s.i}′–${s.j}′</span>
          <span>${side(s.d > 0 ? 'rad' : 'dire')}${mySide ? ` <span class="muted">(${us(s.d > 0 ? 'rad' : 'dire')})</span>` : ''} отыграли <b class="num">${fmtK(Math.abs(s.d))}</b></span>
          <span class="muted num">${s.from >= 0 ? '+' : '−'}${fmtK(Math.abs(s.from))} → ${s.to >= 0 ? '+' : '−'}${fmtK(Math.abs(s.to))}</span></div>`).join('')
          : '<div class="muted">Резких разворотов не было — шли ровно.</div>'}
        <div class="muted" style="font-size:12px;margin-top:8px">Пик Radiant: +${fmtK(maxR)} · пик Dire: +${fmtK(maxD)}</div>
      </section>
    </div>
    ${meP ? `<section class="card" style="align-content:start"><h2>Твой разбор <small>${esc(hero(meP.hero_id).name)}</small></h2>
      <div class="insights">${ins.map(i => `<div class="ins ${i.cls}"><span class="i">${i.icon}</span><div><b>${esc(i.title)}</b><div class="t">${esc(i.text)}</div></div></div>`).join('') || '<div class="muted">Мало данных для разбора</div>'}</div></section>` : ''}
  </div>`;
}

function meWinOf(m, p) { return isRad(p) === m.radiant_win; }
