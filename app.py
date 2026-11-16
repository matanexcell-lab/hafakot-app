import json
import os
import sqlite3

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(BASE_DIR, "static"), static_url_path="/static")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
EDIT_PASSWORD = os.environ.get("EDIT_PASSWORD", "")
SQLITE_PATH = os.environ.get("SQLITE_PATH", os.path.join(BASE_DIR, "data.db"))

OPS_KEYS = [
    "beforeTemplate", "afterTemplate",
    "kubiotYesBefore", "kubiotNoBefore", "kubiotYesAfter", "kubiotNoAfter",
]
CONFIG_KEY = "main"


# ---------- storage ----------
def _pg_conn():
    import psycopg2
    return psycopg2.connect(DATABASE_URL)


def init_db():
    if DATABASE_URL:
        conn = _pg_conn()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "CREATE TABLE IF NOT EXISTS summary_config "
                    "(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        try:
            with conn:
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS summary_config "
                    "(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
                )
        finally:
            conn.close()


def load_config():
    empty = {"customTracks": [], "opsConfig": None}
    raw = None
    if DATABASE_URL:
        conn = _pg_conn()
        try:
            with conn, conn.cursor() as cur:
                cur.execute("SELECT value FROM summary_config WHERE key = %s", (CONFIG_KEY,))
                row = cur.fetchone()
                raw = row[0] if row else None
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        try:
            row = conn.execute("SELECT value FROM summary_config WHERE key = ?", (CONFIG_KEY,)).fetchone()
            raw = row[0] if row else None
        finally:
            conn.close()
    if not raw:
        return empty
    try:
        data = json.loads(raw)
    except ValueError:
        return empty
    return {
        "customTracks": data.get("customTracks") or [],
        "opsConfig": data.get("opsConfig"),
    }


def save_config(cfg):
    raw = json.dumps(cfg, ensure_ascii=False)
    if DATABASE_URL:
        conn = _pg_conn()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO summary_config (key, value) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                    (CONFIG_KEY, raw),
                )
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        try:
            with conn:
                conn.execute(
                    "INSERT INTO summary_config (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (CONFIG_KEY, raw),
                )
        finally:
            conn.close()



# ---------- pending clients (ממתינים לחתימה) ----------
PENDING_PREFIX = "pending:"


def _kv_exec(pg_sql, sqlite_sql, params, fetch=False):
    if DATABASE_URL:
        conn = _pg_conn()
        try:
            with conn, conn.cursor() as cur:
                cur.execute(pg_sql, params)
                return cur.fetchall() if fetch else None
        finally:
            conn.close()
    conn = sqlite3.connect(SQLITE_PATH)
    try:
        with conn:
            cur = conn.execute(sqlite_sql, params)
            return cur.fetchall() if fetch else None
    finally:
        conn.close()


def pending_list():
    rows = _kv_exec(
        "SELECT value FROM summary_config WHERE key LIKE %s",
        "SELECT value FROM summary_config WHERE key LIKE ?",
        (PENDING_PREFIX + "%",), fetch=True,
    ) or []
    out = []
    for (raw,) in rows:
        try:
            out.append(json.loads(raw))
        except ValueError:
            pass
    out.sort(key=lambda x: str(x.get("id", "")), reverse=True)
    return out


def pending_set(item):
    raw = json.dumps(item, ensure_ascii=False)
    _kv_exec(
        "INSERT INTO summary_config (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        "INSERT INTO summary_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (PENDING_PREFIX + item["id"], raw),
    )


def pending_delete(pid):
    _kv_exec(
        "DELETE FROM summary_config WHERE key = %s",
        "DELETE FROM summary_config WHERE key = ?",
        (PENDING_PREFIX + pid,),
    )


def _authorized():
    return not EDIT_PASSWORD or request.headers.get("X-Edit-Password", "") == EDIT_PASSWORD


# ---------- validation ----------
def clean_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("bad payload")

    tracks_in = payload.get("customTracks", [])
    if not isinstance(tracks_in, list) or len(tracks_in) > 300:
        raise ValueError("bad customTracks")
    tracks, seen = [], set()
    for t in tracks_in:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name", "")).strip()[:120]
        output = str(t.get("output", "") or "").strip()[:600]
        if name and name not in seen:
            seen.add(name)
            tracks.append({"name": name, "output": output})

    ops_in = payload.get("opsConfig")
    ops = None
    if isinstance(ops_in, dict):
        ops = {}
        for k in OPS_KEYS:
            v = ops_in.get(k)
            if isinstance(v, str):
                ops[k] = v[:4000]
    return {"customTracks": tracks, "opsConfig": ops}


# ---------- routes ----------
@app.route("/")
def index():
    resp = send_from_directory(app.static_folder, "index.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/config", methods=["GET"])
def get_config():
    resp = jsonify(load_config())
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/config", methods=["PUT"])
def put_config():
    if EDIT_PASSWORD and request.headers.get("X-Edit-Password", "") != EDIT_PASSWORD:
        return jsonify({"error": "unauthorized"}), 401
    try:
        cfg = clean_payload(request.get_json(force=True, silent=True))
    except ValueError:
        return jsonify({"error": "bad request"}), 400
    save_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/pending", methods=["GET"])
def get_pending():
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401
    resp = jsonify({"items": pending_list()})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/pending", methods=["POST"])
def post_pending():
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401
    p = request.get_json(force=True, silent=True)
    if not isinstance(p, dict):
        return jsonify({"error": "bad request"}), 400
    pid = str(p.get("id", "")).strip()[:40]
    name = str(p.get("name", "")).strip()[:120]
    if not pid or not name or not pid.replace("-", "").isalnum():
        return jsonify({"error": "bad request"}), 400
    # שם לקוח ייחודי: שמירה חוזרת באותו שם מחליפה את הקודמת
    for old in pending_list():
        if old.get("name") == name and old.get("id") != pid:
            pending_delete(str(old.get("id")))
    pending_set({
        "id": pid, "name": name,
        "beforeText": str(p.get("beforeText", ""))[:20000],
        "afterText": str(p.get("afterText", ""))[:20000],
        "date": str(p.get("date", ""))[:20],
    })
    return jsonify({"ok": True})


@app.route("/api/pending/<pid>", methods=["DELETE"])
def delete_pending(pid):
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401
    pending_delete(pid[:40])
    return jsonify({"ok": True})


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True, "storage": "postgres" if DATABASE_URL else "sqlite-file (not permanent on Render)"})


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
