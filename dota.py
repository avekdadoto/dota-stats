#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dota.py — личный анализатор Dota 2.

Берёт публичную статистику игрока через открытое API OpenDota и говорит,
на ком ты реально выигрываешь, на ком сливаешь, и кого спамить чтобы апнуть ММР.

Легально: используются только публичные данные (OpenDota отдаёт их официально).
Никаких читов, никакого вмешательства в игру.

Запуск:
    python3 dota.py <твой_Dota_ID>                 # полный отчёт + report.html
    python3 dota.py <ID> --vs <ID_кента>           # сравнить двух игроков
    python3 dota.py --match <match_id> [--me <ID>] # разбор конкретного матча
    --no-cache  — не брать ответы из кэша, дёрнуть API заново

ID можно взять так: в доте профиль -> это "Friend ID" (число).
Или вставь ссылку на свой профиль opendota/dotabuff, скрипт сам вытащит ID.

Зависимостей нет — только стандартная библиотека Python 3.
"""

import os
import sys
import re
import hashlib
import threading
import argparse
import json
import time
import html
import math
import urllib.request
import urllib.error

API = "https://api.opendota.com/api"
TIMEOUT = 15
MIN_GAMES = 15   # минимум игр на герое, чтобы его винрейт считался надёжным

# Кэш ответов API: профиль меняется редко, а лимит у OpenDota 60 запросов в минуту.
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"),
                         "dota-stats")
CACHE_TTL = 30 * 60          # данные игрока — полчаса
MATCH_TTL = 7 * 24 * 3600    # сыгранный матч уже не поменяется (кроме парсинга) — неделя
USE_CACHE = True

# ─────────────────────────────────────────────────────────────────────────────
# Справочник героев вшит прямо сюда (id -> (имя, атрибут)), чтобы не делать
# лишний запрос и чтобы инструмент работал даже если этот эндпоинт недоступен.
# ─────────────────────────────────────────────────────────────────────────────
HEROES = {
    1: ("Anti-Mage", "agi"), 2: ("Axe", "str"), 3: ("Bane", "all"), 4: ("Bloodseeker", "agi"),
    5: ("Crystal Maiden", "int"), 6: ("Drow Ranger", "agi"), 7: ("Earthshaker", "str"),
    8: ("Juggernaut", "agi"), 9: ("Mirana", "agi"), 10: ("Morphling", "agi"),
    11: ("Shadow Fiend", "agi"), 12: ("Phantom Lancer", "agi"), 13: ("Puck", "int"),
    14: ("Pudge", "str"), 15: ("Razor", "agi"), 16: ("Sand King", "all"), 17: ("Storm Spirit", "int"),
    18: ("Sven", "str"), 19: ("Tiny", "str"), 20: ("Vengeful Spirit", "agi"), 21: ("Windranger", "all"),
    22: ("Zeus", "int"), 23: ("Kunkka", "str"), 25: ("Lina", "int"), 26: ("Lion", "int"),
    27: ("Shadow Shaman", "int"), 28: ("Slardar", "str"), 29: ("Tidehunter", "str"),
    30: ("Witch Doctor", "int"), 31: ("Lich", "int"), 32: ("Riki", "agi"), 33: ("Enigma", "all"),
    34: ("Tinker", "int"), 35: ("Sniper", "agi"), 36: ("Necrophos", "int"), 37: ("Warlock", "int"),
    38: ("Beastmaster", "all"), 39: ("Queen of Pain", "int"), 40: ("Venomancer", "all"),
    41: ("Faceless Void", "agi"), 42: ("Wraith King", "str"), 43: ("Death Prophet", "all"),
    44: ("Phantom Assassin", "agi"), 45: ("Pugna", "int"), 46: ("Templar Assassin", "agi"),
    47: ("Viper", "agi"), 48: ("Luna", "agi"), 49: ("Dragon Knight", "str"), 50: ("Dazzle", "all"),
    51: ("Clockwerk", "str"), 52: ("Leshrac", "int"), 53: ("Nature's Prophet", "all"),
    54: ("Lifestealer", "str"), 55: ("Dark Seer", "int"), 56: ("Clinkz", "agi"), 57: ("Omniknight", "str"),
    58: ("Enchantress", "int"), 59: ("Huskar", "str"), 60: ("Night Stalker", "str"),
    61: ("Broodmother", "agi"), 62: ("Bounty Hunter", "agi"), 63: ("Weaver", "agi"), 64: ("Jakiro", "int"),
    65: ("Batrider", "all"), 66: ("Chen", "int"), 67: ("Spectre", "agi"), 68: ("Ancient Apparition", "int"),
    69: ("Doom", "str"), 70: ("Ursa", "agi"), 71: ("Spirit Breaker", "str"), 72: ("Gyrocopter", "agi"),
    73: ("Alchemist", "str"), 74: ("Invoker", "int"), 75: ("Silencer", "int"),
    76: ("Outworld Destroyer", "int"), 77: ("Lycan", "str"), 78: ("Brewmaster", "all"),
    79: ("Shadow Demon", "int"), 80: ("Lone Druid", "agi"), 81: ("Chaos Knight", "str"),
    82: ("Meepo", "agi"), 83: ("Treant Protector", "str"), 84: ("Ogre Magi", "str"),
    85: ("Undying", "str"), 86: ("Rubick", "int"), 87: ("Disruptor", "int"), 88: ("Nyx Assassin", "all"),
    89: ("Naga Siren", "agi"), 90: ("Keeper of the Light", "int"), 91: ("Io", "all"),
    92: ("Visage", "all"), 93: ("Slark", "agi"), 94: ("Medusa", "agi"), 95: ("Troll Warlord", "agi"),
    96: ("Centaur Warrunner", "str"), 97: ("Magnus", "all"), 98: ("Timbersaw", "str"),
    99: ("Bristleback", "str"), 100: ("Tusk", "str"), 101: ("Skywrath Mage", "int"), 102: ("Abaddon", "all"),
    103: ("Elder Titan", "str"), 104: ("Legion Commander", "str"), 105: ("Techies", "all"),
    106: ("Ember Spirit", "agi"), 107: ("Earth Spirit", "str"), 108: ("Underlord", "str"),
    109: ("Terrorblade", "agi"), 110: ("Phoenix", "str"), 111: ("Oracle", "int"),
    112: ("Winter Wyvern", "int"), 113: ("Arc Warden", "all"), 114: ("Monkey King", "agi"),
    119: ("Dark Willow", "int"), 120: ("Pangolier", "all"), 121: ("Grimstroke", "int"),
    123: ("Hoodwink", "agi"), 126: ("Void Spirit", "all"), 128: ("Snapfire", "all"), 129: ("Mars", "str"),
    131: ("Ringmaster", "int"), 135: ("Dawnbreaker", "str"), 136: ("Marci", "all"),
    137: ("Primal Beast", "str"), 138: ("Muerta", "int"), 145: ("Kez", "agi"), 155: ("Largo", "str"),
}

MEDALS = {1: "Herald", 2: "Guardian", 3: "Crusader", 4: "Archon",
          5: "Legend", 6: "Ancient", 7: "Divine", 8: "Immortal"}
LANE_ROLE = {1: "Керри / Safe", 2: "Мид", 3: "Оффлейн", 4: "Лес / Саппорт"}
STEAM64_BASE = 76561197960265728  # для перевода steamID64 -> account_id


# ─────────────────────────────────────────────────────────────────────────────
# Утилиты
# ─────────────────────────────────────────────────────────────────────────────
def plural(n, one, few, many):
    """1 победа, 2 победы, 5 побед."""
    n = abs(n) % 100
    if 11 <= n <= 19:
        return many
    n %= 10
    return one if n == 1 else (few if 2 <= n <= 4 else many)


def streak_word(n, won):
    return plural(n, "победа", "победы", "побед") if won else \
        plural(n, "поражение", "поражения", "поражений")


def hero_name(hid):
    return HEROES.get(hid, (f"Hero #{hid}", "all"))[0]


def hero_attr(hid):
    return HEROES.get(hid, ("", "all"))[1]


def parse_account_id(raw):
    """Принимает Friend ID, steamID64 или ссылку на профиль и возвращает account_id."""
    raw = raw.strip()
    # вытащить все цифры-кусочки из возможной ссылки
    nums = re.findall(r"\d+", raw)
    if not nums:
        return None
    # берём самое длинное число (в ссылках id обычно самый длинный кусок)
    cand = max(nums, key=len)
    n = int(cand)
    if n > STEAM64_BASE:          # это steamID64 -> переводим
        return n - STEAM64_BASE
    return n


def _cache_file(path):
    return os.path.join(CACHE_DIR, hashlib.sha1(path.encode()).hexdigest() + ".json")


def fetch(path, ttl=CACHE_TTL):
    """GET к OpenDota с кэшем на диске, возвращает разобранный JSON."""
    cf = _cache_file(path)
    if USE_CACHE:
        try:
            if time.time() - os.path.getmtime(cf) < ttl:
                with open(cf, encoding="utf-8") as fp:
                    return json.load(fp)
        except (OSError, json.JSONDecodeError):
            pass  # нет кэша или он битый — идём в сеть

    url = f"{API}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "dota-stats/1.0 (personal)"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RuntimeError("OpenDota просит сбавить темп (лимит запросов). Подожди минуту.")
        if e.code == 404:
            raise RuntimeError(f"OpenDota не нашёл такого: {path}")
        raise RuntimeError(f"Сервер вернул ошибку {e.code} на {path}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Нет связи с OpenDota: {e.reason}")
    except json.JSONDecodeError:
        raise RuntimeError(f"OpenDota прислал мусор вместо данных на {path}")

    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = f"{cf}.{os.getpid()}.{threading.get_ident()}.tmp"  # уникально для потоков сервера
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(data, fp)
        os.replace(tmp, cf)
    except OSError:
        pass  # не смогли записать кэш — похуй, данные всё равно есть
    return data


def wilson_lower(wins, n, z=1.96):
    """Нижняя граница 95% доверительного интервала винрейта.

    Зачем: защищает от обмана маленькой выборки. 6/10 (60%) на самом деле
    "в среднем хуже", чем 110/200 (55%), потому что по 10 играм мы мало что знаем.
    Этим числом честно ранжируем, кого спамить.
    """
    if n == 0:
        return 0.0
    phat = wins / n
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)
    return (centre - margin) / denom


def medal_text(rank_tier, leaderboard_rank):
    if not rank_tier:
        return "Без медали / не откалиброван"
    medal = rank_tier // 10
    stars = rank_tier % 10
    name = MEDALS.get(medal, "?")
    if medal == 8:  # Immortal
        return f"Immortal" + (f" · #{leaderboard_rank}" if leaderboard_rank else "")
    return f"{name} {stars}★" if stars else name


# ─────────────────────────────────────────────────────────────────────────────
# Анализ
# ─────────────────────────────────────────────────────────────────────────────
def analyse(account_id):
    """Тянет все данные и собирает готовый к выводу словарь."""
    print(f"[*] Запрашиваю данные игрока {account_id} у OpenDota ...", file=sys.stderr)

    player = fetch(f"/players/{account_id}")
    if player.get("profile") is None:
        raise RuntimeError(
            "Профиль закрыт или пуст. В доте включи: Настройки -> Опции -> "
            "Расширенные -> «Открыть доступ к истории матчей». Через день появится статистика."
        )

    wl = fetch(f"/players/{account_id}/wl")
    heroes = fetch(f"/players/{account_id}/heroes")
    recent = fetch(f"/players/{account_id}/recentMatches")
    counts = fetch(f"/players/{account_id}/counts")

    prof = player["profile"]
    wins, losses = wl.get("win", 0), wl.get("lose", 0)
    total = wins + losses
    winrate = (wins / total * 100) if total else 0.0

    # ── герои: только те, на ком реально играл; винрейт + оценка Вилсона ──
    hero_rows = []
    for h in heroes:
        g = h.get("games", 0)
        if g <= 0:
            continue
        w = h.get("win", 0)
        hero_rows.append({
            "id": h["hero_id"],
            "name": hero_name(h["hero_id"]),
            "attr": hero_attr(h["hero_id"]),
            "games": g,
            "wins": w,
            "wr": w / g * 100,
            "score": wilson_lower(w, g),
            "last": h.get("last_played", 0),
        })

    most_played = sorted(hero_rows, key=lambda x: x["games"], reverse=True)[:8]

    reliable = [h for h in hero_rows if h["games"] >= MIN_GAMES]
    spam = sorted([h for h in reliable if h["wr"] >= 50],
                  key=lambda x: x["score"], reverse=True)[:5]
    avoid = sorted([h for h in reliable if h["wr"] < 48],
                   key=lambda x: x["wr"])[:5]

    # ── недавняя форма ──
    form = analyse_recent(recent)
    positions = analyse_positions(counts)

    return {
        "account_id": account_id,
        "name": prof.get("personaname") or f"Player {account_id}",
        "avatar": prof.get("avatarfull", ""),
        "country": prof.get("loccountrycode", ""),
        "medal": medal_text(player.get("rank_tier"), player.get("leaderboard_rank")),
        "mmr": player.get("computed_mmr"),
        "wins": wins, "losses": losses, "total": total, "winrate": winrate,
        "unique_heroes": len(hero_rows),
        "most_played": most_played,
        "spam": spam,
        "avoid": avoid,
        "form": form,
        "positions": positions,
        "hero_rows": hero_rows,
    }


def analyse_positions(counts):
    """Винрейт по линиям. OpenDota знает линию только у распарсенных матчей."""
    lanes = (counts or {}).get("lane_role", {})
    rows = []
    for key, v in lanes.items():
        lr = int(key)
        g, w = v.get("games", 0), v.get("win", 0)
        if lr not in LANE_ROLE or g <= 0:
            continue
        rows.append({"role": LANE_ROLE[lr], "games": g, "wins": w,
                     "wr": w / g * 100, "score": wilson_lower(w, g)})
    if not rows:
        return None
    rows.sort(key=lambda x: x["games"], reverse=True)
    known = sum(r["games"] for r in rows)
    unknown = lanes.get("0", {}).get("games", 0)
    solid = [r for r in rows if r["games"] >= max(MIN_GAMES, 50)]
    best = max(solid, key=lambda x: x["score"]) if solid else None
    worst = min(solid, key=lambda x: x["wr"]) if len(solid) > 1 else None
    return {"rows": rows, "known": known, "unknown": unknown,
            "best": best["role"] if best else None,
            "worst": worst["role"] if worst and worst is not best else None}


def analyse_recent(recent, limit=20):
    """Форма по последним матчам: W/L, стрик, средние показатели, частая позиция."""
    matches = recent[:limit]
    if not matches:
        return None

    results = []       # True=победа
    k = d = a = gpm = xpm = lh = 0
    role_count = {}
    for m in matches:
        is_radiant = m["player_slot"] < 128
        won = (is_radiant and m["radiant_win"]) or (not is_radiant and not m["radiant_win"])
        results.append(won)
        k += m.get("kills", 0); d += m.get("deaths", 0); a += m.get("assists", 0)
        gpm += m.get("gold_per_min", 0); xpm += m.get("xp_per_min", 0); lh += m.get("last_hits", 0)
        lr = m.get("lane_role")
        if lr:
            role_count[lr] = role_count.get(lr, 0) + 1

    n = len(matches)
    w = sum(results)
    # текущий стрик (сколько подряд с последнего матча одинаковый исход)
    streak = 1
    for i in range(1, n):
        if results[i] == results[0]:
            streak += 1
        else:
            break
    fav_role = max(role_count, key=role_count.get) if role_count else None

    return {
        "n": n, "wins": w, "losses": n - w,
        "winrate": w / n * 100,
        "streak": streak, "streak_won": results[0],
        "results": results,  # свежие первыми
        "kda": (k + a) / max(1, d),
        "avg_k": k / n, "avg_d": d / n, "avg_a": a / n,
        "gpm": gpm / n, "xpm": xpm / n, "lh": lh / n,
        "role": LANE_ROLE.get(fav_role, "разные") if fav_role else "разные",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Вывод в терминал
# ─────────────────────────────────────────────────────────────────────────────
class C:
    use = sys.stdout.isatty()
    @staticmethod
    def _w(code, s):
        return f"\033[{code}m{s}\033[0m" if C.use else s
    @classmethod
    def red(cls, s):    return cls._w("31", s)
    @classmethod
    def grn(cls, s):    return cls._w("32", s)
    @classmethod
    def yel(cls, s):    return cls._w("33", s)
    @classmethod
    def cyn(cls, s):    return cls._w("36", s)
    @classmethod
    def bold(cls, s):   return cls._w("1", s)
    @classmethod
    def dim(cls, s):    return cls._w("2", s)


def wr_color(wr):
    if wr >= 53: return C.grn(f"{wr:5.1f}%")
    if wr < 47:  return C.red(f"{wr:5.1f}%")
    return C.yel(f"{wr:5.1f}%")


def print_report(d):
    line = "─" * 60
    print()
    print(C.bold(C.cyn(f"  {d['name']}  ")) + C.dim(f"({d['account_id']})"))
    print(f"  {d['medal']}   ·   всего игр: {d['total']}   ·   уникальных героев: {d['unique_heroes']}")
    print(line)
    print(f"  Винрейт за всё время: {wr_color(d['winrate'])}  "
          f"({C.grn(str(d['wins']))}–{C.red(str(d['losses']))})")

    f = d["form"]
    if f:
        strip = "".join(C.grn("W") if r else C.red("L") for r in f["results"])
        streak_s = (C.grn if f["streak_won"] else C.red)(
            f"{f['streak']} {streak_word(f['streak'], f['streak_won'])} подряд")
        print()
        print(C.bold("  Последние матчи (свежие слева):"))
        print(f"    {strip}   {wr_color(f['winrate'])}")
        print(f"    стрик: {streak_s}   ·   KDA {f['kda']:.2f}  "
              f"({f['avg_k']:.1f}/{f['avg_d']:.1f}/{f['avg_a']:.1f})")
        print(f"    GPM {f['gpm']:.0f}  ·  XPM {f['xpm']:.0f}  ·  крипов {f['lh']:.0f}/матч  "
              f"·  чаще играл: {f['role']}")

    pos = d.get("positions")
    if pos:
        print()
        print(C.bold("  Винрейт по линиям:") + C.dim(f"  (известна линия у {pos['known']} матчей)"))
        for r in pos["rows"]:
            mark = ""
            if r["role"] == pos["best"]:
                mark = C.grn("  ← твоё")
            elif r["role"] == pos["worst"]:
                mark = C.red("  ← не твоё")
            print(f"    {r['role']:<20} {r['games']:>4} игр  {bar_str(r['wr'])} {wr_color(r['wr'])}{mark}")

    print()
    print(C.bold("  Самые заигранные герои:"))
    for h in d["most_played"]:
        bar = bar_str(h["wr"])
        print(f"    {h['name']:<20} {h['games']:>4} игр  {bar} {wr_color(h['wr'])}")

    if d["spam"]:
        print()
        print(C.bold(C.grn("  💪 СПАМЬ ЭТИХ — на них ты реально апаешь:")))
        for h in d["spam"]:
            print(f"    {h['name']:<20} {wr_color(h['wr'])}  "
                  + C.dim(f"({h['wins']}/{h['games']}, надёжность {h['score']*100:4.1f}%)"))

    if d["avoid"]:
        print()
        print(C.bold(C.red("  🚫 ЗАВЯЗЫВАЙ С ЭТИМИ — тут ты сливаешь:")))
        for h in d["avoid"]:
            print(f"    {h['name']:<20} {wr_color(h['wr'])}  "
                  + C.dim(f"({h['wins']}/{h['games']})"))

    print(line)


def bar_str(wr, width=14):
    if not C.use:
        filled = round(width * wr / 100)
        return "[" + "#" * filled + "-" * (width - filled) + "]"
    filled = round(width * wr / 100)
    col = C.grn if wr >= 53 else (C.red if wr < 47 else C.yel)
    return col("█" * filled) + C.dim("░" * (width - filled))


# ─────────────────────────────────────────────────────────────────────────────
# HTML-отчёт
# ─────────────────────────────────────────────────────────────────────────────
def esc(s):
    return html.escape(str(s))


def build_html(d):
    f = d["form"]
    gen = time.strftime("%Y-%m-%d %H:%M")

    def hero_bar(h, cls=""):
        wr = h["wr"]
        band = "good" if wr >= 53 else ("bad" if wr < 47 else "mid")
        return f"""
        <div class="hrow {cls}">
          <span class="hname" data-attr="{h['attr']}">{esc(h['name'])}</span>
          <span class="hgames">{h['games']} игр</span>
          <span class="hbar"><i class="{band}" style="width:{min(100,wr):.0f}%"></i></span>
          <span class="hwr {band}">{wr:.1f}%</span>
        </div>"""

    most = "".join(hero_bar(h) for h in d["most_played"])
    spam = "".join(f"""<li><b>{esc(h['name'])}</b><span class="good">{h['wr']:.1f}%</span>
                   <em>{h['wins']}/{h['games']} · надёжность {h['score']*100:.0f}%</em></li>"""
                   for h in d["spam"]) or "<li class='empty'>Мало данных — сыграй побольше ранкеда</li>"
    avoid = "".join(f"""<li><b>{esc(h['name'])}</b><span class="bad">{h['wr']:.1f}%</span>
                    <em>{h['wins']}/{h['games']}</em></li>"""
                    for h in d["avoid"]) or "<li class='empty'>Нечего избегать — красавчик</li>"

    form_html = ""
    if f:
        squares = "".join(f'<span class="sq {"w" if r else "l"}"></span>' for r in f["results"])
        streak_cls = "good" if f["streak_won"] else "bad"
        sw = streak_word(f["streak"], f["streak_won"])
        form_html = f"""
      <section class="card form">
        <h2>Последняя форма <small>{f['n']} матчей</small></h2>
        <div class="squares">{squares}</div>
        <div class="formstats">
          <div><span class="big {streak_cls}">{f['streak']}</span><label>{sw} подряд</label></div>
          <div><span class="big">{f['winrate']:.0f}%</span><label>винрейт</label></div>
          <div><span class="big">{f['kda']:.2f}</span><label>KDA</label></div>
          <div><span class="big">{f['gpm']:.0f}</span><label>GPM</label></div>
          <div><span class="big">{f['xpm']:.0f}</span><label>XPM</label></div>
          <div><span class="big">{f['lh']:.0f}</span><label>крипов/матч</label></div>
        </div>
        <p class="role">Последнее время чаще всего: <b>{esc(f['role'])}</b></p>
      </section>"""

    pos_html = ""
    pos = d.get("positions")
    if pos:
        prow = []
        for r in pos["rows"]:
            tag = ""
            if r["role"] == pos["best"]:
                tag = ' <em class="tag good">твоё</em>'
            elif r["role"] == pos["worst"]:
                tag = ' <em class="tag bad">не твоё</em>'
            band = "good" if r["wr"] >= 53 else ("bad" if r["wr"] < 47 else "mid")
            prow.append(f"""
        <div class="hrow">
          <span class="hname">{esc(r['role'])}{tag}</span>
          <span class="hgames">{r['games']} игр</span>
          <span class="hbar"><i class="{band}" style="width:{min(100, r['wr']):.0f}%"></i></span>
          <span class="hwr {band}">{r['wr']:.1f}%</span>
        </div>""")
        pos_html = f"""
      <section class="card">
        <h2>Винрейт по линиям <small>линия известна у {pos['known']} матчей</small></h2>
        {''.join(prow)}
      </section>"""

    wr = d["winrate"]
    wr_band = "good" if wr >= 53 else ("bad" if wr < 47 else "mid")
    avatar = f'<img src="{esc(d["avatar"])}" alt="" onerror="this.style.display=\'none\'">' if d["avatar"] else ""

    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(d['name'])} — Dota 2 Stats</title>
<style>
:root{{--bg:#0c0d11;--panel:#15171e;--edge:#262a36;--fg:#e7e3d8;--dim:#8a8f9e;
--good:#4ac36a;--mid:#d9a441;--bad:#d2493b;--crimson:#c23c2a;--gold:#c8aa6e;
--mono:ui-monospace,"Cascadia Code",Menlo,monospace;--sans:"Segoe UI",system-ui,sans-serif;}}
*{{box-sizing:border-box}}
body{{margin:0;background:
  radial-gradient(130% 80% at 50% -10%,#1a1410 0%,var(--bg) 55%);
  color:var(--fg);font-family:var(--sans);line-height:1.5;padding:26px 16px 50px}}
.wrap{{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:18px}}
.hero{{display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  border:1px solid var(--edge);border-radius:14px;padding:20px 22px;
  background:linear-gradient(120deg,#1b1512,var(--panel) 60%)}}
.hero img{{width:76px;height:76px;border-radius:12px;border:2px solid var(--gold)}}
.hero .who{{flex:1;min-width:0}}
.hero h1{{margin:0;font-size:26px;letter-spacing:.3px}}
.hero .medal{{color:var(--gold);font-weight:600;letter-spacing:.5px}}
.hero .sub{{color:var(--dim);font-size:13px;margin-top:2px}}
.hero .wrbox{{text-align:center}}
.hero .wrbox .n{{font-family:var(--mono);font-size:38px;font-weight:700;line-height:1}}
.hero .wrbox label{{display:block;color:var(--dim);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px}}
.good{{color:var(--good)}}.mid{{color:var(--mid)}}.bad{{color:var(--bad)}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
.card{{border:1px solid var(--edge);border-radius:14px;background:var(--panel);padding:18px 20px}}
.card h2{{margin:0 0 14px;font-size:15px;letter-spacing:.5px;text-transform:uppercase;color:var(--gold)}}
.card h2 small{{color:var(--dim);text-transform:none;letter-spacing:0;font-weight:400;margin-left:6px}}
.hrow{{display:grid;grid-template-columns:1fr auto 120px 52px;align-items:center;gap:10px;padding:5px 0;font-size:14px}}
.hname{{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.hname[data-attr=str]{{border-left:3px solid #e0544e;padding-left:7px}}
.hname[data-attr=agi]{{border-left:3px solid #4ac36a;padding-left:7px}}
.hname[data-attr=int]{{border-left:3px solid #4aa6d9;padding-left:7px}}
.hname[data-attr=all]{{border-left:3px solid var(--gold);padding-left:7px}}
.hgames{{color:var(--dim);font-size:12px;font-family:var(--mono);text-align:right}}
.hbar{{height:8px;background:#0c0e13;border-radius:5px;overflow:hidden}}
.hbar i{{display:block;height:100%;border-radius:5px}}
.hbar i.good{{background:var(--good)}}.hbar i.mid{{background:var(--mid)}}.hbar i.bad{{background:var(--bad)}}
.hwr{{font-family:var(--mono);font-size:13px;text-align:right;font-weight:600}}
.form .squares{{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px}}
.sq{{width:20px;height:20px;border-radius:4px}}
.sq.w{{background:var(--good)}}.sq.l{{background:var(--bad);opacity:.85}}
.formstats{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 8px}}
.formstats .big{{font-family:var(--mono);font-size:24px;font-weight:700;display:block}}
.formstats label{{color:var(--dim);font-size:11px;letter-spacing:.5px}}
.form .role{{margin:14px 0 0;color:var(--dim);font-size:13px}}
.advice ul{{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}}
.advice li{{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:4px 10px;
  padding:9px 12px;background:#0f1117;border-radius:9px}}
.advice li b{{font-size:14px}}
.advice li span{{font-family:var(--mono);font-weight:700}}
.advice li em{{grid-column:1/-1;color:var(--dim);font-size:11px;font-style:normal}}
.advice li.empty{{color:var(--dim);display:block;font-size:13px}}
.advice .lead{{font-size:13px;color:var(--dim);margin:0 0 12px}}
.tag{{font-style:normal;font-size:11px;margin-left:6px;padding:1px 6px;border-radius:5px;background:#0f1117}}
.foot{{color:var(--dim);font-size:12px;text-align:center;line-height:1.7}}
.foot b{{color:var(--gold)}}
@media(max-width:720px){{.grid{{grid-template-columns:1fr}}
  .hrow{{grid-template-columns:1fr auto 70px 48px}}
  .formstats{{grid-template-columns:repeat(2,1fr)}}}}
</style></head><body>
<div class="wrap">
  <header class="hero">
    {avatar}
    <div class="who">
      <h1>{esc(d['name'])}</h1>
      <div class="medal">{esc(d['medal'])}</div>
      <div class="sub">ID {d['account_id']} · {d['total']} игр всего · {d['unique_heroes']} героев сыграно{(' · ~'+str(int(d['mmr']))+' MMR') if d['mmr'] else ''}</div>
    </div>
    <div class="wrbox">
      <div class="n {wr_band}">{wr:.1f}%</div>
      <label>винрейт · {d['wins']}–{d['losses']}</label>
    </div>
  </header>

  {form_html}

  {pos_html}

  <section class="card">
    <h2>Самые заигранные герои</h2>
    {most}
  </section>

  <div class="grid">
    <section class="card advice">
      <h2 class="good">💪 Спамь этих</h2>
      <p class="lead">Высокий винрейт, подтверждённый числом игр — бери в ранкеде, чтоб апать.</p>
      <ul>{spam}</ul>
    </section>
    <section class="card advice">
      <h2 class="bad">🚫 Завязывай с этими</h2>
      <p class="lead">Тут ты стабильно сливаешь. Либо тренируй отдельно, либо не бери в ранге.</p>
      <ul>{avoid}</ul>
    </section>
  </div>

  <p class="foot">
    Данные: <b>OpenDota</b> (публичное API) · отчёт собран {gen}<br>
    Винрейт для советов оценён по нижней границе Вилсона, чтобы маленькая выборка не врала.<br>
    Всё легально: только публичная статистика, никакого вмешательства в игру.
  </p>
</div>
</body></html>"""


# ─────────────────────────────────────────────────────────────────────────────
# Разбор конкретного матча
# ─────────────────────────────────────────────────────────────────────────────
def fmt_dur(sec):
    return f"{sec // 60}:{sec % 60:02d}"


def fmt_k(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def impact(p):
    """Грубая оценка вклада игрока, чтобы назвать MVP команды. Не истина, а прикидка."""
    return (p.get("kills", 0) * 2 + p.get("assists", 0) - p.get("deaths", 0) * 1.5
            + (p.get("hero_damage") or 0) / 2000 + (p.get("tower_damage") or 0) / 1000
            + (p.get("hero_healing") or 0) / 2000 + (p.get("net_worth") or 0) / 4000)


def analyse_match(match_id, me=None):
    m = fetch(f"/matches/{match_id}", ttl=MATCH_TTL)
    players = m.get("players") or []
    if not players:
        raise RuntimeError("В матче нет игроков — OpenDota его ещё не обработал. Попробуй позже.")

    teams = {True: [], False: []}
    for p in players:
        teams[bool(p.get("isRadiant", p.get("player_slot", 0) < 128))].append(p)

    res = {
        "id": match_id,
        "radiant_win": m.get("radiant_win"),
        "duration": m.get("duration", 0),
        "score": (m.get("radiant_score", 0), m.get("dire_score", 0)),
        "start": m.get("start_time", 0),
        "parsed": bool(m.get("version")),
        "teams": teams,
        "mvp": {side: max(ps, key=impact) for side, ps in teams.items() if ps},
        "me": None,
    }

    if me:
        mine = next((p for p in players if p.get("account_id") == me), None)
        if mine:
            side = bool(mine.get("isRadiant", mine.get("player_slot", 0) < 128))
            team = teams[side]
            team_kills = sum(p.get("kills", 0) for p in team) or 1

            def place(key):
                order = sorted(team, key=lambda p: p.get(key) or 0, reverse=True)
                return order.index(mine) + 1

            def avg(key):
                others = [p.get(key) or 0 for p in team if p is not mine]
                return sum(others) / max(1, len(others))

            res["me"] = {
                "p": mine,
                "won": side == res["radiant_win"],
                "kp": (mine.get("kills", 0) + mine.get("assists", 0)) / team_kills * 100,
                "nw_place": place("net_worth"),
                "dmg_place": place("hero_damage"),
                "gpm_vs": (mine.get("gold_per_min") or 0) - avg("gold_per_min"),
                "deaths_vs": (mine.get("deaths") or 0) - avg("deaths"),
                "is_mvp": res["mvp"].get(side) is mine,
            }
        else:
            res["me_missing"] = me
    return res


def print_match(r):
    line = "─" * 78
    rw = r["radiant_win"]
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["start"])) if r["start"] else "?"
    print()
    print(C.bold(C.cyn(f"  Матч {r['id']}")) + C.dim(f"   {when}   длительность {fmt_dur(r['duration'])}"))
    winner = C.grn("Radiant") if rw else C.red("Dire")
    print(f"  Победили: {winner}   ·   счёт {r['score'][0]} : {r['score'][1]}"
          + ("" if r["parsed"] else C.dim("   (матч не распарсен — часть цифр может быть пустой)")))
    me_id = r["me"]["p"].get("account_id") if r["me"] else None

    for side in (True, False):
        team = r["teams"][side]
        if not team:
            continue
        won = side == rw
        title = ("Radiant" if side else "Dire") + ("  — ПОБЕДА" if won else "  — слив")
        print(line)
        print(C.bold((C.grn if won else C.red)(f"  {title}")))
        print(C.dim(f"    {'герой':<18} {'игрок':<14} {'K/D/A':>9} {'LH/DN':>8} "
                    f"{'GPM':>4} {'XPM':>4} {'NW':>6} {'урон':>6}"))
        mvp = r["mvp"].get(side)
        for p in sorted(team, key=lambda p: p.get("net_worth") or 0, reverse=True):
            name = (p.get("personaname") or "аноним")[:14]
            kda = f"{p.get('kills', 0)}/{p.get('deaths', 0)}/{p.get('assists', 0)}"
            row = (f"    {hero_name(p.get('hero_id')):<18} {name:<14} {kda:>9} "
                   f"{str(p.get('last_hits', 0)) + '/' + str(p.get('denies', 0)):>8} "
                   f"{p.get('gold_per_min', 0):>4} {p.get('xp_per_min', 0):>4} "
                   f"{fmt_k(p.get('net_worth') or 0):>6} {fmt_k(p.get('hero_damage') or 0):>6}")
            if p is mvp:
                row += C.yel("  ★MVP")
            if me_id and p.get("account_id") == me_id:
                row = C.bold(row) + C.cyn("  ← ты")
            print(row)
    print(line)

    me = r["me"]
    if me:
        p = me["p"]
        print(C.bold(f"  Разбор тебя ({hero_name(p.get('hero_id'))}):"))
        print(f"    исход: {C.grn('победа') if me['won'] else C.red('поражение')}"
              f"   ·   участие в убийствах: {me['kp']:.0f}%")
        print(f"    по нетворсу {me['nw_place']}-й в команде, по урону {me['dmg_place']}-й")
        gv, dv = me["gpm_vs"], me["deaths_vs"]
        print(f"    GPM {'+' if gv >= 0 else ''}{gv:.0f} к среднему по тиме   ·   "
              f"смертей {'+' if dv >= 0 else ''}{dv:.1f} к среднему")
        print("    вердикт: " + match_verdict(me))
    elif r.get("me_missing"):
        print(C.yel(f"  Игрока {r['me_missing']} в этом матче нет (или у него скрыт профиль)."))
    print()


def match_verdict(me):
    if me["is_mvp"]:
        return C.grn("ты тащил эту катку, MVP команды") if me["won"] else \
            C.yel("ты был лучшим в тиме, но остальные слили — не твоя вина")
    bad = []
    if me["deaths_vs"] >= 3:
        bad.append("слишком много помирал")
    if me["kp"] < 35:
        bad.append("мало участвовал в драках")
    if me["gpm_vs"] < -100 and me["nw_place"] >= 4:
        bad.append("плохо фармил")
    if not bad:
        return C.yel("норм отыграл, без косяков") if not me["won"] else C.grn("нормально, вывезли")
    return C.red(", ".join(bad))


# ─────────────────────────────────────────────────────────────────────────────
# Сравнение двух игроков
# ─────────────────────────────────────────────────────────────────────────────
def compare(id_a, id_b):
    a = analyse(id_a)
    b = analyse(id_b)
    peers = fetch(f"/players/{id_a}/peers")
    peer = next((p for p in peers if p.get("account_id") == id_b), None)

    ha = {h["id"]: h for h in a["hero_rows"]}
    hb = {h["id"]: h for h in b["hero_rows"]}
    common = [(ha[i], hb[i]) for i in ha.keys() & hb.keys()
              if ha[i]["games"] >= 5 and hb[i]["games"] >= 5]
    common.sort(key=lambda x: x[0]["games"] + x[1]["games"], reverse=True)
    return {"a": a, "b": b, "peer": peer, "common": common[:8]}


def print_compare(c):
    a, b = c["a"], c["b"]
    line = "─" * 64
    W = 20

    def row(label, va, vb, num_a=None, num_b=None, higher_better=True):
        sa, sb = str(va), str(vb)
        if num_a is not None and num_b is not None and num_a != num_b:
            a_wins = (num_a > num_b) == higher_better
            sa = C.grn(sa) if a_wins else sa
            sb = sb if a_wins else C.grn(sb)
        pad_a = W - len(str(va))
        print(f"  {label:<18} {sa}{' ' * max(1, pad_a)} {sb}")

    print()
    print(C.bold(f"  {'':<18} {a['name'][:W]:<{W}} {b['name'][:W]}"))
    print(line)
    row("медаль", a["medal"], b["medal"])
    row("игр всего", a["total"], b["total"], a["total"], b["total"])
    row("винрейт", f"{a['winrate']:.1f}%", f"{b['winrate']:.1f}%", a["winrate"], b["winrate"])
    row("героев сыграно", a["unique_heroes"], b["unique_heroes"])
    fa, fb = a["form"], b["form"]
    if fa and fb:
        row("форма (20 игр)", f"{fa['winrate']:.0f}%", f"{fb['winrate']:.0f}%", fa["winrate"], fb["winrate"])
        row("KDA", f"{fa['kda']:.2f}", f"{fb['kda']:.2f}", fa["kda"], fb["kda"])
        row("GPM", f"{fa['gpm']:.0f}", f"{fb['gpm']:.0f}", fa["gpm"], fb["gpm"])
        row("XPM", f"{fa['xpm']:.0f}", f"{fb['xpm']:.0f}", fa["xpm"], fb["xpm"])
        row("смертей/матч", f"{fa['avg_d']:.1f}", f"{fb['avg_d']:.1f}", fa["avg_d"], fb["avg_d"], False)
        row("частая роль", fa["role"], fb["role"])
    ta = a["most_played"][0]["name"] if a["most_played"] else "—"
    tb = b["most_played"][0]["name"] if b["most_played"] else "—"
    row("главный герой", ta, tb)
    sa = a["spam"][0]["name"] if a["spam"] else "—"
    sb = b["spam"][0]["name"] if b["spam"] else "—"
    row("лучший герой", sa, sb)

    print(line)
    p = c["peer"]
    if p and (p.get("with_games") or p.get("against_games")):
        wg, ww = p.get("with_games", 0), p.get("with_win", 0)
        ag, aw = p.get("against_games", 0), p.get("against_win", 0)
        if wg:
            print(f"  Вместе в одной тиме: {wg} игр, винрейт {wr_color(ww / wg * 100)}")
        if ag:
            print(f"  Друг против друга:   {ag} игр, {a['name'][:16]} выиграл {aw}, "
                  f"{b['name'][:16]} выиграл {ag - aw}")
    else:
        print(C.dim("  Вместе не играли (по крайней мере OpenDota такого не видел)."))

    if c["common"]:
        print()
        print(C.bold("  Общие герои — кто на них лучше:"))
        for x, y in c["common"]:
            better = a["name"] if x["wr"] > y["wr"] else b["name"]
            print(f"    {x['name']:<20} {wr_color(x['wr'])} ({x['games']:>4})   vs   "
                  f"{wr_color(y['wr'])} ({y['games']:>4})   " + C.dim(f"→ {better[:16]}"))
    print()


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    global USE_CACHE
    ap = argparse.ArgumentParser(
        description="Личный анализатор Dota 2 на публичном API OpenDota.",
        epilog="Примеры:  dota.py 70388657  |  dota.py 70388657 --vs 89625472  |  "
               "dota.py --match 9054542608 --me 70388657")
    ap.add_argument("player", nargs="?", help="Friend ID, steamID64 или ссылка на профиль")
    ap.add_argument("--vs", metavar="ID", help="сравнить с другим игроком")
    ap.add_argument("--match", metavar="MATCH_ID", help="разобрать конкретный матч")
    ap.add_argument("--me", metavar="ID", help="кто ты в этом матче (по умолчанию — player)")
    ap.add_argument("--no-cache", action="store_true", help="игнорировать кэш")
    ap.add_argument("--no-html", action="store_true", help="не сохранять report.html")
    args = ap.parse_args()
    USE_CACHE = not args.no_cache

    def pid(raw, what="ID"):
        v = parse_account_id(raw)
        if not v:
            print(f"Не понял {what}: {raw!r}. Дай Friend ID (число) или ссылку на профиль.")
            sys.exit(1)
        return v

    try:
        if args.match:
            mid = re.findall(r"\d+", args.match)
            if not mid:
                print(f"Не понял match_id: {args.match!r}")
                sys.exit(1)
            me_raw = args.me or args.player
            me = pid(me_raw) if me_raw else None
            mid = int(max(mid, key=len))
            print(f"[*] Тяну матч {mid} ...", file=sys.stderr)
            print_match(analyse_match(mid, me))
            return

        if not args.player:
            ap.print_help()
            sys.exit(1)
        account_id = pid(args.player)

        if args.vs:
            print_compare(compare(account_id, pid(args.vs, "второй ID")))
            return

        data = analyse(account_id)
    except RuntimeError as e:
        print(f"[!] {e}")
        sys.exit(2)

    print_report(data)
    if args.no_html:
        return
    out = "report.html"
    with open(out, "w", encoding="utf-8") as fp:
        fp.write(build_html(data))
    print(f"\n[*] Красивый отчёт сохранён: {os.path.abspath(out)}")
    print("    Открой его в браузере:  xdg-open report.html")


if __name__ == "__main__":
    main()
