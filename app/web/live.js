'use strict';
/* «Лайв» — топовые игры, которые идут прямо сейчас (OpenDota /live, это витрина Valve).
   «Про» — база про-игроков с поиском, кнопкой «открыть» и «сравнить со мной». */

let liveTimer = null;
S.liveOpt = Object.assign({ only: 'all' }, lsGet('liveOpt') || {});

async function viewLive(seq) {
  clearInterval(liveTimer);
  if (!S.live) loading('Смотрю, кто сейчас играет…');
  const load = async () => {
    try { S.live = { at: Date.now(), rows: await api('/live') }; }
    catch (e) { if (!S.live) throw e; toast(esc(e.message)); }
  };
  if (!S.live || Date.now() - S.live.at > 30000) await load();
  if (seq !== routeSeq) return;
  renderLive(seq);
  // автообновление раз в 30 сек, пока страница открыта
  liveTimer = setInterval(async () => {
    if (seq !== routeSeq || !location.hash.startsWith('#/live')) { clearInterval(liveTimer); return; }
    await load();
    if (seq === routeSeq) renderLive(seq);
  }, 30000);
}

function renderLive(seq) {
  const o = S.liveOpt;
  const rows = (S.live.rows || []).filter(g => (g.players || []).length >= 10 || g.team_name_radiant)
    .map(g => Object.assign(g, { pro: !!(g.league_id || g.team_name_radiant || (g.players || []).some(p => p.is_pro)) }))
    .filter(g => o.only === 'all' || (o.only === 'pro' ? g.pro : !g.pro))
    .sort((a, b) => (b.pro - a.pro) || (b.average_mmr || 0) - (a.average_mmr || 0));
  const side = (g, t) => (g.players || []).filter(p => p.team === t);
  const pl = p => `<a class="lp" ${p.account_id ? `href="#/p/${p.account_id}"` : ''} data-tip="<b>${esc(hero(p.hero_id).name)}</b><br>${esc(p.name || 'аноним')}${p.is_pro ? '<br><span class=k>про</span>' : ''}">
      ${p.hero_id ? `<img src="${esc(heroImg(p.hero_id))}" alt="">` : '<span class="lq">?</span>'}<span class="${p.is_pro ? 'gold' : ''}">${esc(p.name || '—')}</span></a>`;
  const card = g => {
    const lead = g.radiant_lead || 0;
    const leadPct = Math.max(-1, Math.min(1, lead / 20000));
    return `<section class="card live">
      <div class="lh">
        <span class="badge ${g.pro ? 'gold' : ''}">${g.pro ? 'ПРО' : 'паблик'}</span>
        ${g.average_mmr ? `<span class="muted">≈${fmt(g.average_mmr)} ММР</span>` : ''}
        <span class="muted">${g.game_time > 0 ? mmss(g.game_time) : 'драфт'}</span>
        ${g.spectators ? `<span class="muted">👁 ${fmt(g.spectators)}</span>` : ''}
        <span class="muted r num">#${g.match_id}</span>
      </div>
      <div class="ls">
        <span class="lt rad">${esc(g.team_name_radiant || 'Radiant')}</span>
        <span class="num lsc"><span class="win">${g.radiant_score ?? 0}</span> : <span class="loss">${g.dire_score ?? 0}</span></span>
        <span class="lt dire">${esc(g.team_name_dire || 'Dire')}</span>
      </div>
      <div class="llead" data-tip="Преимущество по золоту: ${lead >= 0 ? 'Radiant' : 'Dire'} +${fmt(Math.abs(lead))}">
        <i style="${leadPct >= 0 ? `right:50%;width:${leadPct * 50}%;background:var(--win)` : `left:50%;width:${-leadPct * 50}%;background:var(--loss)`}"></i>
        <span class="num">${lead ? (lead > 0 ? '◀ ' : '') + fmtK(Math.abs(lead)) + (lead < 0 ? ' ▶' : '') : 'ровно'}</span>
      </div>
      <div class="lteams"><div>${side(g, 0).map(pl).join('')}</div><div>${side(g, 1).map(pl).join('')}</div></div>
    </section>`;
  };
  app.innerHTML = `<section class="mhero-head"><div><h1>Лайв</h1>
      <div class="muted">Топовые игры прямо сейчас · обновляется каждые 30 сек · ${new Date(S.live.at).toLocaleTimeString('ru-RU')}</div></div>
      <div class="seg" id="lonly">${[['all', 'Все'], ['pro', 'Про'], ['pub', 'Паблики']].map(([v, l]) => `<button data-v="${v}" class="${o.only === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </section>
    <div class="lgrid">${rows.map(card).join('') || '<div class="empty-state">Сейчас никого нет</div>'}</div>
    <p class="muted" style="font-size:12px">Это витрина Valve: топовые игры по зрителям и ММР. Клик по игроку — его профиль (если он открыт). Счёт и золото обновляются с задержкой Valve.</p>`;
  $('#lonly').onclick = e => { const b = e.target.closest('button'); if (b) { o.only = b.dataset.v; lsSet('liveOpt', o); renderLive(seq); } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Про-игроки
// ─────────────────────────────────────────────────────────────────────────────
S.prosOpt = { q: '', role: '', page: 0 };
const PRO_ROLES = { 1: 'Кор', 2: 'Саппорт', 4: 'Мид' };

async function viewPros(seq) {
  if (!S.pros) loading('Тяну базу про-игроков…');
  if (!S.pros) S.pros = (await api('/pros')).filter(p => p.account_id && (p.name || p.personaname));
  if (seq !== routeSeq) return;
  renderPros();
}

function renderPros() {
  const o = S.prosOpt;
  const q = o.q.trim().toLowerCase();
  const recent = Date.now() / 1000 - 180 * DAY;
  let rows = S.pros.filter(p => {
    if (o.role && String(p.fantasy_role) !== o.role) return false;
    if (!q) return true;
    return [p.name, p.personaname, p.team_name, p.team_tag].some(x => x && x.toLowerCase().includes(q));
  });
  // сначала с командой и недавно игравшие
  const lm = p => p.last_match_time ? Date.parse(p.last_match_time) / 1000 : 0;
  rows.sort((a, b) => (!!b.team_name - !!a.team_name) || ((lm(b) > recent) - (lm(a) > recent)) || (a.team_name || '').localeCompare(b.team_name || '') || (a.name || '').localeCompare(b.name || ''));
  const PER = 60;
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  o.page = Math.min(o.page, pages - 1);
  const shown = rows.slice(o.page * PER, o.page * PER + PER);
  const me = S.cfg.account_id;
  app.innerHTML = `<section class="mhero-head"><div><h1>Про-игроки</h1><div class="muted">${fmt(S.pros.length)} в базе OpenDota · клик — его статистика</div></div></section>
    <div class="filters">
      <input class="inp" id="pq" placeholder="Ник или команда: Yatoro, Spirit, Tundra…" value="${esc(o.q)}" style="width:320px">
      <div class="seg" id="prole">${[['', 'Все'], ['1', 'Кор'], ['4', 'Мид'], ['2', 'Саппорт']].map(([v, l]) => `<button data-v="${v}" class="${o.role === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="fcount">${fmt(rows.length)} ${plural(rows.length, 'игрок', 'игрока', 'игроков')}</span>
    </div>
    <div class="pgrid">${shown.map(p => `<div class="pro">
        <a href="#/p/${p.account_id}" class="pa">${p.avatarfull ? `<img src="${esc(p.avatarfull)}" alt="" loading="lazy">` : '<span class="noava">◉</span>'}
          <div><b>${esc(p.name || p.personaname)}</b><div class="muted">${p.team_name ? esc(p.team_name) : 'без команды'}${PRO_ROLES[p.fantasy_role] ? ' · ' + PRO_ROLES[p.fantasy_role] : ''}${p.country_code ? ' · ' + esc(p.country_code.toUpperCase()) : ''}</div>
          ${p.last_match_time ? `<div class="muted" style="font-size:11px">играл ${ago(lm(p))}</div>` : ''}</div></a>
        ${me && me !== p.account_id ? `<a class="btn sm" href="#/cmp/${me}/${p.account_id}">vs я</a>` : ''}
      </div>`).join('') || '<div class="empty-state">Никого не нашёл</div>'}</div>
    ${pages > 1 ? `<div class="pager">${o.page > 0 ? '<button class="btn sm" data-pp="-1">‹ назад</button>' : ''}<span class="muted">стр. ${o.page + 1} из ${pages}</span>${o.page < pages - 1 ? '<button class="btn sm" data-pp="1">дальше ›</button>' : ''}</div>` : ''}`;
  const pq = $('#pq');
  pq.oninput = () => { o.q = pq.value; o.page = 0; const pos = pq.selectionStart; renderPros(); const n = $('#pq'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#prole').onclick = e => { const b = e.target.closest('button'); if (b) { o.role = b.dataset.v; o.page = 0; renderPros(); } };
  $$('[data-pp]').forEach(b => b.onclick = () => { o.page += +b.dataset.pp; renderPros(); scrollTo(0, 0); });
}
