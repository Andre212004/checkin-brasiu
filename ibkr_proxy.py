#!/usr/bin/env python3
# ibkr_proxy.py — Interactive Brokers Flex Query proxy — porta 3002

import xml.etree.ElementTree as ET
import sqlite3
import os
import time
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
import urllib.request

app = Flask(__name__)

CACHE_TTL = 300
FLEX_VERSION = '3'
SEND_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest'
GET_URL  = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement'

_cache      = {}
_cache_time = {}

def get_cached(key):
    if key in _cache and key in _cache_time:
        if datetime.now() - _cache_time[key] < timedelta(seconds=CACHE_TTL):
            return _cache[key]
    return None

def set_cached(key, data):
    _cache[key]      = data
    _cache_time[key] = datetime.now()

def get_config(key):
    try:
        db = os.path.join(os.path.expanduser('~'), 'checkin-server', 'database', 'checkins.db')
        conn = sqlite3.connect(db)
        cur  = conn.cursor()
        cur.execute('SELECT value FROM eb_config WHERE key = ?', (key,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None

def fetch_flex(flex_token=None, flex_query_id=None):
    # Credenciais vêm do pedido (enviadas pela app) — nunca da DB
    if not flex_token:
        flex_token    = get_config('ibkr_flex_token')
    if not flex_query_id:
        flex_query_id = get_config('ibkr_flex_query_id')

    if not flex_token or not flex_query_id:
        raise Exception('IBKR não configurado. Envia as credenciais via app iOS.')

    url = f'{SEND_URL}?t={flex_token}&q={flex_query_id}&v={FLEX_VERSION}'
    with urllib.request.urlopen(url, timeout=30) as resp:
        xml = resp.read().decode('utf-8')

    root   = ET.fromstring(xml)
    status = root.findtext('Status')
    if status != 'Success':
        raise Exception(f'Flex SendRequest falhou: {xml[:200]}')

    ref_code = root.findtext('ReferenceCode')

    for attempt in range(10):
        time.sleep(3)
        url2 = f'{GET_URL}?q={ref_code}&t={flex_token}&v={FLEX_VERSION}'
        with urllib.request.urlopen(url2, timeout=30) as resp2:
            xml2 = resp2.read().decode('utf-8')
        if '<FlexQueryResponse' in xml2:
            return xml2
        elif 'Statement generation in progress' in xml2 or 'Please try again' in xml2:
            continue
        else:
            raise Exception(f'Erro inesperado: {xml2[:200]}')

    raise Exception('Timeout a gerar relatório Flex')

def parse_flex(xml_str):
    root = ET.fromstring(xml_str)
    positions    = []
    total_value  = 0.0
    total_invest = 0.0
    cash         = 0.0

    for pos in root.iter('OpenPosition'):
        symbol        = pos.get('symbol', '')
        description   = pos.get('description', symbol)
        quantity      = float(pos.get('position', 0) or 0)
        avg_price     = float(pos.get('costBasisPrice', 0) or 0)
        current_price = float(pos.get('markPrice', 0) or 0)
        currency      = pos.get('currency', 'EUR')
        net_value     = float(pos.get('positionValue', 0) or quantity * current_price)
        buy_cost      = quantity * avg_price
        pnl           = float(pos.get('fifoPnlUnrealized', 0) or net_value - buy_cost)
        pnl_pct       = (pnl / buy_cost * 100) if buy_cost > 0 else 0.0

        positions.append({
            'ticker':        symbol,
            'name':          description,
            'isin':          pos.get('isin', symbol),
            'broker':        'ibkr',
            'quantity':      quantity,
            'avg_price':     round(avg_price, 4),
            'current_price': round(current_price, 4),
            'value':         round(net_value, 2),
            'pnl':           round(pnl, 2),
            'pnl_pct':       round(pnl_pct, 2),
            'currency':      currency,
        })
        total_value  += net_value
        total_invest += buy_cost

    for bal in root.iter('CashReport'):
        cash += float(bal.get('endingCash', 0) or 0)

    total   = total_value + cash
    pnl     = total_value - total_invest
    pnl_pct = (pnl / total_invest * 100) if total_invest > 0 else 0.0

    return {
        'status':       'live',
        'broker':       'ibkr',
        'name':         'Interactive Brokers',
        'color':        '#f0a500',
        'total':        round(total, 2),
        'depot_value':  round(total_value, 2),
        'cash':         round(cash, 2),
        'pnl':          round(pnl, 2),
        'pnl_pct':      round(pnl_pct, 2),
        'positions':    positions,
        'last_updated': datetime.now().isoformat(),
    }

def error_response(msg):
    return {
        'status': 'error', 'broker': 'ibkr', 'name': 'Interactive Brokers',
        'color': '#f0a500', 'total': 0, 'positions': [], 'error': msg,
        'last_updated': datetime.now().isoformat(),
    }

@app.route('/health')
def health():
    token     = get_config('ibkr_flex_token')
    cached    = get_cached('portfolio')
    cache_age = int((datetime.now() - _cache_time['portfolio']).total_seconds()) if 'portfolio' in _cache_time else None
    return jsonify({
        'status':      'online',
        'configured':  bool(token),
        'cached':      cached is not None,
        'cache_age':   cache_age,
    })

@app.route('/portfolio')
def portfolio():
    # Aceitar credenciais via query params (enviadas pelo portfolio.js)
    token    = request.args.get('token')    or None
    query_id = request.args.get('query_id') or None

    # Cache só se não vierem credenciais específicas
    if not token and not query_id:
        cached = get_cached('portfolio')
        if cached:
            print('[IBKR] Cache hit')
            return jsonify(cached)

    print(f'[IBKR] A atualizar... {datetime.now().strftime("%H:%M:%S")}')
    try:
        xml  = fetch_flex(token, query_id)
        data = parse_flex(xml)
        set_cached('portfolio', data)
        return jsonify(data)
    except Exception as e:
        print(f'[IBKR] Erro: {e}')
        return jsonify(error_response(str(e))), 500

@app.route('/cache/clear')
def clear_cache():
    _cache.clear(); _cache_time.clear()
    return jsonify({'ok': True})

if __name__ == '__main__':
    print(f'🟢 IBKR Proxy :3002 | DB lida da SQLite')
    app.run(host='0.0.0.0', port=3002, debug=False)
