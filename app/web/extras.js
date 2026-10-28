'use strict';
/* Мелкие, но полезные штуки: светлая тема, экспорт матчей в CSV,
   «Что пикнуть?» (рандом из сильных героев твоего ранга, на которых ты мало играл),
   недавно открытые профили в поиске. */

// ── тема ──
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === 'light' ? '#f4f3ef' : '#0b0c0f';
  const b = $('#themebtn');
  if (b) { b.title = t === 'light' ? 'Тёмная тема' : 'Светлая тема'; b.textContent = t === 'light' ? '☾' : '☀'; }
}
applyTheme(lsGet('theme') || 'dark'); // кнопка уже в DOM: скрипты в конце body
document.addEventListener('click', e => {
  if (!e.target.closest('#themebtn')) return;
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  lsSet('theme', t);
  applyTheme(t);
  drawCharts(); // графики берут цвета из CSS, перерисуем
});

// ── экспорт в CSV ──
function exportCsv(p) {
  const cols = [['match_id', 'match_id'], ['date', 'дата'], ['hero', 'герой'], ['result', 'результат'], ['ranked', 'рейтинг'], ['mode', 'режим'],
    ['duration_min', 'длительность_мин'], ['kills', 'K'], ['deaths', 'D'], ['assists', 'A'], ['kda', 'KDA'], ['gold_per_min', 'GPM'], ['xp_per_min', 'XPM'],
    ['last_hits', 'крипы'], ['denies', 'денаи'], ['hero_damage', 'урон_по_героям'], ['tower_damage', 'урон_по_строениям'], ['hero_healing', 'лечение'],
    ['lane', 'линия'], ['party_size', 'пати'], ['level', 'уровень']];
  const q = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(c => c[1]).join(',')];
  for (const m of p.list) {
    const row = { ...m, date: new Date(m.start_time * 1000).toISOString().slice(0, 16).replace('T', ' '), hero: hero(m.hero_id).name,
      result: m.win ? 'W' : 'L', ranked: m.lobby_type === 7 ? 1 : 0, mode: MODES[m.game_mode] || m.game_mode,
      duration_min: (m.duration / 60).toFixed(1), kda: m.kda.toFixed(2), lane: LANES[m.lane_role] || '' };
    lines.push(cols.map(c => q(row[c[0]])).join(','));
  }
  // BOM, чтоб Excel понял кириллицу
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dota-matches-${p.account_id}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Выгрузил ${fmt(p.list.length)} матчей`);
}

// ── «Что пикнуть?» ──
function pickForMe() {
  const mine = me();
  const br = mine ? myBracket(mine) : (S.metaOpt.src !== 'pro' && S.metaOpt.src !== 'turbo' ? S.metaOpt.src : 'all');
  const played = mine ? new Map(heroStats(mine.list).map(h => [h.id, h.n])) : new Map();
  const pool = metaRows(br).rows.filter(r => r.tier <= 1 && (played.get(r.id) || 0) < 5);
  const src = pool.length ? pool : metaRows(br).rows.filter(r => r.tier <= 1);
  if (!src.length) return;
  const r = src[Math.floor(Math.random() * src.length)];
  const h = hero(r.id);
  const n = played.get(r.id) || 0;
  const box = document.createElement('div');
  box.className = 'pickmodal';
  box.innerHTML = `<div class="pm-card" role="dialog" aria-label="Что пикнуть">
      <div class="muted">Пикни сегодня</div>
      <img src="${esc(heroImg(r.id))}" alt="">
      <h2>${esc(h.name)} ${tierBadge(r.tier)}</h2>
      <div class="muted">${esc((h.roles || []).slice(0, 3).map(x => ROLES_RU[x] || x).join(' · '))}</div>
      <p>Винрейт на ${esc(brName(br))}: <b class="${wrCls(r.wr)}">${pct(r.wr)}</b> · пикрейт ${pct(r.pr)}<br>
        ${mine ? (!n ? 'Ты на нём ни разу не играл — самое время.' : n < 5 ? `У тебя всего ${n} ${plural(n, 'игра', 'игры', 'игр')} на нём.` : `У тебя на нём уже ${n} ${plural(n, 'игра', 'игры', 'игр')} — новых имб для тебя не осталось, держи из знакомых.`) : ''}</p>
      <div class="pm-btns"><button class="btn" id="pmagain">🎲 Ещё</button><a class="btn primary" href="#/meta/${r.id}">Как на нём играть →</a></div>
    </div>`;
  const close = () => box.remove();
  box.onclick = e => { if (e.target === box || e.target.closest('a')) close(); };
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
  document.body.appendChild(box);
  $('#pmagain', box).onclick = () => { close(); pickForMe(); };
}

// ── недавние профили ──
function rememberRecent(p) {
  const r = (lsGet('recent') || []).filter(x => x.id !== p.account_id);
  r.unshift({ id: p.account_id, name: p.name, avatar: p.avatar });
  lsSet('recent', r.slice(0, 8));
}
function showRecent(input, drop) {
  const r = lsGet('recent') || [];
  if (input.value.trim() || !r.length) return;
  drop.innerHTML = `<div class="empty" style="font-size:11px;text-transform:uppercase;letter-spacing:1px">Недавние</div>` +
    r.map(x => `<a href="#/p/${x.id}">${x.avatar ? `<img src="${esc(x.avatar)}" alt="">` : '<span style="width:28px;text-align:center">◉</span>'}<span>${esc(x.name)}<div class="muted" style="font-size:11px">ID ${x.id}</div></span></a>`).join('');
  drop.classList.add('open');
}
