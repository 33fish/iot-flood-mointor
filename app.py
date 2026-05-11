"""
Smart Flood Sentinel - Backend Server
CITS5506 Group 30

REST API endpoints:
  POST /api/telemetry       - ESP32 sends sensor data
  GET  /api/status          - Current system state
  GET  /api/history         - Historical readings (last N records)
  GET  /api/alerts          - Alert event log
  GET  /api/stats           - Summary statistics
  POST /api/reset           - Reset state (testing only)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os
import time
from datetime import datetime, timezone

app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)  # Allow dashboard (different port) to call API

DB_PATH = os.path.join(os.path.dirname(__file__), "flood_sentinel.db")

# ── Thresholds (mirror these in ESP32 firmware) ──────────────────────────────
ULTRASONIC_WARNING_CM  = 5.0   # water level > 5 cm  → WARNING
ULTRASONIC_CRITICAL_CM = 10.0  # water level > 10 cm → CRITICAL

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS telemetry (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            TEXT    NOT NULL,          -- ISO-8601 UTC
            unix_ts       REAL    NOT NULL,
            leak_detected INTEGER NOT NULL,          -- 0 or 1
            water_level   REAL    NOT NULL,          -- cm, -1 = sensor absent
            state         TEXT    NOT NULL,          -- SAFE / WARNING / CRITICAL
            led_on        INTEGER NOT NULL,
            buzzer_on     INTEGER NOT NULL,
            node_id       TEXT    DEFAULT 'node-01'
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        TEXT    NOT NULL,
            unix_ts   REAL    NOT NULL,
            state     TEXT    NOT NULL,
            trigger   TEXT    NOT NULL,   -- 'leak_sensor' / 'ultrasonic' / 'both'
            resolved  INTEGER DEFAULT 0,
            node_id   TEXT    DEFAULT 'node-01'
        );

        CREATE TABLE IF NOT EXISTS system_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)
    # Initialise current state if missing
    conn.execute("""
        INSERT OR IGNORE INTO system_state (key, value)
        VALUES ('current_state', 'SAFE')
    """)
    conn.commit()
    conn.close()

def classify_state(leak_detected: bool, water_level_cm: float) -> tuple[str, str]:
    """
    Returns (state, trigger).
    Mirrors the logic in ESP32 firmware (Figure 4 in proposal).
    """
    if leak_detected and water_level_cm >= ULTRASONIC_CRITICAL_CM:
        return "CRITICAL", "both"
    if water_level_cm >= ULTRASONIC_CRITICAL_CM:
        return "CRITICAL", "ultrasonic"
    if leak_detected:
        return "WARNING", "leak_sensor"
    if water_level_cm >= ULTRASONIC_WARNING_CM:
        return "WARNING", "ultrasonic"
    return "SAFE", "none"

@app.route("/", methods=["GET"])
def index():
    return app.send_static_file("Dashboard.html")
# ── POST /api/telemetry ───────────────────────────────────────────────────────
@app.route("/api/telemetry", methods=["POST"])
def receive_telemetry():
    """
    Expected JSON body from ESP32:
    {
        "leak_detected": 0 | 1,
        "water_level_cm": 3.2,
        "node_id": "node-01"          (optional)
    }
    """
    data = request.get_json(force=True, silent=True)
    if data is None:
        return jsonify({"error": "Invalid JSON"}), 400

    leak_detected = int(bool(data.get("leak_detected", 0)))
    water_level   = float(data.get("water_level_cm", -1))
    node_id       = data.get("node_id", "node-01")

    state, trigger = classify_state(bool(leak_detected), water_level)
    led_on    = 1 if state != "SAFE" else 0
    buzzer_on = 1 if state == "CRITICAL" else 0

    now_utc  = datetime.now(timezone.utc)
    ts_str   = now_utc.isoformat()
    unix_ts  = now_utc.timestamp()

    conn = get_db()

    # Store telemetry record
    conn.execute("""
        INSERT INTO telemetry
            (ts, unix_ts, leak_detected, water_level, state, led_on, buzzer_on, node_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (ts_str, unix_ts, leak_detected, water_level, state, led_on, buzzer_on, node_id))

    # Log an alert if state is not SAFE
    if state != "SAFE":
        # Only log if state changed or trigger is new
        prev = conn.execute(
            "SELECT state FROM system_state WHERE key='current_state'"
        ).fetchone()
        prev_state = prev["value"] if prev else "SAFE"
        if state != prev_state:
            conn.execute("""
                INSERT INTO alerts (ts, unix_ts, state, trigger, node_id)
                VALUES (?, ?, ?, ?, ?)
            """, (ts_str, unix_ts, state, trigger, node_id))
    else:
        # Mark all open alerts as resolved
        conn.execute("""
            UPDATE alerts SET resolved = 1
            WHERE resolved = 0 AND node_id = ?
        """, (node_id,))

    # Update current state
    conn.execute("""
        INSERT OR REPLACE INTO system_state (key, value)
        VALUES ('current_state', ?)
    """, (state,))

    conn.commit()
    conn.close()

    return jsonify({
        "status": "ok",
        "state": state,
        "led_on": led_on,
        "buzzer_on": buzzer_on,
        "ts": ts_str
    }), 200


# ── GET /api/status ───────────────────────────────────────────────────────────
@app.route("/api/status", methods=["GET"])
def get_status():
    conn = get_db()
    latest = conn.execute("""
        SELECT * FROM telemetry ORDER BY unix_ts DESC LIMIT 1
    """).fetchone()
    current_state = conn.execute(
        "SELECT value FROM system_state WHERE key='current_state'"
    ).fetchone()
    conn.close()

    if not latest:
        return jsonify({
            "state": "NO_DATA",
            "message": "No telemetry received yet"
        }), 200

    return jsonify({
        "state": dict(current_state)["value"] if current_state else "SAFE",
        "latest": {
            "ts": latest["ts"],
            "leak_detected": bool(latest["leak_detected"]),
            "water_level_cm": latest["water_level"],
            "led_on": bool(latest["led_on"]),
            "buzzer_on": bool(latest["buzzer_on"]),
            "node_id": latest["node_id"]
        }
    })


# ── GET /api/history?n=100&node_id=node-01 ───────────────────────────────────
@app.route("/api/history", methods=["GET"])
def get_history():
    n       = min(int(request.args.get("n", 100)), 500)
    node_id = request.args.get("node_id", None)

    conn = get_db()
    if node_id:
        rows = conn.execute("""
            SELECT ts, unix_ts, leak_detected, water_level, state, led_on, buzzer_on, node_id
            FROM telemetry WHERE node_id = ?
            ORDER BY unix_ts DESC LIMIT ?
        """, (node_id, n)).fetchall()
    else:
        rows = conn.execute("""
            SELECT ts, unix_ts, leak_detected, water_level, state, led_on, buzzer_on, node_id
            FROM telemetry ORDER BY unix_ts DESC LIMIT ?
        """, (n,)).fetchall()
    conn.close()

    return jsonify([dict(r) for r in rows])


# ── GET /api/alerts?resolved=0 ────────────────────────────────────────────────
@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    resolved = request.args.get("resolved", None)
    conn = get_db()
    if resolved is not None:
        rows = conn.execute("""
            SELECT * FROM alerts WHERE resolved = ?
            ORDER BY unix_ts DESC LIMIT 50
        """, (int(resolved),)).fetchall()
    else:
        rows = conn.execute("""
            SELECT * FROM alerts ORDER BY unix_ts DESC LIMIT 50
        """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/stats ────────────────────────────────────────────────────────────
@app.route("/api/stats", methods=["GET"])
def get_stats():
    conn = get_db()
    total      = conn.execute("SELECT COUNT(*) as c FROM telemetry").fetchone()["c"]
    safe_c     = conn.execute("SELECT COUNT(*) as c FROM telemetry WHERE state='SAFE'").fetchone()["c"]
    warn_c     = conn.execute("SELECT COUNT(*) as c FROM telemetry WHERE state='WARNING'").fetchone()["c"]
    crit_c     = conn.execute("SELECT COUNT(*) as c FROM telemetry WHERE state='CRITICAL'").fetchone()["c"]
    total_alerts = conn.execute("SELECT COUNT(*) as c FROM alerts").fetchone()["c"]
    open_alerts  = conn.execute("SELECT COUNT(*) as c FROM alerts WHERE resolved=0").fetchone()["c"]
    avg_level  = conn.execute(
        "SELECT AVG(water_level) as a FROM telemetry WHERE water_level >= 0"
    ).fetchone()["a"]
    conn.close()

    return jsonify({
        "total_readings": total,
        "state_counts": {"SAFE": safe_c, "WARNING": warn_c, "CRITICAL": crit_c},
        "total_alerts": total_alerts,
        "open_alerts": open_alerts,
        "avg_water_level_cm": round(avg_level, 2) if avg_level else 0
    })


# ── POST /api/reset ───────────────────────────────────────────────────────────
@app.route("/api/reset", methods=["POST"])
def reset():
    """Clear all data – testing use only."""
    conn = get_db()
    conn.executescript("""
        DELETE FROM telemetry;
        DELETE FROM alerts;
        UPDATE system_state SET value='SAFE' WHERE key='current_state';
    """)
    conn.commit()
    conn.close()
    return jsonify({"status": "reset complete"})


if __name__ == "__main__":
    init_db()
    print("=" * 50)
    print(" Smart Flood Sentinel Backend")
    print(" http://localhost:5000")
    print("=" * 50)
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
