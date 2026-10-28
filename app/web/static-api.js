'use strict';
/* Браузерная замена app/server.py для статического хостинга (GitHub Pages).
   Те же ручки /api/*, только запросы в OpenDota идут прямо из браузера.
   Включается сама, если страница открыта не с локального сервера. */
(() => {
  const host = location.hostname;
  if (host === '127.0.0.1' || host === 'localhost') return; // локально рулит server.py

  const API = 'https://api.opendota.com/api';
  const STEAM64_BASE = 76561197960265728n;
  const WEEK = 7 * 24 * 3600 * 1000;
  const MIN30 = 30 * 60 * 1000;

  const MATCH_FIELDS = ['match_id', 'player_slot', 'radiant_win', 'duration', 'game_mode', 'lobby_type',
    'hero_id', 'kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min',
    'last_hits', 'denies', 'start_time', 'lane_role', 'party_size', 'average_rank',
    'hero_damage', 'tower_damage', 'hero_healing', 'leaver_status', 'level'];
  const MATCH_KEEP = ['match_id', 'start_time', 'duration', 'radiant_win', 'radiant_score', 'dire_score',
    'game_mode', 'lobby_type', 'region', 'patch', 'first_blood_time', 'version',
    'radiant_gold_adv', 'radiant_xp_adv', 'replay_url', 'leagueid', 'league'];
  const PLAYER_KEEP = ['account_id', 'personaname', 'name', 'hero_id', 'player_slot', 'isRadiant',
    'kills', 'deaths', 'assists', 'last_hits', 'denies', 'gold_per_min', 'xp_per_min',
    'level', 'net_worth', 'hero_damage', 'tower_damage', 'hero_healing', 'rank_tier',
    'item_0', 'item_1', 'item_2', 'item_3', 'item_4', 'item_5',
    'backpack_0', 'backpack_1', 'backpack_2', 'item_neutral',
    'aghanims_scepter', 'aghanims_shard', 'moonshard',
    'obs_placed', 'sen_placed', 'stuns', 'teamfight_participation', 'camps_stacked',
    'lane_role', 'lane', 'is_roaming', 'party_id', 'party_size', 'leaver_status',
    'benchmarks', 'gold_t', 'lh_t', 'purchase_log', 'kills_log', 'buyback_count',
    'actions_per_min', 'rune_pickups', 'roshan_kills', 'tower_kills', 'randomed'];

  const pick = (o, keys) => { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; };

  // Кэш: в памяти на сессию + localStorage для мелочи (константы). Хранилище может не работать — похуй.
  const mem = new Map();
  function lsGet(k) { try { return JSON.parse(localStorage.getItem('dsc:' + k)); } catch { return null; } }
  function lsSet(k, v) { try { localStorage.setItem('dsc:' + k, JSON.stringify(v)); } catch { /* забито или запрещено */ } }

  async function od(path, ttl = MIN30, persist = false) {
    const now = Date.now();
    const hit = mem.get(path) || (persist ? lsGet(path) : null);
    if (ttl && hit && now - hit.t < ttl) return hit.v;
    let r;
    try { r = await fetch(API + path); } catch { throw new Error('OpenDota не отвечает, проверь интернет'); }
    if (r.status === 429) throw new Error('OpenDota упёрлась в лимит запросов, подожди минуту');
    if (!r.ok) throw new Error('OpenDota ответила ' + r.status);
    const v = await r.json();
    mem.set(path, { t: now, v });
    if (persist) lsSet(path, { t: now, v });
    return v;
  }

  function parseAccountId(raw) {
    const nums = String(raw || '').match(/\d+/g);
    if (!nums) return null;
    const cand = nums.reduce((a, b) => (b.length > a.length ? b : a));
    const n = BigInt(cand);
    return Number(n > STEAM64_BASE ? n - STEAM64_BASE : n);
  }

  let constantsP = null;
  function constants() {
    return constantsP ||= (async () => {
      const [heroes, items, modes, lobbies, regions] = await Promise.all(
        ['heroes', 'items', 'game_mode', 'lobby_type', 'region'].map(c => od('/constants/' + c, WEEK, true)));
      const h = {};
      for (const [k, v] of Object.entries(heroes)) {
        h[k] = { name: v.localized_name, key: (v.name || '').replace('npc_dota_hero_', ''),
          img: (v.img || '').split('?')[0], icon: (v.icon || '').split('?')[0],
          attr: v.primary_attr, roles: v.roles || [], attack: v.attack_type };
      }
      const it = {};
      for (const [key, v] of Object.entries(items)) {
        if (!('id' in v)) continue;
        it[v.id] = { key, name: v.dname || key, img: (v.img || '').split('?')[0], cost: v.cost || 0 };
      }
      const names = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.name || '']));
      return { heroes: h, items: it, modes: names(modes), lobbies: names(lobbies), regions };
    })().catch(e => { constantsP = null; throw e; });
  }

  async function playerBundle(aid, fresh) {
    const ttl = fresh ? 0 : MIN30;
    const player = await od(`/players/${aid}`, ttl);
    if (!player.profile) {
      return { error: 'private', message: 'Профиль закрыт или пуст. В доте включи: Настройки → Опции → ' +
        'Расширенные → «Открыть доступ к истории матчей».' };
    }
    const q = MATCH_FIELDS.filter(f => f !== 'match_id').map(f => 'project=' + f).join('&');
    const matches = await od(`/players/${aid}/matches?${q}`, ttl);
    const p = player.profile;
    return {
      account_id: aid, name: p.personaname || `Player ${aid}`, avatar: p.avatarfull || '',
      profileurl: p.profileurl || '', country: p.loccountrycode || '', plus: !!p.plus,
      rank_tier: player.rank_tier, leaderboard_rank: player.leaderboard_rank,
      computed_mmr: player.computed_mmr, fields: MATCH_FIELDS,
      matches: matches.map(m => MATCH_FIELDS.map(f => m[f] ?? null)),
    };
  }

  async function matchBundle(mid) {
    const m = await od(`/matches/${mid}`, WEEK);
    const out = pick(m, MATCH_KEEP);
    out.players = (m.players || []).map(p => pick(p, PLAYER_KEEP));
    out.parsed = !!m.version;
    return out;
  }

  async function peers(aid) {
    const keep = ['account_id', 'personaname', 'avatarfull', 'last_played', 'with_games', 'with_win',
      'against_games', 'against_win', 'with_gpm_sum', 'with_xpm_sum'];
    return (await od(`/players/${aid}/peers`)).map(p => pick(p, keep));
  }

  async function search(q) {
    q = q.trim();
    if (!q) return [];
    if (/^[\d\s]+$|opendota|dotabuff|steamcommunity|stratz/.test(q)) {
      const aid = parseAccountId(q);
      return aid ? [{ account_id: aid, personaname: `ID ${aid}` }] : [];
    }
    const rows = await od('/search?q=' + encodeURIComponent(q), 600 * 1000);
    return rows.slice(0, 20).map(r => ({ account_id: r.account_id, personaname: r.personaname,
      avatarfull: r.avatarfull, last_match_time: r.last_match_time }));
  }

  // ── Мета ──
  const H6 = 6 * 3600 * 1000;
  const META_FIELDS = ['pro_pick', 'pro_win', 'pro_ban', 'turbo_picks', 'turbo_wins', 'pub_pick', 'pub_win'];
  for (let b = 1; b <= 8; b++) META_FIELDS.push(b + '_pick', b + '_win');

  async function meta() {
    const rows = await od('/heroStats', H6);
    return { heroes: rows.map(r => { const h = { id: r.id }; for (const f of META_FIELDS) h[f] = r[f] || 0; return h; }) };
  }

  async function metaHero(hid) {
    const safe = (path, def) => od(path, H6).catch(() => def); // одна ручка легла — остальное покажем
    const [matchups, items, durations] = await Promise.all([
      safe(`/heroes/${hid}/matchups`, []), safe(`/heroes/${hid}/itemPopularity`, {}), safe(`/heroes/${hid}/durations`, [])]);
    return { id: hid, matchups, items, durations };
  }

  async function proMatches() {
    const keep = ['match_id', 'start_time', 'duration', 'radiant_name', 'dire_name', 'league_name',
      'radiant_score', 'dire_score', 'radiant_win'];
    return (await od('/proMatches', 600 * 1000)).slice(0, 40).map(m => pick(m, keep));
  }

  async function playerHeroes(aid, qs) {
    const q = ['date', 'lobby_type', 'game_mode', 'hero_id', 'lane_role']
      .filter(k => /^\d+$/.test(qs.get(k) || '')).map(k => `${k}=${qs.get(k)}`).join('&');
    const keep = ['hero_id', 'games', 'win', 'with_games', 'with_win', 'against_games', 'against_win'];
    return (await od(`/players/${aid}/heroes${q ? '?' + q : ''}`)).map(r => pick(r, keep));
  }

  async function benchmarks(hid) {
    const r = await od(`/benchmarks?hero_id=${hid}`, WEEK, true);
    return { hero_id: hid, result: r.result || {} };
  }

  async function poke(path) {
    try { const r = await fetch(API + path, { method: 'POST' }); return { ok: r.ok }; }
    catch (e) { return { ok: false, message: e.message }; }
  }

  // Конфиг (свой ID, избранное) — у каждого посетителя в его браузере.
  const loadCfg = () => lsGet('config') || {};

  window.STATIC_API = async (path, opts = {}) => {
    const u = new URL(path, 'http://x');
    const p = u.pathname, qs = u.searchParams;
    const body = opts.body ? JSON.parse(opts.body) : {};
    let m;
    if ((opts.method || 'GET') === 'POST') {
      if (p === '/config') {
        const cfg = loadCfg();
        if ('account_id' in body) cfg.account_id = body.account_id ? parseAccountId(String(body.account_id)) : null;
        if (Array.isArray(body.favorites)) cfg.favorites = body.favorites.map(Number).filter(Number.isInteger).slice(0, 50);
        lsSet('config', cfg);
        return cfg;
      }
      if ((m = p.match(/^\/refresh\/(\d+)$/))) { mem.clear(); return poke(`/players/${m[1]}/refresh`); }
      if ((m = p.match(/^\/parse\/(\d+)$/))) { mem.delete(`/matches/${m[1]}`); return poke(`/request/${m[1]}`); }
    } else {
      if (p === '/config') return loadCfg();
      if (p === '/constants') return constants();
      if (p === '/search') return search(qs.get('q') || '');
      if (p === '/resolve') return { account_id: parseAccountId(qs.get('q') || '') };
      if ((m = p.match(/^\/player\/(\d+)$/))) return playerBundle(+m[1], qs.get('fresh') === '1');
      if ((m = p.match(/^\/player\/(\d+)\/peers$/))) return peers(+m[1]);
      if ((m = p.match(/^\/player\/(\d+)\/heroes$/))) return playerHeroes(+m[1], qs);
      if ((m = p.match(/^\/benchmarks\/(\d+)$/))) return benchmarks(+m[1]);
      if (p === '/meta') return meta();
      if (p === '/promatches') return proMatches();
      if ((m = p.match(/^\/meta\/hero\/(\d+)$/))) return metaHero(+m[1]);
      if ((m = p.match(/^\/match\/(\d+)$/))) return matchBundle(+m[1]);
    }
    throw new Error('нет такой ручки');
  };
})();
