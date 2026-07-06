import os, sys, hashlib, secrets, uuid as uuid_lib
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt, JWTError
import aiosqlite, httpx
from dotenv import load_dotenv

load_dotenv("/root/vpn_bot/.env")
sys.path.insert(0, "/root/vpn_bot")
sys.path.insert(0, "/root/vpn_web/api")
from xray import generate_vless_link, get_proxy_credentials, get_user_traffic_detail, generate_vless_configs

SECRET = os.getenv("JWT_SECRET", "vpn_secret_key_change_me")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
DB = "/root/vpn_bot/vpn.db"
AITUNNEL_KEY = os.getenv("AITUNNEL_KEY", "")
AITUNNEL_URL = "https://api.aitunnel.ru/v1"

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ─── DB helpers ───────────────────────────────────────────────────────────────
async def db_get(query, params=()):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cur:
            return await cur.fetchone()

async def db_exec(query, params=()):
    async with aiosqlite.connect(DB) as db:
        await db.execute(query, params)
        await db.commit()

# ─── JWT ──────────────────────────────────────────────────────────────────────
def make_token(data: dict) -> str:
    return jwt.encode({**data, "exp": datetime.utcnow() + timedelta(days=30)}, SECRET, algorithm="HS256")

def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(401, "Invalid token")

async def current_user(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "No token")
    return verify_token(auth[7:])

async def get_tg_id(user: dict) -> int:
    """Извлекает tg_user_id из JWT — работает и для сайта, и для miniapp."""
    # Miniapp-токен содержит tg_user_id напрямую
    if "tg_user_id" in user:
        return user["tg_user_id"]
    # Сайтовый токен содержит web_user_id
    wu = await db_get("SELECT tg_user_id FROM web_users WHERE id=?", (user["web_user_id"],))
    if not wu or not wu["tg_user_id"]:
        raise HTTPException(403, "Telegram not linked")
    return wu["tg_user_id"]

# ─── Вход по коду из бота ─────────────────────────────────────────────────────
@app.post("/api/auth/create_code")
async def create_code(request: Request):
    """Создаёт код входа — вызывается из GPT бота."""
    import hashlib, hmac as _hmac
    body = await request.json()
    user_id = body.get("user_id")
    code = body.get("code", "").strip()
    bot_secret = body.get("bot_secret", "")
    if not user_id or not code:
        raise HTTPException(400, "Missing fields")
    # Проверяем что запрос от нашего бота
    expected = hashlib.sha256(BOT_TOKEN.encode()).hexdigest()[:16]
    if not _hmac.compare_digest(expected, bot_secret):
        raise HTTPException(403, "Forbidden")
    sys.path.insert(0, "/root/vpn_bot")
    from database import create_login_code
    await create_login_code(user_id, code)
    return {"ok": True}

@app.post("/api/auth/code")
async def auth_by_code(request: Request):
    body = await request.json()
    code = body.get("code", "").strip()
    if not code:
        raise HTTPException(400, "No code")

    sys.path.insert(0, "/root/vpn_bot")
    from database import use_login_code
    tg_id = await use_login_code(code)
    if not tg_id:
        raise HTTPException(401, "Invalid or expired code")

    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))
    if not wu:
        await db_exec(
            "INSERT INTO web_users (tg_user_id) VALUES (?)", (tg_id,)
        )
        wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))

    token = make_token({"web_user_id": wu["id"], "tg_user_id": tg_id})
    return {
        "token": token,
        "user": {
            "tg_id": tg_id,
            "bot_registered": tg is not None,
            "vpn": {
                "active": bool(tg["active"]),
                "paid_until": tg["paid_until"],
                "traffic_used_gb": tg["traffic_used_gb"],
                "traffic_limit_gb": tg["traffic_limit_gb"] if tg["traffic_limit_gb"] else 50,
            } if tg else None
        }
    }

# ─── Telegram Login Widget auth (оставляем для совместимости) ─────────────────
@app.post("/api/auth/telegram")
async def telegram_auth(request: Request):
    import hmac as _hmac
    data = await request.json()
    check_hash = data.pop("hash", "")
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    expected = _hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    if not _hmac.compare_digest(expected, check_hash):
        raise HTTPException(401, "Invalid Telegram auth")

    tg_id = int(data["id"])
    name = data.get("first_name", "") + (" " + data.get("last_name", "") if data.get("last_name") else "")
    username = data.get("username", "")
    avatar = data.get("photo_url", "")

    wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))
    if not wu:
        await db_exec(
            "INSERT INTO web_users (email, name, avatar, tg_user_id) VALUES (?,?,?,?)",
            (username or str(tg_id), name, avatar, tg_id)
        )
        wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))
    else:
        await db_exec("UPDATE web_users SET name=?, avatar=? WHERE tg_user_id=?", (name, avatar, tg_id))
        wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))

    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    token = make_token({"web_user_id": wu["id"], "tg_user_id": tg_id})
    return {
        "token": token,
        "user": {
            "name": name,
            "avatar": avatar,
            "tg_id": tg_id,
            "bot_registered": tg is not None,
            "vpn": {
                "active": bool(tg["active"]),
                "paid_until": tg["paid_until"],
                "traffic_used_gb": tg["traffic_used_gb"],
                "traffic_limit_gb": tg["traffic_limit_gb"] if tg["traffic_limit_gb"] else 50,
            } if tg else None
        }
    }

# ─── Профиль ──────────────────────────────────────────────────────────────────
@app.get("/api/me")
async def me(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    wu = await db_get("SELECT * FROM web_users WHERE tg_user_id=?", (tg_id,))
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    return {
        "name": wu["name"] if wu else "",
        "avatar": wu["avatar"] if wu else "",
        "tg_id": tg_id,
        "bot_registered": tg is not None,
        "vpn": {
            "active": bool(tg["active"]),
            "paid_until": tg["paid_until"],
            "traffic_used_gb": tg["traffic_used_gb"],
            "traffic_limit_gb": tg["traffic_limit_gb"] if tg["traffic_limit_gb"] else 50,
        } if tg else None
    }

# ─── Трафик детально ──────────────────────────────────────────────────────────
@app.get("/api/traffic")
async def get_traffic(user=Depends(current_user)):
    import asyncio
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    if not tg or not tg["active"]:
        raise HTTPException(403, "Subscription not active")
    detail = await asyncio.get_event_loop().run_in_executor(
        None, get_user_traffic_detail, str(tg_id)
    )
    limit = tg["traffic_limit_gb"] if tg["traffic_limit_gb"] else 50
    # Кол-во устройств
    row = await db_get(
        "SELECT COUNT(*) as c FROM device_sessions WHERE user_id=? AND last_seen > datetime('now', '-30 days')",
        (tg_id,)
    )
    devices_count = row["c"] if row else 0
    return {**detail, "limit": limit, "devices": devices_count}

# ─── VPN конфиг ───────────────────────────────────────────────────────────────
@app.get("/api/config/vpn")
async def get_vpn_config(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    if not tg or not tg["active"]:
        raise HTTPException(403, "Subscription not active")
    return {"link": generate_vless_link(tg["uuid"])}

# ─── Subscription link (для v2rayNG / Hiddify / Streisand) ───────────────────
@app.get("/sub/{sub_token}")
@app.head("/sub/{sub_token}")
async def subscription(sub_token: str, request: Request):
    import base64, json as _json
    from fastapi.responses import PlainTextResponse
    tg = await db_get("SELECT * FROM users WHERE sub_token=?", (sub_token,))
    if not tg or not tg["active"]:
        raise HTTPException(404)

    # Проверка истечения подписки
    if tg["paid_until"]:
        from datetime import date
        if datetime.strptime(tg["paid_until"], "%Y-%m-%d").date() < date.today():
            raise HTTPException(403, "Subscription expired. Please renew.")

    # Проверка блокировки по трафику
    if tg["traffic_blocked"]:
        raise HTTPException(403, "Traffic limit exceeded. Wait until next month.")

    # Трекинг устройства — нормализуем UA до имени приложения
    ua_raw = request.headers.get("User-Agent", "")[:200]
    ip = request.headers.get("X-Real-IP", request.client.host if request.client else "")
    # Определяем приложение (убираем версию — одно приложение = одно устройство)
    ua = "Unknown"
    for app in ["v2rayNG","Hiddify","Streisand","NekoBox","Shadowrocket","ClashMeta","clash","sing-box","v2raytun","Happ","NekoRay","Quantumult","Surge"]:
        if app.lower() in ua_raw.lower():
            ua = app
            break
    else:
        ua = ua_raw[:40] or "Unknown"
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            """INSERT INTO device_sessions (user_id, sub_token, user_agent, ip, last_seen)
               VALUES (?,?,?,?,datetime('now'))
               ON CONFLICT(user_id, user_agent) DO UPDATE SET last_seen=datetime('now'), ip=excluded.ip""",
            (tg["user_id"], sub_token, ua, ip)
        )
        await db.commit()

    uuids = [tg["uuid"], tg["uuid2"] or tg["uuid"], tg["uuid3"] or tg["uuid"]]
    configs = generate_vless_configs(uuids)
    links_list = [c["link"] for c in configs]
    async with aiosqlite.connect(DB) as _db:
        _db.row_factory = aiosqlite.Row
        async with _db.execute("SELECT * FROM servers WHERE active=1") as _cur:
            _extra = await _cur.fetchall()
    for _s in _extra:
        links_list.append(
            f"vless://{tg['uuid']}@{_s['ip']}:443"
            f"?type=tcp&security=reality&pbk={_s['public_key']}"
            f"&fp=chrome&sni=lklunallm.icu&sid={_s['short_id']}"
            f"&flow=xtls-rprx-vision&encryption=none"
            f"#{_s['flag']} {_s['name']} - TCP"
        )
        links_list.append(
            f"vless://{tg['uuid']}@{_s['ip']}:444"
            f"?type=xhttp&security=reality&pbk={_s['public_key']}"
            f"&fp=chrome&sni=lklunallm.icu&sid={_s['short_id']}"
            f"&path=%2Fassets%2Fimg&mode=stream-one&encryption=none"
            f"#{_s['flag']} {_s['name']} - XHTTP"
        )
    links = "\n".join(links_list)
    encoded = base64.b64encode(links.encode()).decode()

    limit_gb = tg["traffic_limit_gb"] or 50
    limit_bytes = limit_gb * 1024 ** 3
    expire_ts = 0
    if tg["paid_until"]:
        try:
            expire_ts = int(datetime.strptime(tg["paid_until"], "%Y-%m-%d").timestamp())
        except Exception:
            pass

    # Корректный подсчёт трафика: кэш + live Xray API

    uid_str = str(tg["user_id"])

    used_bytes = 0

    try:

        with open("/usr/local/etc/xray/traffic_cache.json") as f:

            cache = _json.load(f)

        used_bytes = cache.get(uid_str, 0) + cache.get(f"proxy_{uid_str}", 0)

    except Exception:

        pass

    

    # Добавляем live трафик из Xray

    try:

        detail = get_user_traffic_detail(uid_str)

        used_bytes = int(detail["total"] * 1024**3)

    except Exception:

        pass


    # Routing профиль для Happ — bypass RU трафика
    routing_profile = {
        "Name": "KomoVPN-NoRU",
        "GlobalProxy": "true",
        "DirectSites": ["geosite:category-ru"],
        "DirectIp": ["geoip:ru", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
        "DomainStrategy": "IPIfNonMatch",
        "FakeDNS": "false"
    }
    routing_b64 = base64.b64encode(_json.dumps(routing_profile, ensure_ascii=False).encode()).decode()

    title = "KomoVPN 🇫🇮"
    return PlainTextResponse(encoded, headers={
        "content-type": "text/plain; charset=utf-8",
        "profile-title": "base64:" + base64.b64encode(title.encode()).decode(),
        "profile-web-page-url": "https://t.me/KomoVpn_bot",
        "subscription-userinfo": f"upload=0; download={used_bytes}; total={limit_bytes}; expire={expire_ts}",
        "profile-update-interval": "12",
        "support-url": "https://t.me/KomoVpn_bot",
        "routing": f"happ://routing/onadd/{routing_b64}",
    })

@app.get("/sub-noru/{sub_token}")
@app.head("/sub-noru/{sub_token}")
async def subscription_noru(sub_token: str):
    """Подписка 'без RU' — те же конфиги + routing профиль bypass для российских сайтов."""
    import base64, json as _json
    from fastapi.responses import PlainTextResponse
    tg = await db_get("SELECT * FROM users WHERE sub_token=?", (sub_token,))
    if not tg or not tg["active"]:
        raise HTTPException(404)

    # Проверка истечения подписки
    if tg["paid_until"]:
        from datetime import date
        if datetime.strptime(tg["paid_until"], "%Y-%m-%d").date() < date.today():
            raise HTTPException(403, "Subscription expired. Please renew.")

    # Проверка блокировки по трафику
    if tg["traffic_blocked"]:
        raise HTTPException(403, "Traffic limit exceeded. Wait until next month.")

    uuids = [tg["uuid"], tg["uuid2"] or tg["uuid"], tg["uuid3"] or tg["uuid"]]
    configs = generate_vless_configs(uuids)
    links_list = [c["link"] for c in configs]
    async with aiosqlite.connect(DB) as _db:
        _db.row_factory = aiosqlite.Row
        async with _db.execute("SELECT * FROM servers WHERE active=1") as _cur:
            _extra = await _cur.fetchall()
    for _s in _extra:
        links_list.append(
            f"vless://{tg['uuid']}@{_s['ip']}:443"
            f"?type=tcp&security=reality&pbk={_s['public_key']}"
            f"&fp=chrome&sni=lklunallm.icu&sid={_s['short_id']}"
            f"&flow=xtls-rprx-vision&encryption=none"
            f"#{_s['flag']} {_s['name']} - TCP"
        )
        links_list.append(
            f"vless://{tg['uuid']}@{_s['ip']}:444"
            f"?type=xhttp&security=reality&pbk={_s['public_key']}"
            f"&fp=chrome&sni=lklunallm.icu&sid={_s['short_id']}"
            f"&path=%2Fassets%2Fimg&mode=stream-one&encryption=none"
            f"#{_s['flag']} {_s['name']} - XHTTP"
        )
    links = "\n".join(links_list)
    encoded = base64.b64encode(links.encode()).decode()

    limit_gb = tg["traffic_limit_gb"] or 50
    limit_bytes = limit_gb * 1024 ** 3
    expire_ts = 0
    if tg["paid_until"]:
        try:
            expire_ts = int(datetime.strptime(tg["paid_until"], "%Y-%m-%d").timestamp())
        except Exception:
            pass

    # Корректный подсчёт трафика: кэш + live Xray API

    uid_str = str(tg["user_id"])

    used_bytes = 0

    try:

        with open("/usr/local/etc/xray/traffic_cache.json") as f:

            cache = _json.load(f)

        used_bytes = cache.get(uid_str, 0) + cache.get(f"proxy_{uid_str}", 0)

    except Exception:

        pass

    

    # Добавляем live трафик из Xray

    try:

        detail = get_user_traffic_detail(uid_str)

        used_bytes = int(detail["total"] * 1024**3)

    except Exception:

        pass


    # Routing профиль для Happ — bypass RU трафика
    routing_profile = {
        "Name": "KomoVPN-NoRU",
        "GlobalProxy": "true",
        "DirectSites": ["geosite:category-ru"],
        "DirectIp": ["geoip:ru", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
        "DomainStrategy": "IPIfNonMatch",
        "FakeDNS": "false"
    }
    routing_b64 = base64.b64encode(_json.dumps(routing_profile, ensure_ascii=False).encode()).decode()

    title = "KomoVPN 🚫🇷🇺"
    return PlainTextResponse(encoded, headers={
        "content-type": "text/plain; charset=utf-8",
        "profile-title": "base64:" + base64.b64encode(title.encode()).decode(),
        "profile-web-page-url": "https://t.me/KomoVpn_bot",
        "subscription-userinfo": f"upload=0; download={used_bytes}; total={limit_bytes}; expire={expire_ts}",
        "profile-update-interval": "12",
        "support-url": "https://t.me/KomoVpn_bot",
        "routing": f"happ://routing/onadd/{routing_b64}",
    })

@app.get("/sub-ru/{sub_token}")
async def subscription_ru(sub_token: str):
    import base64
    from fastapi.responses import PlainTextResponse
    from xray import RELAY_IP, PUBLIC_KEY, SHORT_ID
    tg = await db_get("SELECT * FROM users WHERE sub_token=?", (sub_token,))
    if not tg or not tg["active"]:
        raise HTTPException(404)

    uuids = [tg["uuid"], tg["uuid2"] or tg["uuid"], tg["uuid3"] or tg["uuid"]]
    fps = ["chrome", "firefox", "safari"]
    names = ["Chrome", "Firefox", "Safari"]
    sni = "api-maps.yandex.ru"

    links = "\n".join(
        f"vless://{uid}@{RELAY_IP}:443"
        f"?type=tcp&security=reality&pbk={PUBLIC_KEY}"
        f"&fp={fp}&sni={sni}&sid={SHORT_ID}&flow=xtls-rprx-vision"
        f"#KomoVPN-RU-{name}-WL"
        for uid, fp, name in zip(uuids, fps, names)
    )
    encoded = base64.b64encode(links.encode()).decode()

    limit_gb = tg["traffic_limit_gb"] or 50
    limit_bytes = limit_gb * 1024 ** 3
    expire_ts = 0
    if tg["paid_until"]:
        from datetime import datetime
        try:
            expire_ts = int(datetime.strptime(tg["paid_until"], "%Y-%m-%d").timestamp())
        except Exception:
            pass

    return PlainTextResponse(encoded, headers={
        "profile-title": "base64:" + base64.b64encode("KomoVPN 🇷🇺 RU".encode()).decode(),
        "subscription-userinfo": f"upload=0; download=0; total={limit_bytes}; expire={expire_ts}",
        "profile-update-interval": "12",
        "support-url": "https://t.me/KomoVpn_bot",
    })

@app.get("/api/config/sub")
async def get_sub_link(user=Depends(current_user)):
    """Возвращает персональную ссылку на подписку."""
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    if not tg or not tg["active"]:
        raise HTTPException(403, "Subscription not active")
    sys.path.insert(0, "/root/vpn_bot")
    from database import ensure_sub_token
    sub_token = await ensure_sub_token(tg_id)
    return {"url": f"https://lklunallm.icu/sub/{sub_token}",
            "url_full": f"https://lklunallm.icu/sub-full/{sub_token}"}

@app.get("/sub-full/{sub_token}")
@app.head("/sub-full/{sub_token}")
async def subscription_full(sub_token: str):
    """Полный JSON конфиг с routing (bypass RU) — для Happ/v2rayTun/NekoBox."""
    import base64, json as _json
    from fastapi.responses import PlainTextResponse
    from xray import SERVER_IP, PUBLIC_KEY, SHORT_ID
    SE_PUBLIC_KEY = "zRNxyDecL1BALYV2LaCrfCU9D-vlCn6BYd1XaS1M1D8"
    SE_SHORT_ID   = "4b7fb4a951bea2c9"
    SE_IP         = "46.226.164.14"

    tg = await db_get("SELECT * FROM users WHERE sub_token=?", (sub_token,))
    if not tg or not tg["active"]:
        raise HTTPException(404)

    uuids = [tg["uuid"], tg["uuid2"] or tg["uuid"], tg["uuid3"] or tg["uuid"]]

    routing = {
        "domainStrategy": "IPIfNonMatch",
        "rules": [
            {
                "type": "field",
                "domain": [
                    "geosite:ru", "geosite:category-gov-ru", "geosite:category-banks-ru",
                    "ozon.ru", "wildberries.ru", "wb.ru", "gosuslugi.ru", "mos.ru", "nalog.ru",
                    "yandex.ru", "yandex.com", "ya.ru", "avito.ru",
                    "sber.ru", "sberbank.ru", "tbank.ru", "alfabank.ru", "vtb.ru",
                    "rzd.ru", "magnit.ru", "x5.ru", "vk.com", "vk.ru", "ok.ru",
                    "mail.ru", "2gis.ru"
                ],
                "outboundTag": "direct"
            },
            {"type": "field", "ip": ["geoip:ru", "geoip:private"], "outboundTag": "direct"}
        ]
    }

    servers = [
        (SERVER_IP, 4443, PUBLIC_KEY,    SHORT_ID,    "chrome",  "www.microsoft.com",       "🇫🇮 Finland-Chrome"),
        (SERVER_IP, 4443, PUBLIC_KEY,    SHORT_ID,    "firefox", "www.cloudflare.com",      "🇫🇮 Finland-Firefox"),
        (SERVER_IP, 4443, PUBLIC_KEY,    SHORT_ID,    "safari",  "www.apple.com",           "🇫🇮 Finland-Safari"),
        (SE_IP,     4443, SE_PUBLIC_KEY, SE_SHORT_ID, "chrome",  "www.amd.com",    "🇸🇪 Stockholm-AMD"),
        (SE_IP,     4443, SE_PUBLIC_KEY, SE_SHORT_ID, "firefox", "www.nvidia.com", "🇸🇪 Stockholm-NVIDIA"),
        (SE_IP,     4443, SE_PUBLIC_KEY, SE_SHORT_ID, "safari",  "www.apple.com",  "🇸🇪 Stockholm-Safari"),
    ]

    configs = []
    for i, (ip, port, pbk, sid, fp, sni, name) in enumerate(servers):
        uid = uuids[i % 3]
        configs.append({
            "log": {"loglevel": "warning"},
            "routing": routing,
            "inbounds": [],
            "outbounds": [
                {
                    "tag": "proxy", "protocol": "vless",
                    "settings": {"vnext": [{"address": ip, "port": port, "users": [
                        {"id": uid, "flow": "xtls-rprx-vision", "encryption": "none"}
                    ]}]},
                    "streamSettings": {
                        "network": "tcp", "security": "reality",
                        "realitySettings": {"serverName": sni, "fingerprint": fp,
                                            "publicKey": pbk, "shortId": sid, "spiderX": "/"}
                    }
                },
                {"tag": "direct", "protocol": "freedom"},
                {"tag": "block",  "protocol": "blackhole"}
            ],
            "remarks": name
        })

    encoded = base64.b64encode(_json.dumps(configs, ensure_ascii=False).encode()).decode()
    limit_bytes = (tg["traffic_limit_gb"] or 50) * 1024 ** 3
    expire_ts = 0
    if tg["paid_until"]:
        try:
            expire_ts = int(datetime.strptime(tg["paid_until"], "%Y-%m-%d").timestamp())
        except Exception:
            pass

    return PlainTextResponse(encoded, headers={
        "content-type": "text/plain; charset=utf-8",
        "profile-title": "base64:" + base64.b64encode("KomoVPN Full".encode()).decode(),
        "subscription-userinfo": f"upload=0; download=0; total={limit_bytes}; expire={expire_ts}",
        "profile-update-interval": "12",
    })

# ─── Прокси конфиг ────────────────────────────────────────────────────────────
@app.get("/api/config/proxy")
async def get_proxy_config(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    if not tg or not tg["active"]:
        raise HTTPException(403, "Subscription not active")
    return get_proxy_credentials(tg_id)

# ─── Тарифы (публичные) ───────────────────────────────────────────────────────
@app.get("/api/plans")
async def plans():
    from config import PRICE, TRAFFIC_LIMITS
    return {
        "plans": [
            {"months": 1,  "label": "1 месяц",    "price": PRICE,             "discount": 0,  "traffic_gb": TRAFFIC_LIMITS[1]  * 1},
            {"months": 3,  "label": "3 месяца",   "price": int(PRICE*3*0.9),  "discount": 10, "traffic_gb": TRAFFIC_LIMITS[3]  * 3},
            {"months": 6,  "label": "6 месяцев",  "price": int(PRICE*6*0.8),  "discount": 20, "traffic_gb": TRAFFIC_LIMITS[6]  * 6},
            {"months": 12, "label": "12 месяцев", "price": int(PRICE*12*0.7), "discount": 30, "traffic_gb": TRAFFIC_LIMITS[12] * 12},
        ]
    }

# ─── Telegram Mini App — верификация initData ─────────────────────────────────
@app.post("/api/miniapp/auth")
async def miniapp_auth(request: Request):
    import hmac as _hmac, json as _json
    from urllib.parse import parse_qsl
    body = await request.json()
    init_data = body.get("initData", "")
    if not init_data:
        raise HTTPException(400, "No initData")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    check_hash = pairs.pop("hash", "")
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = _hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = _hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    if not _hmac.compare_digest(expected, check_hash):
        raise HTTPException(401, "Invalid Telegram data")

    tg_user = _json.loads(pairs.get("user", "{}"))
    tg_id = tg_user.get("id")
    if not tg_id:
        raise HTTPException(400)

    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    token = make_token({"tg_user_id": tg_id})
    return {
        "token": token,
        "user": tg_user,
        "vpn_active": bool(tg["active"]) if tg else False,
        "paid_until": tg["paid_until"] if tg else None,
        "traffic_used_gb": tg["traffic_used_gb"] if tg else 0,
        "traffic_limit_gb": (tg["traffic_limit_gb"] if tg["traffic_limit_gb"] else 50) if tg else 50,
    }

# ─── ChatGPT API ──────────────────────────────────────────────────────────────

def _get_user_tier(tg_row) -> int:
    if not tg_row or not tg_row["active"]:
        return -1
    try:
        delta = (datetime.strptime(tg_row["paid_until"], "%Y-%m-%d") - datetime.now()).days
        if delta < 0:
            return -1
    except Exception:
        return -1
    limit = tg_row["traffic_limit_gb"] or 0
    # Тарифы: 1мес=100, 3мес=450, 6мес=1200, 12мес=3600
    if limit >= 3600: return 12
    if limit >= 1200: return 6
    if limit >= 450:  return 3
    if limit >= 100:  return 1
    if limit >= 10:   return 0  # триал
    return -1

@app.get("/api/status")
async def server_status():
    import subprocess, time, psutil
    result = {}
    # Статус сервисов
    for svc in ["vpn-bot", "vpn-api", "xray", "nginx"]:
        r = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
        result[svc] = r.stdout.strip() == "active"
    # Системные метрики
    result["cpu_pct"] = psutil.cpu_percent(interval=0.5)
    result["ram_pct"] = psutil.virtual_memory().percent
    result["disk_pct"] = psutil.disk_usage("/").percent
    result["uptime_days"] = int((time.time() - psutil.boot_time()) / 86400)
    # Пинг до xray
    try:
        import socket
        t = time.time()
        s = socket.create_connection(("127.0.0.1", 4443), timeout=1)
        s.close()
        result["xray_ping_ms"] = round((time.time() - t) * 1000)
    except Exception:
        result["xray_ping_ms"] = -1
    # Кол-во активных пользователей
    row = await db_get("SELECT COUNT(*) as c FROM users WHERE active=1")
    result["active_users"] = row["c"] if row else 0
    return result
async def gpt_models(user=Depends(current_user)):
    from gpt_config import MODELS, TIER_LABELS
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    tier = _get_user_tier(tg)
    if tier < 0:
        raise HTTPException(403, "No active subscription")
    result = []
    for mid, m in MODELS.items():
        result.append({
            "id": mid,
            "name": m["name"],
            "desc": m["desc"],
            "tier": m["tier"],
            "available": m["tier"] <= tier,
            "tier_label": TIER_LABELS.get(m["tier"], ""),
        })
    return {"models": result, "current_tier": tier}

@app.get("/api/gpt/session")
async def gpt_session(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    row = await db_get("SELECT model FROM chat_sessions WHERE user_id=?", (tg_id,))
    return {"model": row["model"] if row else "gpt-5-nano"}

@app.post("/api/gpt/session")
async def gpt_set_session(request: Request, user=Depends(current_user)):
    from gpt_config import MODELS
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    tier = _get_user_tier(tg)
    body = await request.json()
    model_id = body.get("model", "gpt-5-nano")
    if model_id not in MODELS or MODELS[model_id]["tier"] > tier:
        raise HTTPException(403, "Model not available on your plan")
    await db_exec(
        "INSERT OR REPLACE INTO chat_sessions (user_id, model, updated_at) VALUES (?,?,datetime('now'))",
        (tg_id, model_id)
    )
    return {"ok": True}

@app.get("/api/gpt/history")
async def gpt_history(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    row = await db_get("SELECT model FROM chat_sessions WHERE user_id=?", (tg_id,))
    model = row["model"] if row else "gpt-5-nano"
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT role, content, created_at FROM chat_history WHERE user_id=? AND model=? ORDER BY id DESC LIMIT 50",
            (tg_id, model)
        ) as cur:
            rows = await cur.fetchall()
    return {"history": [dict(r) for r in reversed(rows)], "model": model}

@app.post("/api/gpt/chat")
async def gpt_chat(request: Request, user=Depends(current_user)):
    from gpt_config import MODELS
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    tier = _get_user_tier(tg)
    if tier < 0:
        raise HTTPException(403, "No active subscription")

    body = await request.json()
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(400, "Empty message")

    row = await db_get("SELECT model FROM chat_sessions WHERE user_id=?", (tg_id,))
    model_id = row["model"] if row else "gpt-5-nano"
    if model_id not in MODELS or MODELS[model_id]["tier"] > tier:
        model_id = "gpt-5-nano"

    # История
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT role, content FROM chat_history WHERE user_id=? AND model=? ORDER BY id DESC LIMIT 10",
            (tg_id, model_id)
        ) as cur:
            hist = await cur.fetchall()
    messages = [{"role": r["role"], "content": r["content"]} for r in reversed(hist)]
    messages.append({"role": "user", "content": message})

    # Сохраняем вопрос
    await db_exec(
        "INSERT INTO chat_history (user_id, model, role, content) VALUES (?,?,?,?)",
        (tg_id, model_id, "user", message)
    )

    # Запрос к aitunnel
    headers = {"Authorization": f"Bearer {AITUNNEL_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{AITUNNEL_URL}/chat/completions",
                json={"model": model_id, "messages": messages, "max_tokens": 2000},
                headers=headers
            )
            r.raise_for_status()
            answer = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}")

    await db_exec(
        "INSERT INTO chat_history (user_id, model, role, content) VALUES (?,?,?,?)",
        (tg_id, model_id, "assistant", answer)
    )
    return {"answer": answer, "model": model_id}

@app.delete("/api/gpt/history")
async def gpt_clear_history(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    row = await db_get("SELECT model FROM chat_sessions WHERE user_id=?", (tg_id,))
    model = row["model"] if row else None
    if model:
        await db_exec("DELETE FROM chat_history WHERE user_id=? AND model=?", (tg_id, model))
    return {"ok": True}

@app.delete("/api/gpt/history/last")
async def gpt_delete_last(user=Depends(current_user)):
    """Удаляет последние 2 сообщения (user + assistant) для regenerate."""
    tg_id = await get_tg_id(user)
    row = await db_get("SELECT model FROM chat_sessions WHERE user_id=?", (tg_id,))
    model = row["model"] if row else None
    if model:
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                "DELETE FROM chat_history WHERE id IN (SELECT id FROM chat_history WHERE user_id=? AND model=? ORDER BY id DESC LIMIT 2)",
                (tg_id, model)
            )
            await db.commit()
    return {"ok": True}

# ─── GPT Models list ──────────────────────────────────────────────────────────
@app.get("/api/gpt/models")
async def gpt_models_list(user=Depends(current_user)):
    from gpt_config import MODELS, TIER_LABELS
    tg_id = await get_tg_id(user)
    tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
    tier = _get_user_tier(tg)
    if tier < 0:
        raise HTTPException(403, "No active subscription")
    result = []
    for mid, m in MODELS.items():
        result.append({
            "id": mid, "name": m["name"], "desc": m["desc"],
            "tier": m["tier"], "available": m["tier"] <= tier,
            "tier_label": TIER_LABELS.get(m["tier"], ""),
        })
    return {"models": result, "current_tier": tier}

# ─── Referrals ────────────────────────────────────────────────────────────────
@app.get("/api/referrals")
async def get_referrals(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    row = await db_get("SELECT COUNT(*) as c FROM users WHERE referred_by=?", (tg_id,))
    count = row["c"] if row else 0
    # Бонус: 7 дней за каждого оплатившего реферала
    paid_row = await db_get(
        "SELECT COUNT(*) as c FROM users u JOIN payments p ON u.user_id=p.user_id "
        "WHERE u.referred_by=? AND p.status='confirmed'", (tg_id,)
    )
    paid_count = paid_row["c"] if paid_row else 0
    # Получаем username бота для формирования ссылки
    link = f"https://t.me/KomoVpn_bot?start=ref{tg_id}"
    return {"count": count, "paid_count": paid_count, "bonus_days": paid_count * 7, "link": link}

# ─── Payments history ─────────────────────────────────────────────────────────
@app.get("/api/payments")
async def get_payments(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, amount, months, status, created_at FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20",
            (tg_id,)
        ) as cur:
            rows = await cur.fetchall()
    return {"payments": [dict(r) for r in rows]}

# ─── Promo codes ──────────────────────────────────────────────────────────────
@app.post("/api/promo/apply")
async def apply_promo(request: Request, user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    body = await request.json()
    code = body.get("code", "").strip().upper()
    if not code:
        raise HTTPException(400, "No code")
    promo = await db_get("SELECT * FROM promo_codes WHERE code=? AND (uses_left IS NULL OR uses_left > 0) AND (expires_at IS NULL OR expires_at > datetime('now'))", (code,))
    if not promo:
        raise HTTPException(404, "Промокод не найден или истёк")
    # Проверяем, не использовал ли уже
    used = await db_get("SELECT 1 FROM promo_uses WHERE code=? AND user_id=?", (code, tg_id))
    if used:
        raise HTTPException(409, "Промокод уже использован")
    # Применяем
    async with aiosqlite.connect(DB) as db:
        await db.execute("INSERT INTO promo_uses (code, user_id) VALUES (?,?)", (code, tg_id))
        if promo["uses_left"] is not None:
            await db.execute("UPDATE promo_codes SET uses_left=uses_left-1 WHERE code=?", (code,))
        # Если промокод даёт дни — продлеваем подписку
        if promo["days"] and promo["days"] > 0:
            tg = await db_get("SELECT * FROM users WHERE user_id=?", (tg_id,))
            if tg:
                base = datetime.now()
                if tg["paid_until"] and tg["active"]:
                    try:
                        base = max(base, datetime.strptime(tg["paid_until"], "%Y-%m-%d"))
                    except Exception:
                        pass
                new_until = (base + timedelta(days=promo["days"])).strftime("%Y-%m-%d")
                await db.execute("UPDATE users SET active=1, paid_until=? WHERE user_id=?", (new_until, tg_id))
        await db.commit()
    msg = f"+{promo['days']} дней к подписке!" if promo.get("days") else "Скидка применена!"
    return {"ok": True, "message": msg, "days": promo.get("days", 0)}

# ─── Admin: create promo ──────────────────────────────────────────────────────
@app.post("/api/admin/promo")
async def create_promo(request: Request, user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    import os
    if tg_id != int(os.getenv("ADMIN_ID", 0)):
        raise HTTPException(403, "Admin only")
    body = await request.json()
    code = body.get("code", "").strip().upper()
    days = body.get("days", 0)
    uses_left = body.get("uses_left")  # None = unlimited
    expires_at = body.get("expires_at")  # ISO date string or None
    if not code:
        raise HTTPException(400, "No code")
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT OR REPLACE INTO promo_codes (code, days, uses_left, expires_at) VALUES (?,?,?,?)",
            (code, days, uses_left, expires_at)
        )
        await db.commit()
    return {"ok": True, "code": code}

# ─── MTProto proxy info ───────────────────────────────────────────────────────
@app.get("/api/mtproto")
async def get_mtproto():
    return {
        "server": "46.226.164.14",
        "port": 2443,
        "secret": "ee1ebc8efa337b7f451ad5afdac8e56aba7777772e636c6f7564666c6172652e636f6d",
        "link": "tg://proxy?server=46.226.164.14&port=2443&secret=ee1ebc8efa337b7f451ad5afdac8e56aba7777772e636c6f7564666c6172652e636f6d"
    }

# ─── Устройства (счётчик подключений) ────────────────────────────────────────
@app.get("/api/devices")
async def get_devices(user=Depends(current_user)):
    tg_id = await get_tg_id(user)
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT user_agent, ip, last_seen FROM device_sessions
               WHERE user_id=? AND last_seen > datetime('now', '-30 days')
               ORDER BY last_seen DESC""",
            (tg_id,)
        ) as cur:
            rows = await cur.fetchall()
    devices = []
    for r in rows:
        ua = r["user_agent"] or ""
        # Определяем приложение по User-Agent
        if "v2rayNG" in ua:       app_name = "v2rayNG"
        elif "Hiddify" in ua:     app_name = "Hiddify"
        elif "Streisand" in ua:   app_name = "Streisand"
        elif "NekoBox" in ua:     app_name = "NekoBox"
        elif "Shadowrocket" in ua: app_name = "Shadowrocket"
        elif "ClashMeta" in ua or "clash" in ua.lower(): app_name = "Clash"
        elif "sing-box" in ua.lower(): app_name = "sing-box"
        else:                     app_name = ua[:40] or "Unknown"
        devices.append({"app": app_name, "ip": r["ip"], "last_seen": r["last_seen"]})
    return {"devices": devices, "count": len(devices)}

# ─── Ping / health ────────────────────────────────────────────────────────────
@app.get("/api/ping")
async def ping():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}

# ─── aLuna STT/TTS токены ─────────────────────────────────────────────────────

@app.post("/api/alvoice/token/register")
async def alvoice_register_token(request: Request):
    """Бот вызывает этот эндпоинт когда пользователь отправляет токен Салюта."""
    data = await request.json()
    tg_user_id   = data.get("tg_user_id")
    salute_token = data.get("salute_token", "").strip()
    bot_secret   = data.get("bot_secret", "")

    # Проверяем что запрос от нашего бота
    if bot_secret != hashlib.sha256(BOT_TOKEN.encode()).hexdigest()[:16]:
        raise HTTPException(403, "Forbidden")
    if not tg_user_id or not salute_token:
        raise HTTPException(400, "Missing fields")

    user_uuid = str(uuid_lib.uuid4())

    async with aiosqlite.connect(DB) as db:
        # Если уже есть — обновляем токен, UUID не меняем
        existing = await db_get(
            "SELECT uuid FROM alvoice_tokens WHERE tg_user_id=?", (tg_user_id,)
        )
        if existing:
            user_uuid = existing["uuid"]
            await db.execute(
                "UPDATE alvoice_tokens SET salute_token=?, updated_at=datetime('now') WHERE tg_user_id=?",
                (salute_token, tg_user_id)
            )
        else:
            await db.execute(
                "INSERT INTO alvoice_tokens(uuid, tg_user_id, salute_token) VALUES(?,?,?)",
                (user_uuid, tg_user_id, salute_token)
            )
        await db.commit()

    return {"uuid": user_uuid, "status": "ok"}


@app.get("/api/alvoice/token/{user_uuid}")
async def alvoice_get_token(user_uuid: str):
    """Приложение запрашивает токен по UUID."""
    row = await db_get(
        "SELECT salute_token FROM alvoice_tokens WHERE uuid=?", (user_uuid,)
    )
    if not row:
        raise HTTPException(404, "UUID not found")
    return {"salute_token": row["salute_token"]}


# ─── aLuna app update ─────────────────────────────────────────────────────────
@app.get("/api/alvoice/version")
async def alvoice_version():
    return {
        "version": "1.3",
        "version_code": 9,
        "url": "http://193.17.182.23/update/alvoice.apk",
        "changelog": "✨ Обновление 1.3\n\n🧠 Умная память (RAG)\nАлуна теперь запоминает тебя по-настоящему — через нейросетевые эмбеддинги. Она понимает смысл, а не просто слова.\n\n🎯 Точные ответы\nРежим мышления (Reasoning) включён по умолчанию — Алуна думает перед ответом.\n\n🎙 Улучшенная озвучка\nSSML генерируется отдельной моделью специально под SaluteSpeech — правильные ударения, паузы, эмоции.\n\n💬 Красивый чат\nАнимация ожидания ответа, автоскролл при стриминге, плавный эффект печатания.\n\n⚙️ Новые настройки\nРежим мышления и SSML эмоции теперь можно включить/выключить в настройках.",
        "force": False
    }

# ─── init DB ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS web_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                name TEXT,
                avatar TEXT,
                tg_user_id INTEGER UNIQUE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                model TEXT,
                role TEXT,
                content TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                user_id INTEGER PRIMARY KEY,
                model TEXT DEFAULT 'gpt-5-nano',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_codes (
                code TEXT PRIMARY KEY,
                days INTEGER DEFAULT 0,
                uses_left INTEGER,
                expires_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_uses (
                code TEXT,
                user_id INTEGER,
                used_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (code, user_id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alvoice_tokens (
                uuid TEXT PRIMARY KEY,
                tg_user_id INTEGER UNIQUE,
                salute_token TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS device_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                sub_token TEXT NOT NULL,
                user_agent TEXT,
                ip TEXT,
                last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, user_agent)
            )
        """)
        await db.commit()

# ─── Трафик с удалённых серверов ──────────────────────────────────────────────
TRAFFIC_REPORT_SECRET = os.getenv("TRAFFIC_REPORT_SECRET", "komovpn_traffic_secret")

@app.post("/api/internal/report-traffic")
async def report_traffic(request: Request):
    """
    Удалённые серверы репортят трафик сюда.
    Body: {"secret": "...", "server_ip": "...", "traffic": {"user_id": bytes_int, ...}}
    """
    body = await request.json()
    if body.get("secret") != TRAFFIC_REPORT_SECRET:
        raise HTTPException(403, "Forbidden")

    traffic: dict = body.get("traffic", {})
    blocked_users = []

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        for uid_str, remote_bytes in traffic.items():
            try:
                user_id = int(uid_str)
            except ValueError:
                continue
            async with db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)) as cur:
                user = await cur.fetchone()
            if not user or not user["active"]:
                continue

            # Суммируем с локальным трафиком
            limit_gb = user["traffic_limit_gb"] or 50
            local_gb = user["traffic_used_gb"] or 0
            remote_gb = round(remote_bytes / 1024**3, 3)
            total_gb = round(local_gb + remote_gb, 3)

            await db.execute(
                "UPDATE users SET traffic_used_gb=? WHERE user_id=?",
                (total_gb, user_id)
            )

            if total_gb >= limit_gb and not user["traffic_blocked"]:
                await db.execute(
                    "UPDATE users SET traffic_blocked=1 WHERE user_id=?", (user_id,)
                )
                blocked_users.append({
                    "user_id": user_id,
                    "uuids": [u for u in [user["uuid"], user["uuid2"], user["uuid3"]] if u]
                })

        await db.commit()

    # Блокируем на всех серверах
    if blocked_users:
        import asyncio
        sys.path.insert(0, "/root/vpn_bot")
        from xray import block_client_on_server, remove_client_multi
        from database import get_servers

        servers = await get_servers()

        async def _block(u):
            uuids = u["uuids"]
            # Локальный финский сервер
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, remove_client_multi, uuids)
            # Удалённые серверы
            for s in servers:
                await loop.run_in_executor(
                    None, block_client_on_server,
                    s["ip"], s["ssh_user"], s["ssh_pass"], uuids
                )

        await asyncio.gather(*[_block(u) for u in blocked_users])

    return {"ok": True, "blocked": len(blocked_users)}
