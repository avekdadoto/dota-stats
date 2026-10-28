#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Бэкенд приложения Dota Stats — локальный сервер на 127.0.0.1.

Отдаёт статику из ./web и JSON-ручки /api/*, которые ходят в OpenDota через
кэш из dota.py. Наружу не торчит, только localhost.

    python3 server.py [--port 8777]
"""

import os
import re
import sys
import json
import argparse
import mimetypes
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import dota  # noqa: E402  — fetch с кэшем, parse_account_id

WEB = os.path.join(HERE, "web")
CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"),
                          "dota-stats")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
WEEK = 7 * 24 * 3600
META_TTL = 6 * 3600  # мета меняется медленно, раз в 6 часов хватит

# Какие поля матча из истории игрока нужны фронту. Порядок важен — фронт
# получает массив массивов и собирает объекты по этому списку (так в 2 раза меньше JSON).
MATCH_FIELDS = ["match_id", "player_slot", "radiant_win", "duration", "game_mode", "lobby_type",
                "hero_id", "kills", "deaths", "assists", "gold_per_min", "xp_per_min",
                "last_hits", "denies", "start_time", "lane_role", "party_size", "average_rank",
                "hero_damage", "tower_damage", "hero_healing", "leaver_status", "level"]

# Из полного матча оставляем только то, что реально рисуем.
MATCH_KEEP = ["match_id", "start_time", "duration", "radiant_win", "radiant_score", "dire_score",
              "game_mode", "lobby_type", "region", "patch", "first_blood_time", "version",
              "radiant_gold_adv", "radiant_xp_adv", "replay_url", "leagueid", "league"]
PLAYER_KEEP = ["account_id", "personaname", "name", "hero_id", "player_slot", "isRadiant",
               "kills", "deaths", "assists", "last_hits", "denies", "gold_per_min", "xp_per_min",
               "level", "net_worth", "hero_damage", "tower_damage", "hero_healing", "rank_tier",
               "item_0", "item_1", "item_2", "item_3", "item_4", "item_5",
               "backpack_0", "backpack_1", "backpack_2", "item_neutral",
               "aghanims_scepter", "aghanims_shard", "moonshard",
               "obs_placed", "sen_placed", "stuns", "teamfight_participation", "camps_stacked",
               "lane_role", "lane", "is_roaming", "party_id", "party_size", "leaver_status",
               "benchmarks", "gold_t", "lh_t", "purchase_log", "kills_log", "buyback_count",
               "actions_per_min", "rune_pickups", "roshan_kills", "tower_kills", "randomed"]


# ─────────────────────────────────────────────────────────────────────────────
# Конфиг (сохранённый ID)
# ─────────────────────────────────────────────────────────────────────────────
def load_config():
    try:
        with open(CONFIG, encoding="utf-8") as fp:
            return json.load(fp)
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp = CONFIG + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fp:
        json.dump(cfg, fp, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG)


# ─────────────────────────────────────────────────────────────────────────────
# Данные
# ─────────────────────────────────────────────────────────────────────────────
_constants = None


def constants():
    """Герои, предметы, режимы — один раз за запуск, в кэше неделя."""
    global _constants
    if _constants:
        return _constants
    heroes = dota.fetch("/constants/heroes", ttl=WEEK)
    items = dota.fetch("/constants/items", ttl=WEEK)
    modes = dota.fetch("/constants/game_mode", ttl=WEEK)
    lobbies = dota.fetch("/constants/lobby_type", ttl=WEEK)
    regions = dota.fetch("/constants/region", ttl=WEEK)

    h = {}
    for k, v in heroes.items():
        h[int(k)] = {"name": v.get("localized_name"), "key": v.get("name", "").replace("npc_dota_hero_", ""),
                     "img": (v.get("img") or "").split("?")[0], "icon": (v.get("icon") or "").split("?")[0],
                     "attr": v.get("primary_attr"), "roles": v.get("roles", []),
                     "attack": v.get("attack_type")}
    it = {}
    for key, v in items.items():
        if "id" not in v:
            continue
        it[v["id"]] = {"key": key, "name": v.get("dname") or key,
                       "img": (v.get("img") or "").split("?")[0], "cost": v.get("cost") or 0}
    _constants = {
        "heroes": h,
        "items": it,
        "modes": {int(k): v.get("name", "") for k, v in modes.items()},
        "lobbies": {int(k): v.get("name", "") for k, v in lobbies.items()},
        "regions": {int(k): v for k, v in regions.items()},
    }
    return _constants


def player_bundle(aid, fresh=False):
    """Всё по игроку одним ответом: профиль + вся история матчей в сжатом виде."""
    ttl = 0 if fresh else dota.CACHE_TTL
    player = dota.fetch(f"/players/{aid}", ttl=ttl)
    if not player.get("profile"):
        return {"error": "private",
                "message": "Профиль закрыт или пуст. В доте включи: Настройки → Опции → "
                           "Расширенные → «Открыть доступ к истории матчей»."}
    q = "&".join(f"project={f}" for f in MATCH_FIELDS if f != "match_id")
    matches = dota.fetch(f"/players/{aid}/matches?{q}", ttl=ttl)
    rows = [[m.get(f) for f in MATCH_FIELDS] for m in matches]
    prof = player["profile"]
    return {
        "account_id": aid,
        "name": prof.get("personaname") or f"Player {aid}",
        "avatar": prof.get("avatarfull") or "",
        "profileurl": prof.get("profileurl") or "",
        "country": prof.get("loccountrycode") or "",
        "plus": bool(prof.get("plus")),
        "rank_tier": player.get("rank_tier"),
        "leaderboard_rank": player.get("leaderboard_rank"),
        "computed_mmr": player.get("computed_mmr"),
        "fields": MATCH_FIELDS,
        "matches": rows,
    }


def match_bundle(mid):
    m = dota.fetch(f"/matches/{mid}", ttl=dota.MATCH_TTL)
    out = {k: m.get(k) for k in MATCH_KEEP if k in m}
    out["players"] = [{k: p.get(k) for k in PLAYER_KEEP if k in p} for p in m.get("players") or []]
    out["parsed"] = bool(m.get("version"))
    return out


def peers(aid):
    rows = dota.fetch(f"/players/{aid}/peers")
    keep = ["account_id", "personaname", "avatarfull", "last_played", "with_games", "with_win",
            "against_games", "against_win", "with_gpm_sum", "with_xpm_sum"]
    return [{k: p.get(k) for k in keep} for p in rows]


def search(q):
    q = q.strip()
    if not q:
        return []
    # ссылка/ID — сразу отдаём как есть, имя — идём в поиск OpenDota
    if re.fullmatch(r"[\d\s]+|.*(opendota|dotabuff|steamcommunity|stratz).*", q):
        aid = dota.parse_account_id(q)
        return [{"account_id": aid, "personaname": f"ID {aid}"}] if aid else []
    rows = dota.fetch(f"/search?q={quote(q)}", ttl=600)
    return [{"account_id": r.get("account_id"), "personaname": r.get("personaname"),
             "avatarfull": r.get("avatarfull"), "last_match_time": r.get("last_match_time")}
            for r in rows[:20]]


# ─────────────────────────────────────────────────────────────────────────────
# Мета: про-сцена + паблик по рангам (OpenDota /heroStats)
# ─────────────────────────────────────────────────────────────────────────────
META_FIELDS = ["pro_pick", "pro_win", "pro_ban", "turbo_picks", "turbo_wins", "pub_pick", "pub_win"] + \
    [f"{b}_{k}" for b in range(1, 9) for k in ("pick", "win")]


def meta():
    rows = dota.fetch("/heroStats", ttl=META_TTL)
    out = []
    for r in rows:
        h = {"id": r.get("id")}
        for f in META_FIELDS:
            h[f] = r.get(f) or 0
        out.append(h)
    return {"heroes": out}


def meta_hero(hid):
    def safe(path, default):
        try:
            return dota.fetch(path, ttl=META_TTL)
        except RuntimeError:
            return default  # одна ручка легла — остальное всё равно покажем
    return {
        "id": hid,
        "matchups": safe(f"/heroes/{hid}/matchups", []),
        "items": safe(f"/heroes/{hid}/itemPopularity", {}),
        "durations": safe(f"/heroes/{hid}/durations", []),
    }


def pro_matches():
    keep = ["match_id", "start_time", "duration", "radiant_name", "dire_name", "league_name",
            "radiant_score", "dire_score", "radiant_win"]
    return [{k: m.get(k) for k in keep} for m in dota.fetch("/proMatches", ttl=600)[:40]]


def benchmarks(hid):
    """Перцентили статы всех игроков на герое: GPM, XPM, крипы/мин и т.д."""
    r = dota.fetch(f"/benchmarks?hero_id={hid}", ttl=WEEK)
    return {"hero_id": hid, "result": r.get("result") or {}}


PH_PARAMS = ("date", "lobby_type", "game_mode", "hero_id", "lane_role")


def player_heroes(aid, qs):
    """С кем/против кого — /players/{id}/heroes, фильтры прокидываем как есть (только числа)."""
    q = "&".join(f"{k}={int(qs[k][0])}" for k in PH_PARAMS if qs.get(k) and qs[k][0].isdigit())
    rows = dota.fetch(f"/players/{aid}/heroes" + (f"?{q}" if q else ""))
    keep = ["hero_id", "games", "win", "with_games", "with_win", "against_games", "against_win"]
    return [{k: r.get(k) for k in keep} for r in rows]


def request_refresh(aid):
    """Просим OpenDota подтянуть свежие матчи игрока (POST /refresh)."""
    req = urllib.request.Request(f"{dota.API}/players/{aid}/refresh", data=b"", method="POST",
                                 headers={"User-Agent": "dota-stats/1.0 (personal)"})
    try:
        with urllib.request.urlopen(req, timeout=dota.TIMEOUT):
            return {"ok": True}
    except (urllib.error.URLError, OSError) as e:
        return {"ok": False, "message": str(e)}


def request_parse(mid):
    req = urllib.request.Request(f"{dota.API}/request/{mid}", data=b"", method="POST",
                                 headers={"User-Agent": "dota-stats/1.0 (personal)"})
    try:
        with urllib.request.urlopen(req, timeout=dota.TIMEOUT):
            # выкидываем кэш матча, чтоб после парсинга забрать свежий
            try:
                os.remove(dota._cache_file(f"/matches/{mid}"))
            except OSError:
                pass
            return {"ok": True}
    except (urllib.error.URLError, OSError) as e:
        return {"ok": False, "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# HTTP
# ─────────────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "DotaStats/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("DOTA_DEBUG"):
            super().log_message(fmt, *args)

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, {"error": "fail", "message": msg})

    def _host_ok(self):
        # защита от DNS-rebinding: пускаем только запросы на localhost
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def do_GET(self):
        if not self._host_ok():
            return self._err(403, "только localhost")
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)
        if path.startswith("/api/"):
            return self._api_get(path, qs)
        return self._static(path)

    def do_POST(self):
        if not self._host_ok():
            return self._err(403, "только localhost")
        u = urlparse(self.path)
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 65536)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            body = {}
        try:
            if u.path == "/api/config":
                cfg = load_config()
                if "account_id" in body:
                    aid = dota.parse_account_id(str(body["account_id"])) if body["account_id"] else None
                    cfg["account_id"] = aid
                if isinstance(body.get("favorites"), list):
                    cfg["favorites"] = [int(x) for x in body["favorites"] if str(x).isdigit()][:50]
                save_config(cfg)
                return self._send(200, cfg)
            m = re.fullmatch(r"/api/refresh/(\d+)", u.path)
            if m:
                return self._send(200, request_refresh(int(m.group(1))))
            m = re.fullmatch(r"/api/parse/(\d+)", u.path)
            if m:
                return self._send(200, request_parse(int(m.group(1))))
        except RuntimeError as e:
            return self._err(502, str(e))
        self._err(404, "нет такой ручки")

    def _api_get(self, path, qs):
        try:
            if path == "/api/config":
                return self._send(200, load_config())
            if path == "/api/constants":
                return self._send(200, constants())
            if path == "/api/search":
                return self._send(200, search((qs.get("q") or [""])[0]))
            if path == "/api/resolve":
                aid = dota.parse_account_id((qs.get("q") or [""])[0])
                return self._send(200, {"account_id": aid})
            m = re.fullmatch(r"/api/player/(\d+)", path)
            if m:
                fresh = (qs.get("fresh") or ["0"])[0] == "1"
                return self._send(200, player_bundle(int(m.group(1)), fresh))
            if path == "/api/meta":
                return self._send(200, meta())
            if path == "/api/promatches":
                return self._send(200, pro_matches())
            m = re.fullmatch(r"/api/benchmarks/(\d+)", path)
            if m:
                return self._send(200, benchmarks(int(m.group(1))))
            m = re.fullmatch(r"/api/meta/hero/(\d+)", path)
            if m:
                return self._send(200, meta_hero(int(m.group(1))))
            m = re.fullmatch(r"/api/player/(\d+)/heroes", path)
            if m:
                return self._send(200, player_heroes(int(m.group(1)), qs))
            m = re.fullmatch(r"/api/player/(\d+)/peers", path)
            if m:
                return self._send(200, peers(int(m.group(1))))
            m = re.fullmatch(r"/api/match/(\d+)", path)
            if m:
                return self._send(200, match_bundle(int(m.group(1))))
        except RuntimeError as e:
            return self._err(502, str(e))
        self._err(404, "нет такой ручки")

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.realpath(os.path.join(WEB, path.lstrip("/")))
        if not full.startswith(os.path.realpath(WEB) + os.sep) or not os.path.isfile(full):
            full = os.path.join(WEB, "index.html")  # SPA: любой путь → index
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fp:
            self._send(200, fp.read(), ctype)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("DOTA_PORT", 8777)))
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    print(f"[*] Dota Stats: http://127.0.0.1:{args.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
