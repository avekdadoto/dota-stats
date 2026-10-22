#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dota.py — личный анализатор Dota 2.

Берёт публичную статистику игрока через открытое API OpenDota и говорит,
на ком ты реально выигрываешь, на ком сливаешь, и кого спамить чтобы апнуть ММР.

Легально: используются только публичные данные (OpenDota отдаёт их официально).
Никаких читов, никакого вмешательства в игру.

Запуск:
    python3 dota.py <твой_Dota_ID>

ID можно взять так: в доте профиль -> это "Friend ID" (число).
Или вставь ссылку на свой профиль opendota/dotabuff, скрипт сам вытащит ID.

Зависимостей нет — только стандартная библиотека Python 3.
"""

import sys
import re
import json
import time
import html
import math
import urllib.request
import urllib.error

API = "https://api.opendota.com/api"
TIMEOUT = 15
MIN_GAMES = 15   # минимум игр на герое, чтобы его винрейт считался надёжным

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


def fetch(path):
    """GET к OpenDota, возвращает разобранный JSON. Бросает понятную ошибку."""
    url = f"{API}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "dota-stats/1.0 (personal)"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RuntimeError("OpenDota просит сбавить темп (лимит запросов). Подожди минуту.")
        raise RuntimeError(f"Сервер вернул ошибку {e.code} на {path}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Нет связи с OpenDota: {e.reason}")
    except json.JSONDecodeError:
        raise RuntimeError(f"OpenDota прислал мусор вместо данных на {path}")


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
    }


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
            f"{f['streak']} {'побед' if f['streak_won'] else 'поражений'} подряд")
        print()
        print(C.bold("  Последние матчи (свежие слева):"))
        print(f"    {strip}   {wr_color(f['winrate'])}")
        print(f"    стрик: {streak_s}   ·   KDA {f['kda']:.2f}  "
              f"({f['avg_k']:.1f}/{f['avg_d']:.1f}/{f['avg_a']:.1f})")
        print(f"    GPM {f['gpm']:.0f}  ·  XPM {f['xpm']:.0f}  ·  крипов {f['lh']:.0f}/матч  "
              f"·  чаще играл: {f['role']}")

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
        streak_word = "побед" if f["streak_won"] else "поражений"
        form_html = f"""
      <section class="card form">
        <h2>Последняя форма <small>{f['n']} матчей</small></h2>
        <div class="squares">{squares}</div>
        <div class="formstats">
          <div><span class="big {streak_cls}">{f['streak']}</span><label>{streak_word} подряд</label></div>
          <div><span class="big">{f['winrate']:.0f}%</span><label>винрейт</label></div>
          <div><span class="big">{f['kda']:.2f}</span><label>KDA</label></div>
          <div><span class="big">{f['gpm']:.0f}</span><label>GPM</label></div>
          <div><span class="big">{f['xpm']:.0f}</span><label>XPM</label></div>
          <div><span class="big">{f['lh']:.0f}</span><label>крипов/матч</label></div>
        </div>
        <p class="role">Последнее время чаще всего: <b>{esc(f['role'])}</b></p>
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
# main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("Пример:  python3 dota.py 70388657")
        sys.exit(1)

    account_id = parse_account_id(sys.argv[1])
    if not account_id:
        print("Не понял ID. Дай Friend ID (число) или ссылку на профиль opendota/dotabuff.")
        sys.exit(1)

    try:
        data = analyse(account_id)
    except RuntimeError as e:
        print(f"[!] {e}")
        sys.exit(2)

    print_report(data)

    out = "report.html"
    with open(out, "w", encoding="utf-8") as fp:
        fp.write(build_html(data))
    import os
    print(f"\n[*] Красивый отчёт сохранён: {os.path.abspath(out)}")
    print("    Открой его в браузере:  xdg-open report.html")


if __name__ == "__main__":
    main()
