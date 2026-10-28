'use strict';
/* Вкладка «Итоги» — Dota Wrapped. Год (или всё время) одной лентой карточек
   + картинка для шеринга, нарисованная на canvas (без внешних картинок, чтоб не было CORS). */

S.wrapYear = null;

function wrapStats(list, year) {
  const ms = year === 'all' ? list : list.filter(m => new Date(m.start_time * 1000).getFullYear() === +year);
  if (!ms.length) return null;
  const a = agg(ms);
  const secs = ms.reduce((s, m) => s + (m.duration || 0), 0);
  const days = new Set(ms.map(m => new Date(m.start_time * 1000).toDateString()));
  const hs = heroStats(ms).sort((x, y) => y.n - x.n);
  const main = hs[0];
  const best = hs.filter(h => h.n >= 10).sort((x, y) => y.score - x.score)[0];
  const worst = hs.filter(h => h.n >= 10).sort((x, y) => x.score - y.score).find(h => h.wr < 0.5);
  const kills = ms.reduce((s, m) => s + (m.kills || 0), 0);
  const deaths = ms.reduce((s, m) => s + (m.deaths || 0), 0);
  const assists = ms.reduce((s, m) => s + (m.assists || 0), 0);
  // время в таверне: респавн в доте ~ от 5 до 100 сек, грубо считаем по 35 сек на смерть
  const deadSecs = deaths * 35;

  // по дням: самый задротский день
  const byDay = groupBy(ms, m => new Date(m.start_time * 1000).toDateString());
  const topDay = [...byDay].sort((x, y) => y[1].length - x[1].length)[0];
  // самая поздняя игра: ночь считаем как 0–6, и берём самое позднее время начала
  const night = ms.map(m => ({ m, h: new Date(m.start_time * 1000) })).map(x => ({ ...x, t: (x.h.getHours() + 18) % 24 * 60 + x.h.getMinutes() }))
    .sort((x, y) => y.t - x.t)[0];
  // любимый час
  const hours = groupBy(ms, m => new Date(m.start_time * 1000).getHours());
  const favHour = [...hours].sort((x, y) => y[1].length - x[1].length)[0];
  // стрики
  let bw = 0, bl = 0, cw = 0, cl = 0;
  for (const m of [...ms].sort((x, y) => x.start_time - y.start_time)) {
    if (m.win) { cw++; cl = 0; } else { cl++; cw = 0; }
    bw = Math.max(bw, cw); bl = Math.max(bl, cl);
  }
  const sessions = splitSessions(ms);
  const longest = [...sessions].sort((x, y) => (y.end - y.start) - (x.end - x.start))[0];
  const real = ms.filter(m => m.duration > 600 && m.lobby_type !== 1 && m.lobby_type !== 4);
  const topKills = real.reduce((b, m) => (!b || m.kills > b.kills ? m : b), null);
  const topGpm = real.reduce((b, m) => (!b || m.gold_per_min > b.gold_per_min ? m : b), null);
  const ranked = ms.filter(m => m.lobby_type === 7);
  const rankedNet = ranked.filter(m => m.win).length * 2 - ranked.length;
  const lanes = [...groupBy(ms, m => m.lane_role || null)].sort((x, y) => y[1].length - x[1].length)[0];
  return { ms, a, secs, days: days.size, hs, main, best, worst, kills, deaths, assists, deadSecs, topDay, night, favHour,
    bw, bl, sessions, longest, topKills, topGpm, ranked: ranked.length, rankedNet, lanes, heroesCount: hs.length };
}

const hrs = s => Math.round(s / 3600);
const hhmm = d => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

async function tabWrapped(box, p, _list, id, seq) {
  const years = [...new Set(p.list.map(m => new Date(m.start_time * 1000).getFullYear()))].sort((a, b) => b - a);
  if (!years.length) { box.innerHTML = '<div class="empty-state">Нет матчей</div>'; return; }
  const year = S.wrapYear && (S.wrapYear === 'all' || years.includes(+S.wrapYear)) ? S.wrapYear : String(years[0]);
  const w = wrapStats(p.list, year);
  const label = year === 'all' ? 'за всё время' : `за ${year}`;

  // главный кент — из пиров (у OpenDota это за всё время)
  let friend = null;
  try {
    if (!S.peers.has(id)) S.peers.set(id, await api(`/player/${id}/peers`));
    if (seq !== routeSeq) return;
    const since = year === 'all' ? 0 : new Date(+year, 0, 1).getTime() / 1000;
    friend = S.peers.get(id).filter(x => x.with_games >= 5 && (x.last_played || 0) >= since).sort((x, y) => y.with_games - x.with_games)[0] || null;
  } catch { /* без кента */ }

  const card = (big, title, sub, cls = '', extra = '') => `<div class="wcard ${cls}"><div class="wt">${title}</div><div class="wb num">${big}</div>${sub ? `<div class="ws">${sub}</div>` : ''}${extra}</div>`;
  const heroBig = h => h ? `<img class="whero" src="${esc(heroImg(h.id))}" alt="">` : '';
  const workWeeks = w.secs / 3600 / 40;

  box.innerHTML = `
    <div class="wtop">
      <div class="seg" id="wyear">${[...years.map(String), 'all'].map(y => `<button data-v="${y}" class="${y === year ? 'on' : ''}">${y === 'all' ? 'Всё время' : y}</button>`).join('')}</div>
      <button class="btn primary" id="wdl">⤓ Скачать картинку</button>
    </div>
    <section class="whead"><div class="muted">Dota Wrapped</div><h1>${esc(p.name)} <span>${label}</span></h1></section>
    <div class="wgrid">
      ${card(fmt(hrs(w.secs)) + ' ч', 'Наиграно', `${fmt(w.a.n)} ${plural(w.a.n, 'игра', 'игры', 'игр')} за ${w.days} ${plural(w.days, 'день', 'дня', 'дней')} · это ${workWeeks >= 1 ? `${workWeeks.toFixed(1)} рабочих недель` : `${(w.secs / 3600 / 8).toFixed(1)} рабочих дней`}`, 'hot')}
      ${card(pct(w.a.wr), 'Винрейт', `${fmt(w.a.w)} побед, ${fmt(w.a.l)} сливов`, wrCls(w.a.wr))}
      ${w.main ? card(esc(w.main.name), 'Главный герой', `${w.main.n} ${plural(w.main.n, 'игра', 'игры', 'игр')} · ${pct(w.main.wr)} винрейт · ${pct(w.main.n / w.a.n, 0)} всех игр`, 'wh', heroBig(w.main)) : ''}
      ${w.best && w.best.id !== (w.main && w.main.id) ? card(esc(w.best.name), 'Самый надёжный', `${pct(w.best.wr)} на ${w.best.n} играх — вот на ком надо было сидеть`, 'wh win', heroBig(w.best)) : ''}
      ${w.worst ? card(esc(w.worst.name), 'Герой-проклятие', `${pct(w.worst.wr)} на ${w.worst.n} играх. Зачем?`, 'wh loss', heroBig(w.worst)) : ''}
      ${friend ? card(esc(friend.personaname || 'ID ' + friend.account_id), 'Главный кент', `${friend.with_games} игр вместе · ${pct(friend.with_win / friend.with_games)} винрейт в пати`, 'friend', friend.avatarfull ? `<img class="wava" src="${esc(friend.avatarfull)}" alt="">` : '') : ''}
      ${card(fmt(w.kills), 'Убийств', `${fmt(w.deaths)} смертей, ${fmt(w.assists)} ассистов`)}
      ${card('≈' + fmt(hrs(w.deadSecs)) + ' ч', 'Пролежал в таверне', `${fmt(w.deaths)} смертей × ~35 сек на респ`, 'loss')}
      ${w.longest ? card(dur(w.longest.end - w.longest.start), 'Самая длинная сессия', `${w.longest.games.length} игр подряд, ${dateTime(w.longest.start)} · ${w.longest.w}–${w.longest.l}`) : ''}
      ${w.topDay ? card(w.topDay[1].length + ' игр', 'Самый задротский день', `${date(w.topDay[1][0].start_time)} · ${w.topDay[1].filter(m => m.win).length}–${w.topDay[1].filter(m => !m.win).length}`) : ''}
      ${w.night ? card(hhmm(w.night.h), 'Самая поздняя катка', `${date(w.night.m.start_time)}, ${esc(hero(w.night.m.hero_id).name)} · ${w.night.m.win ? 'победа' : 'слив'}. Спать надо было`) : ''}
      ${w.favHour ? card(String(w.favHour[0]).padStart(2, '0') + ':00', 'Любимое время', `${w.favHour[1].length} игр начато в этот час`) : ''}
      ${card(w.bw, 'Лучший винстрик', `${plural(w.bw, 'победа', 'победы', 'побед')} подряд`, 'win')}
      ${card(w.bl, 'Худший лузстрик', `${plural(w.bl, 'слив', 'слива', 'сливов')} подряд`, 'loss')}
      ${w.topKills ? card(w.topKills.kills, 'Рекорд убийств', `${esc(hero(w.topKills.hero_id).name)}, ${date(w.topKills.start_time)}`, '', `<a class="wlink" href="#/m/${w.topKills.match_id}/${id}">матч →</a>`) : ''}
      ${w.topGpm ? card(w.topGpm.gold_per_min, 'Рекорд GPM', `${esc(hero(w.topGpm.hero_id).name)}, ${date(w.topGpm.start_time)}`, '', `<a class="wlink" href="#/m/${w.topGpm.match_id}/${id}">матч →</a>`) : ''}
      ${w.ranked ? card((w.rankedNet >= 0 ? '+' : '−') + fmt(Math.abs(w.rankedNet * MMR_PER_GAME)), 'ММР за период', `примерно: ${w.ranked} рейтинговых игр, ±${MMR_PER_GAME} за игру`, w.rankedNet >= 0 ? 'win' : 'loss') : ''}
      ${card(w.heroesCount, 'Разных героев', w.heroesCount > 60 ? 'Пул как у про. Или ты просто рандомишь' : w.heroesCount < 15 ? 'Узкий пул — спамер' : 'Нормальный пул')}
    </div>`;

  $('#wyear', box).onclick = e => { const b = e.target.closest('button'); if (b) { S.wrapYear = b.dataset.v; tabWrapped(box, p, _list, id, seq); } };
  $('#wdl', box).onclick = () => downloadWrap(p, w, label, friend);
}

// ── картинка 1080×1350 для сторис/чата ──
function downloadWrap(p, w, label, friend) {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const ACC = css('--accent') || '#d63a2f', WIN = css('--win') || '#4ac36a', LOSS = css('--loss') || '#e8493d', GOLD = css('--gold') || '#c8aa6e';
  const SANS = 'Inter, "Segoe UI", system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, monospace';
  const bg = g.createLinearGradient(0, 0, 1080, 1350);
  bg.addColorStop(0, '#24110f'); bg.addColorStop(0.55, '#121318'); bg.addColorStop(1, '#0b0c0f');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = ACC; g.fillRect(0, 0, 1080, 10);

  const fit = (txt, max, size, font, weight = 800) => {
    let s = size;
    do { g.font = `${weight} ${s}px ${font}`; s -= 2; } while (g.measureText(txt).width > max && s > 20);
  };
  g.fillStyle = '#7d7f89'; g.font = `600 30px ${SANS}`; g.fillText('DOTA WRAPPED · ' + label.toUpperCase(), 70, 100);
  g.fillStyle = '#ecebe6'; fit(p.name, 940, 84, SANS); g.fillText(p.name, 70, 190);

  const tiles = [
    [fmt(hrs(w.secs)) + ' ч', 'наиграно', GOLD],
    [pct(w.a.wr), 'винрейт', w.a.wr >= 0.5 ? WIN : LOSS],
    [fmt(w.a.n), plural(w.a.n, 'игра', 'игры', 'игр'), '#ecebe6'],
    [w.main ? w.main.name : '—', w.main ? `главный герой · ${w.main.n} игр` : 'главный герой', '#ecebe6'],
    [w.best ? w.best.name : '—', w.best ? `надёжный · ${pct(w.best.wr, 0)}` : 'надёжный', WIN],
    [w.bw + ' / ' + w.bl, 'лучший вин- / лузстрик', '#ecebe6'],
    [w.longest ? dur(w.longest.end - w.longest.start) : '—', 'самая длинная сессия', '#ecebe6'],
    ['≈' + fmt(hrs(w.deadSecs)) + ' ч', 'пролежал в таверне', LOSS],
    [w.ranked ? (w.rankedNet >= 0 ? '+' : '−') + fmt(Math.abs(w.rankedNet * MMR_PER_GAME)) : '—', 'ММР, примерно', w.rankedNet >= 0 ? WIN : LOSS],
    [friend ? (friend.personaname || 'ID ' + friend.account_id) : '—', friend ? `главный кент · ${friend.with_games} игр` : 'главный кент', GOLD],
  ];
  const x0 = 70, y0 = 260, cw = 455, ch = 170, gap = 30;
  tiles.forEach(([v, l, col], i) => {
    const x = x0 + (i % 2) * (cw + gap), y = y0 + Math.floor(i / 2) * (ch + 22);
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.strokeStyle = '#262a35'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(x, y, cw, ch, 18); g.fill(); g.stroke();
    g.fillStyle = col; fit(String(v), cw - 56, 60, /\d/.test(String(v)[0] || '') || /^[+−≈]/.test(String(v)) ? MONO : SANS);
    g.fillText(String(v), x + 28, y + 88);
    g.fillStyle = '#7d7f89'; g.font = `600 24px ${SANS}`; g.fillText(l, x + 28, y + 135);
  });
  g.fillStyle = '#7d7f89'; g.font = `500 24px ${SANS}`;
  g.fillText('Dota Stats by avekda · avekdadoto.github.io/dota-stats', 70, 1300);

  c.toBlob(b => {
    if (!b) { toast('Не смог нарисовать картинку'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `dota-wrapped-${label.replace(/\s+/g, '-')}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
