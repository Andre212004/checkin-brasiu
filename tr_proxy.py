#!/usr/bin/env python3
# tr_proxy.py — Trade Republic proxy — porta 3001

import asyncio
import os
import pathlib
import threading
import queue as queue_module
import re
from datetime import datetime, timedelta
from flask import Flask, jsonify, request

app = Flask(__name__)

# Credenciais TR nunca guardadas no servidor — enviadas pela app em cada pedido
PHONE     = os.environ.get("TR_PHONE", "")   # fallback vazio — app deve enviar sempre
PIN       = os.environ.get("TR_PIN",   "")   # fallback vazio — app deve enviar sempre
CACHE_TTL = 3600  # 1 hora — reduz tentativas de reconexão ao TR

_cache      = {}
_cache_time = {}

# ── Flag de sessão expirada ───────────────────────────────────
# Quando True, o proxy devolve erro imediatamente sem tentar ligar ao TR.
# É limpo quando a autenticação é bem-sucedida.
_session_expired = False

def get_cached(key):
    if key in _cache and key in _cache_time:
        if datetime.now() - _cache_time[key] < timedelta(seconds=CACHE_TTL):
            return _cache[key]
    return None

def set_cached(key, data):
    _cache[key]      = data
    _cache_time[key] = datetime.now()

# ── Estado de autenticação (thread-safe) ─────────────────────
_auth_lock   = threading.Lock()
_auth_state  = {
    "active":       False,
    "phone":        None,
    "started_at":   None,
    "otp_queue":    None,
    "result_queue": None,
}

KNOWN_NAMES = {
    "IE00BK5BQT80": ("VWCE", "Vanguard FTSE All-World ETF"),
    "LU3170240538": ("XEON", "Xtrackers EUR Overnight Rate Swap ETF"),
    "LU3176111881": ("XEON2","Xtrackers EUR Overnight Rate ETF 2"),
    "XF000BTC0017": ("BTC",  "Bitcoin"),
    "XF000ETH0019": ("ETH",  "Ethereum"),
}

# ─────────────────────────────────────────────────────────────
#  AUTH
# ─────────────────────────────────────────────────────────────

def _cookies_path(phone):
    return str(pathlib.Path.home() / f".pytr/cookies.{phone}.txt")

def _auth_thread(phone, pin, otp_q, result_q):
    """Corre numa thread separada. Mantém o event loop vivo entre
    initiate e confirm — nunca chama initiate duas vezes."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def _run():
        from pytr.api import TradeRepublicApi
        api = TradeRepublicApi(
            phone_no=phone, pin=pin,
            save_cookies=True,
            cookies_file=_cookies_path(phone)
        )
        # 1. Enviar SMS (UMA vez)
        try:
            countdown = api.initiate_weblogin()
            result_q.put(("countdown", countdown))
        except ValueError as e:
            # Resposta vazia ou HTML do TR (rate limit silencioso / WAF)
            result_q.put(("error", "O Trade Republic devolveu uma resposta inválida. Pode estar em rate limit — aguarda 10-15 minutos e tenta novamente."))
            return
        except Exception as e:
            result_q.put(("error", str(e)))
            return

        # 2. Aguardar OTP do utilizador (máx 10 min)
        try:
            otp = otp_q.get(timeout=600)
        except queue_module.Empty:
            result_q.put(("confirm_error", "Timeout — não introduziste o código a tempo"))
            return

        # 3. Confirmar com o OTP recebido
        try:
            api.complete_weblogin(otp)
            result_q.put(("done", True))
        except Exception as e:
            result_q.put(("confirm_error", str(e)))

    loop.run_until_complete(_run())
    loop.close()

    with _auth_lock:
        _auth_state["active"]       = False
        _auth_state["otp_queue"]    = None
        _auth_state["result_queue"] = None


@app.route("/login/initiate", methods=["POST"])
def login_initiate():
    from datetime import datetime
    unblock = datetime(2026, 4, 9, 23, 0, 0)
    if datetime.now() < unblock:
        remaining = int((unblock - datetime.now()).total_seconds())
        return jsonify({
            "error": f"TR em rate limit. Próxima tentativa permitida em {remaining//3600}h {(remaining%3600)//60}min.",
            "retry_after": remaining,
            "blocked": True
        }), 429

    data  = request.json or {}
    phone = data.get("phone", PHONE).strip()
    pin   = data.get("pin",   PIN).strip()

    with _auth_lock:
        # Sessão já ativa e recente → não repetir SMS
        if _auth_state["active"] and _auth_state["started_at"]:
            age = (datetime.now() - _auth_state["started_at"]).total_seconds()
            if age < 480:
                remaining = int(480 - age)
                return jsonify({
                    "ok":          True,
                    "already_sent": True,
                    "countdown":   remaining,
                    "message":     f"SMS já enviado. Introduz o código. ({remaining}s restantes)"
                })

        otp_q    = queue_module.Queue()
        result_q = queue_module.Queue()

        _auth_state.update({
            "active":       True,
            "phone":        phone,
            "started_at":   datetime.now(),
            "otp_queue":    otp_q,
            "result_queue": result_q,
        })

    t = threading.Thread(
        target=_auth_thread,
        args=(phone, pin, otp_q, result_q),
        daemon=True
    )
    t.start()

    # Aguarda confirmação do initiate (máx 30s)
    try:
        kind, val = result_q.get(timeout=30)
    except queue_module.Empty:
        with _auth_lock:
            _auth_state["active"] = False
        return jsonify({"error": "Timeout ao iniciar sessão TR"}), 500

    if kind == "error":
        with _auth_lock:
            _auth_state["active"] = False
        m    = re.search(r"nextAttemptInSeconds.*?(\d+)", val)
        wait = int(m.group(1)) if m else None
        msg  = f"Demasiadas tentativas. Aguarda {wait}s antes de tentar novamente." if wait else val
        return jsonify({"error": msg, "retry_after": wait}), 429

    countdown = int(val) if isinstance(val, (int, float)) else 30
    return jsonify({
        "ok":       True,
        "countdown": countdown,
        "message":  f"SMS enviado. Tens {countdown}s para introduzir o código."
    })


@app.route("/login/confirm", methods=["POST"])
def login_confirm():
    data = request.json or {}
    code = str(data.get("code", "")).strip()

    with _auth_lock:
        if not _auth_state["active"] or _auth_state["otp_queue"] is None:
            return jsonify({"error": "Nenhuma sessão pendente. Chama /login/initiate primeiro."}), 400
        otp_q    = _auth_state["otp_queue"]
        result_q = _auth_state["result_queue"]

    otp_q.put(code)

    # Aguarda resultado (máx 30s)
    try:
        kind, val = result_q.get(timeout=30)
    except queue_module.Empty:
        return jsonify({"error": "Timeout ao confirmar código"}), 500

    if kind == "confirm_error":
        return jsonify({"error": val}), 400

    if kind == "done":
        global _session_expired
        _session_expired = False
        _cache.clear()
        _cache_time.clear()
        return jsonify({"ok": True, "message": "Trade Republic autenticado com sucesso!"})

    return jsonify({"error": f"Resposta inesperada: {kind}"}), 500


@app.route("/login/status")
def login_status():
    cookies = pathlib.Path(_cookies_path(PHONE))
    with _auth_lock:
        active     = _auth_state["active"]
        started_at = _auth_state["started_at"]
        age = int((datetime.now() - started_at).total_seconds()) if started_at else None
    return jsonify({
        "pending":       active,
        "pending_age_s": age,
        "session_ok":    cookies.exists(),
    })


# ─────────────────────────────────────────────────────────────
#  PORTFOLIO
# ─────────────────────────────────────────────────────────────

async def _fetch_all():
    from pytr.api import TradeRepublicApi
    cookies = pathlib.Path(_cookies_path(PHONE))

    api = TradeRepublicApi(
        phone_no=PHONE, pin=PIN,
        save_cookies=True, cookies_file=str(cookies)
    )
    if not api.resume_websession():
        global _session_expired
        _session_expired = True
        raise RuntimeError("Sessão expirada. Autentica via POST /login/initiate")

    # Sessão retomada com sucesso — garantir que flag está limpa
    _session_expired = False

    portfolio_data = await asyncio.wait_for(
        api._receive_one(api.compact_portfolio(), timeout=15), timeout=20
    )
    positions_raw = portfolio_data.get("positions", []) if isinstance(portfolio_data, dict) else []

    async def get_price(isin):
        try:
            ticker = await asyncio.wait_for(
                api._receive_one(
                    api.subscribe({"type": "ticker", "id": f"{isin}.LSX"}),
                    timeout=8
                ), timeout=12
            )
            return isin, float(ticker.get("last", {}).get("price", 0) or 0)
        except Exception:
            return isin, None

    async def get_name(isin):
        try:
            details = await asyncio.wait_for(
                api._receive_one(api.instrument_details(isin), timeout=8), timeout=12
            )
            for ex in details.get("exchanges", []):
                if ex.get("slug") in ("TDG", "LSX") and ex.get("nameAtExchange"):
                    return isin, ex.get("symbolAtExchange", isin), ex.get("nameAtExchange", isin)
            for ex in details.get("exchanges", []):
                if ex.get("nameAtExchange"):
                    return isin, ex.get("symbolAtExchange", isin), ex.get("nameAtExchange", isin)
            return isin, isin, isin
        except Exception:
            k = KNOWN_NAMES.get(isin, (isin, isin))
            return isin, k[0], k[1]

    isins = [p["instrumentId"] for p in positions_raw]
    price_results = await asyncio.gather(*[get_price(i) for i in isins])
    name_results  = await asyncio.gather(*[get_name(i)  for i in isins])

    prices = {isin: price for isin, price in price_results}
    names  = {isin: (t, n) for isin, t, n in name_results}

    cash = 0.0
    try:
        cash_data = await asyncio.wait_for(
            api._receive_one(api.cash(), timeout=8), timeout=12
        )
        if isinstance(cash_data, list):
            cash = sum(float(x.get("amount", 0) or 0) for x in cash_data)
        elif isinstance(cash_data, dict):
            cash = float(cash_data.get("amount", 0) or 0)
    except Exception as e:
        print(f"[TR] Cash erro (ignorado): {e}")

    return positions_raw, prices, names, cash


def _build_response(positions_raw, prices, names, cash):
    positions    = []
    total_value  = 0.0
    total_invest = 0.0

    for item in positions_raw:
        isin          = item.get("instrumentId", "")
        quantity      = float(item.get("netSize", 0) or 0)
        avg_price     = float(item.get("averageBuyIn", 0) or 0)
        current_price = prices.get(isin) or avg_price
        ticker_sym, name = names.get(isin, KNOWN_NAMES.get(isin, (isin, isin)))

        net_value = quantity * current_price
        buy_cost  = quantity * avg_price
        pnl       = net_value - buy_cost
        pnl_pct   = (pnl / buy_cost * 100) if buy_cost > 0 else 0.0

        positions.append({
            "ticker":        ticker_sym,
            "name":          name,
            "isin":          isin,
            "broker":        "tr",
            "quantity":      quantity,
            "avg_price":     round(avg_price, 4),
            "current_price": round(current_price, 4),
            "value":         round(net_value, 2),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round(pnl_pct, 2),
            "currency":      "EUR",
        })
        total_value  += net_value
        total_invest += buy_cost

    total   = total_value + cash
    pnl     = total_value - total_invest
    pnl_pct = (pnl / total_invest * 100) if total_invest > 0 else 0.0

    return {
        "status":       "live",
        "broker":       "tr",
        "name":         "Trade Republic",
        "color":        "#c7f24a",
        "total":        round(total, 2),
        "depot_value":  round(total_value, 2),
        "cash":         round(cash, 2),
        "pnl":          round(pnl, 2),
        "pnl_pct":      round(pnl_pct, 2),
        "positions":    positions,
        "last_updated": datetime.now().isoformat(),
    }


def _error_response(msg):
    return {
        "status": "error", "broker": "tr", "name": "Trade Republic",
        "color": "#c7f24a", "total": 0, "positions": [], "error": msg,
        "last_updated": datetime.now().isoformat(),
    }


@app.route("/health")
def health():
    cookies   = pathlib.Path(_cookies_path(PHONE))
    cached    = get_cached("portfolio")
    cache_age = int((datetime.now() - _cache_time["portfolio"]).total_seconds()) if "portfolio" in _cache_time else None
    return jsonify({
        "status":          "online",
        "phone":           PHONE[:4] + "****" if PHONE else "não configurado",
        "session_ok":      cookies.exists(),
        "session_expired": _session_expired,
        "cached":          cached is not None,
        "cache_age_s":     cache_age,
        "cache_ttl_s":     CACHE_TTL,
        "login_attempts":  len(_login_attempts),
    })


@app.route("/portfolio")
def portfolio():
    global _session_expired
    # Sempre verificar cache primeiro — serve dados antigos se sessão expirada
    cached = get_cached("portfolio")
    if _session_expired:
        if cached:
            print("[TR] Sessão expirada mas a servir cache")
            stale = dict(cached)
            stale["status"] = "stale"
            stale["auth_required"] = True
            return jsonify(stale)
        return jsonify(_error_response("Sessão expirada. Autentica via app iOS → Definições → Trade Republic.")), 401
    if cached:
        print("[TR] Cache hit")
        return jsonify(cached)
    print(f"[TR] A atualizar... {datetime.now().strftime('%H:%M:%S')}")
    try:
        positions_raw, prices, names, cash = asyncio.run(_fetch_all())
        data = _build_response(positions_raw, prices, names, cash)
        set_cached("portfolio", data)
        return jsonify(data)
    except Exception as e:
        print(f"[TR] Erro: {e}")
        # Se falhou mas temos cache, serve cache com aviso
        if cached:
            print("[TR] Erro mas a servir cache stale")
            stale = dict(cached)
            stale["status"] = "stale"
            stale["auth_required"] = True
            return jsonify(stale)
        return jsonify(_error_response(str(e))), 500


@app.route("/positions")
def positions():
    cached = get_cached("portfolio")
    return jsonify(cached.get("positions", []) if cached else [])


@app.route("/cache/clear")
def clear_cache():
    _cache.clear()
    _cache_time.clear()
    return jsonify({"ok": True})


@app.route("/session/reset", methods=["POST"])
def session_reset():
    """Limpa a flag de sessão expirada sem reautenticar.
    Útil quando o utilizador sabe que a sessão está válida mas a flag ficou activa."""
    global _session_expired, _login_attempts
    _session_expired = False
    _login_attempts  = []
    _cache.clear()
    _cache_time.clear()
    return jsonify({"ok": True, "message": "Flag de sessão limpa — o proxy vai tentar reconectar"})



async def _fetch_transactions():
    from pytr.api import TradeRepublicApi
    cookies = pathlib.Path(_cookies_path(PHONE))
    api = TradeRepublicApi(phone_no=PHONE, pin=PIN, save_cookies=True, cookies_file=str(cookies))
    if not api.resume_websession():
        global _session_expired
        _session_expired = True
        raise RuntimeError("Sessão expirada")
    data = await asyncio.wait_for(
        api._receive_one(api.timeline_transactions(), timeout=15), timeout=20
    )
    items = []
    for item in data.get("items", []):
        amt = item.get("amount", {}) or {}
        sub = item.get("subAmount") or {}
        items.append({
            "id":           item.get("id", ""),
            "timestamp":    item.get("timestamp", ""),
            "title":        item.get("title", ""),
            "amount":       str(amt.get("value", 0)),
            "currency":     amt.get("currency", "EUR"),
            "sub_amount":   str(sub.get("value", 0)) if sub else None,
            "sub_currency": sub.get("currency") if sub else None,
            "event_type":   item.get("eventType", ""),
            "status":       item.get("status", "EXECUTED"),
            "bank_name":    "Trade Republic",
            "account_id":   "tr_card",
        })
    return {"items": items, "cursor": data.get("cursors", {}).get("after")}


@app.route("/transactions")
def tr_transactions():
    global _session_expired
    cached_tx = get_cached("transactions")
    if _session_expired:
        if cached_tx:
            print("[TR] Sessão expirada mas a servir transações cache")
            return jsonify(cached_tx)
        return jsonify({"items": [], "auth_required": True}), 401
    if cached_tx:
        return jsonify(cached_tx)
    print(f"[TR] A buscar transações... {datetime.now().strftime('%H:%M:%S')}")
    try:
        result = asyncio.run(_fetch_transactions())
        set_cached("transactions", result)
        return jsonify(result)
    except Exception as e:
        print(f"[TR] Transações erro: {e}")
        if cached_tx:
            return jsonify(cached_tx)
        return jsonify({"items": [], "error": str(e)}), 500

if __name__ == "__main__":
    print(f"🟢 TR Proxy :3001 | {PHONE[:4]}**** | TTL={CACHE_TTL}s")
    app.run(host="0.0.0.0", port=3001, debug=False)


