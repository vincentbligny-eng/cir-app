import os
import shutil
import json
from datetime import date, datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, g

app = Flask(__name__, static_folder="static")

# --- Database configuration ---
# Set DATABASE_URL env var for PostgreSQL (production).
# Falls back to local SQLite for development.
DATABASE_URL = os.environ.get("DATABASE_URL")
DB_PATH = os.path.join(os.path.dirname(__file__), "cir_data.db")
BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")

LEGAL_HOURS_PER_DAY = 7.0
LEGAL_DAYS_PER_WEEK = 5
LEGAL_HOURS_PER_WEEK = LEGAL_HOURS_PER_DAY * LEGAL_DAYS_PER_WEEK  # 35h

# --- Database abstraction layer ---

if DATABASE_URL:
    import psycopg2
    import psycopg2.extras
    IntegrityError = psycopg2.IntegrityError

    def get_db():
        if "db" not in g:
            g.db = psycopg2.connect(DATABASE_URL)
        return g.db

    def db_execute(query, params=()):
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query.replace("?", "%s"), params)
        return cur

    def db_commit():
        get_db().commit()

    @app.teardown_appcontext
    def close_db(exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                time_unit TEXT NOT NULL DEFAULT 'hours'
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS time_entries (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                project_id INTEGER NOT NULL REFERENCES projects(id),
                week_start TEXT NOT NULL,
                monday REAL NOT NULL DEFAULT 0,
                tuesday REAL NOT NULL DEFAULT 0,
                wednesday REAL NOT NULL DEFAULT 0,
                thursday REAL NOT NULL DEFAULT 0,
                friday REAL NOT NULL DEFAULT 0,
                UNIQUE(user_id, project_id, week_start)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS custom_holidays (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL DEFAULT 'Congé'
            )
        """)
        conn.commit()
        conn.close()

    def auto_backup():
        pass  # PostgreSQL handles its own persistence

else:
    import sqlite3
    IntegrityError = sqlite3.IntegrityError

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA journal_mode=WAL")
            g.db.execute("PRAGMA foreign_keys=ON")
        return g.db

    def db_execute(query, params=()):
        return get_db().execute(query, params)

    def db_commit():
        get_db().commit()

    @app.teardown_appcontext
    def close_db(exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        db = sqlite3.connect(DB_PATH)
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                time_unit TEXT NOT NULL DEFAULT 'hours'
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS time_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                project_id INTEGER NOT NULL REFERENCES projects(id),
                week_start TEXT NOT NULL,
                monday REAL NOT NULL DEFAULT 0,
                tuesday REAL NOT NULL DEFAULT 0,
                wednesday REAL NOT NULL DEFAULT 0,
                thursday REAL NOT NULL DEFAULT 0,
                friday REAL NOT NULL DEFAULT 0,
                UNIQUE(user_id, project_id, week_start)
            );
            CREATE TABLE IF NOT EXISTS custom_holidays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL DEFAULT 'Congé'
            );
        """)
        db.commit()
        db.close()

    def auto_backup():
        if not os.path.exists(DB_PATH):
            return
        os.makedirs(BACKUP_DIR, exist_ok=True)
        today_str = date.today().isoformat()
        backup_path = os.path.join(BACKUP_DIR, f"cir_data_{today_str}.db")
        if not os.path.exists(backup_path):
            shutil.copy2(DB_PATH, backup_path)
        backups = sorted(
            [f for f in os.listdir(BACKUP_DIR) if f.startswith("cir_data_") and f.endswith(".db")]
        )
        for old in backups[:-30]:
            os.remove(os.path.join(BACKUP_DIR, old))


# French public holidays (fixed dates + computed Easter-based)
def get_french_holidays(year):
    holidays = {
        date(year, 1, 1),   # Jour de l'An
        date(year, 5, 1),   # Fête du Travail
        date(year, 5, 8),   # Victoire 1945
        date(year, 7, 14),  # Fête Nationale
        date(year, 8, 15),  # Assomption
        date(year, 11, 1),  # Toussaint
        date(year, 11, 11), # Armistice
        date(year, 12, 25), # Noël
    }
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    gg = (b - f + 1) // 3
    h = (19 * a + b - d - gg + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    easter = date(year, month, day)
    holidays.add(easter + timedelta(days=1))   # Lundi de Pâques
    holidays.add(easter + timedelta(days=39))  # Ascension
    holidays.add(easter + timedelta(days=50))  # Lundi de Pentecôte
    return holidays


def monday_of_week(d=None):
    if d is None:
        d = date.today()
    return d - timedelta(days=d.weekday())


def get_holidays_for_week(week_start_str):
    ws = date.fromisoformat(week_start_str)
    year = ws.year
    french = get_french_holidays(year)
    custom_rows = db_execute("SELECT date, label FROM custom_holidays").fetchall()
    custom = {date.fromisoformat(r["date"]): r["label"] for r in custom_rows}
    day_names = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    result = {}
    for i, name in enumerate(day_names):
        d = ws + timedelta(days=i)
        if d in french:
            result[name] = "Jour férié"
        elif d in custom:
            result[name] = custom[d]
    return result


# --- API Routes ---

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/users", methods=["GET"])
def list_users():
    rows = db_execute("SELECT * FROM users ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users", methods=["POST"])
def create_user():
    data = request.json
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    try:
        db_execute("INSERT INTO users (name) VALUES (?)", (name,))
        db_commit()
    except IntegrityError:
        get_db().rollback()
        return jsonify({"error": "User already exists"}), 409
    return jsonify({"ok": True}), 201


@app.route("/api/users/<int:uid>", methods=["DELETE"])
def delete_user(uid):
    db_execute("DELETE FROM time_entries WHERE user_id=?", (uid,))
    db_execute("DELETE FROM users WHERE id=?", (uid,))
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/users/<int:uid>/time_unit", methods=["PUT"])
def set_time_unit(uid):
    unit = request.json.get("time_unit", "hours")
    if unit not in ("hours", "days"):
        return jsonify({"error": "Invalid unit"}), 400
    db_execute("UPDATE users SET time_unit=? WHERE id=?", (unit, uid))
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/projects", methods=["GET"])
def list_projects():
    rows = db_execute("SELECT * FROM projects ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.json
    name = data.get("name", "").strip()
    desc = data.get("description", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    try:
        db_execute("INSERT INTO projects (name, description) VALUES (?, ?)", (name, desc))
        db_commit()
    except IntegrityError:
        get_db().rollback()
        return jsonify({"error": "Project already exists"}), 409
    return jsonify({"ok": True}), 201


@app.route("/api/projects/<int:pid>", methods=["PUT"])
def update_project(pid):
    data = request.json
    db_execute("UPDATE projects SET name=?, description=?, active=? WHERE id=?",
               (data["name"], data.get("description", ""), int(data.get("active", 1)), pid))
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/projects/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    db_execute("DELETE FROM time_entries WHERE project_id=?", (pid,))
    db_execute("DELETE FROM projects WHERE id=?", (pid,))
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/holidays", methods=["GET"])
def list_holidays():
    rows = db_execute("SELECT * FROM custom_holidays ORDER BY date").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/holidays", methods=["POST"])
def add_holiday():
    data = request.json
    try:
        db_execute("INSERT INTO custom_holidays (date, label) VALUES (?, ?)",
                   (data["date"], data.get("label", "Congé")))
        db_commit()
    except IntegrityError:
        get_db().rollback()
        return jsonify({"error": "Holiday already exists for this date"}), 409
    return jsonify({"ok": True}), 201


@app.route("/api/holidays/<int:hid>", methods=["DELETE"])
def delete_holiday(hid):
    db_execute("DELETE FROM custom_holidays WHERE id=?", (hid,))
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/entries", methods=["GET"])
def get_entries():
    user_id = request.args.get("user_id", type=int)
    week_start = request.args.get("week_start")
    if not user_id or not week_start:
        return jsonify({"error": "user_id and week_start required"}), 400

    user = db_execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404

    entries = db_execute(
        "SELECT te.*, p.name as project_name FROM time_entries te "
        "JOIN projects p ON te.project_id = p.id "
        "WHERE te.user_id=? AND te.week_start=?",
        (user_id, week_start)
    ).fetchall()

    holidays = get_holidays_for_week(week_start)

    return jsonify({
        "user": dict(user),
        "entries": [dict(e) for e in entries],
        "holidays": holidays,
        "legal_hours_per_week": LEGAL_HOURS_PER_WEEK,
        "legal_hours_per_day": LEGAL_HOURS_PER_DAY,
    })


@app.route("/api/monthly_entries", methods=["GET"])
def get_monthly_entries():
    user_id = request.args.get("user_id", type=int)
    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    if not user_id or not year or not month:
        return jsonify({"error": "user_id, year, month required"}), 400

    user = db_execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404

    first_day = date(year, month, 1)
    if month == 12:
        last_day = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = date(year, month + 1, 1) - timedelta(days=1)

    first_monday = first_day - timedelta(days=first_day.weekday())
    last_monday = last_day - timedelta(days=last_day.weekday())

    weeks = []
    d = first_monday
    while d <= last_monday:
        ws = d.isoformat()
        entries = db_execute(
            "SELECT te.*, p.name as project_name FROM time_entries te "
            "JOIN projects p ON te.project_id = p.id "
            "WHERE te.user_id=? AND te.week_start=?",
            (user_id, ws)
        ).fetchall()
        holidays = get_holidays_for_week(ws)
        weeks.append({
            "week_start": ws,
            "entries": [dict(e) for e in entries],
            "holidays": holidays,
        })
        d += timedelta(days=7)

    return jsonify({
        "user": dict(user),
        "weeks": weeks,
        "year": year,
        "month": month,
    })


@app.route("/api/entries", methods=["POST"])
def save_entries():
    data = request.json
    user_id = data["user_id"]
    week_start = data["week_start"]
    entries = data["entries"]

    db_execute("DELETE FROM time_entries WHERE user_id=? AND week_start=?",
               (user_id, week_start))
    for e in entries:
        db_execute(
            "INSERT INTO time_entries (user_id, project_id, week_start, monday, tuesday, wednesday, thursday, friday) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, e["project_id"], week_start,
             float(e.get("monday", 0)), float(e.get("tuesday", 0)),
             float(e.get("wednesday", 0)), float(e.get("thursday", 0)),
             float(e.get("friday", 0)))
        )
    db_commit()
    return jsonify({"ok": True})


@app.route("/api/summary", methods=["GET"])
def summary():
    week_start = request.args.get("week_start", monday_of_week().isoformat())
    holidays = get_holidays_for_week(week_start)
    num_holiday_days = len(holidays)
    expected_hours = LEGAL_HOURS_PER_WEEK - num_holiday_days * LEGAL_HOURS_PER_DAY

    users = db_execute("SELECT * FROM users ORDER BY name").fetchall()
    result = []
    for u in users:
        entries = db_execute(
            "SELECT te.*, p.name as project_name FROM time_entries te "
            "JOIN projects p ON te.project_id = p.id "
            "WHERE te.user_id=? AND te.week_start=?",
            (u["id"], week_start)
        ).fetchall()
        total = sum(e["monday"] + e["tuesday"] + e["wednesday"] + e["thursday"] + e["friday"]
                     for e in entries)
        result.append({
            "user": dict(u),
            "total_hours": total,
            "expected_hours": expected_hours,
            "complete": abs(total - expected_hours) < 0.01,
            "entries": [dict(e) for e in entries],
        })
    return jsonify({"week_start": week_start, "holidays": holidays, "users": result})


@app.route("/api/yearly", methods=["GET"])
def yearly():
    user_id = request.args.get("user_id", type=int)
    year = request.args.get("year", type=int)
    if not user_id or not year:
        return jsonify({"error": "user_id, year required"}), 400

    first_day = date(year, 1, 1)
    last_day = date(year, 12, 31)
    first_monday = first_day - timedelta(days=first_day.weekday())
    last_monday = last_day - timedelta(days=last_day.weekday())

    entries = db_execute(
        "SELECT te.*, p.name as project_name FROM time_entries te "
        "JOIN projects p ON te.project_id = p.id "
        "WHERE te.user_id=? AND te.week_start >= ? AND te.week_start <= ?",
        (user_id, first_monday.isoformat(), last_monday.isoformat())
    ).fetchall()

    day_names = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    days_data = {}
    for e in entries:
        ws = date.fromisoformat(e["week_start"])
        for i, dn in enumerate(day_names):
            d = ws + timedelta(days=i)
            if d.year != year:
                continue
            ds = d.isoformat()
            if ds not in days_data:
                days_data[ds] = []
            hours = e[dn]
            if hours > 0:
                days_data[ds].append({
                    "project_name": e["project_name"],
                    "project_id": e["project_id"],
                    "hours": hours,
                })

    french = get_french_holidays(year)
    custom_rows = db_execute("SELECT date, label FROM custom_holidays").fetchall()
    custom = {r["date"]: r["label"] for r in custom_rows}

    holidays = {}
    d = first_day
    while d <= last_day:
        if d in french:
            holidays[d.isoformat()] = "Jour férié"
        elif d.isoformat() in custom:
            holidays[d.isoformat()] = custom[d.isoformat()]
        d += timedelta(days=1)

    months = []
    for m in range(1, 13):
        md = date(year, m, 1)
        if m == 12:
            mld = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            mld = date(year, m + 1, 1) - timedelta(days=1)
        months.append({
            "month": m,
            "first_weekday": md.weekday(),
            "num_days": (mld - md).days + 1,
        })

    return jsonify({
        "year": year,
        "days": days_data,
        "holidays": holidays,
        "months": months,
    })


@app.route("/api/unfilled_weeks", methods=["GET"])
def unfilled_weeks():
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    year = 2026
    d = date(year, 1, 5)
    end = min(date.today(), date(year, 12, 31))
    end_monday = end - timedelta(days=end.weekday())

    filled_rows = db_execute(
        "SELECT week_start, SUM(monday+tuesday+wednesday+thursday+friday) as total "
        "FROM time_entries WHERE user_id=? AND week_start >= ? AND week_start <= ? "
        "GROUP BY week_start",
        (user_id, d.isoformat(), end_monday.isoformat())
    ).fetchall()
    filled = {r["week_start"]: r["total"] for r in filled_rows}

    unfilled = []
    current = d
    while current <= end_monday:
        ws = current.isoformat()
        holidays = get_holidays_for_week(ws)
        num_holiday_days = len(holidays)
        expected = LEGAL_HOURS_PER_WEEK - num_holiday_days * LEGAL_HOURS_PER_DAY
        total = filled.get(ws, 0)
        if expected > 0 and abs(total - expected) > 0.01:
            unfilled.append(ws)
        current += timedelta(days=7)

    return jsonify({"unfilled": unfilled})


@app.route("/api/year_summary", methods=["GET"])
def year_summary():
    year = request.args.get("year", type=int, default=2026)
    users = db_execute("SELECT * FROM users ORDER BY name").fetchall()

    first_monday = date(year, 1, 1)
    if first_monday.weekday() != 0:
        first_monday += timedelta(days=(7 - first_monday.weekday()))
    end = min(date.today(), date(year, 12, 31))
    end_monday = end - timedelta(days=end.weekday())

    weeks = []
    d = first_monday
    while d <= end_monday:
        weeks.append(d.isoformat())
        d += timedelta(days=7)

    week_expected = {}
    for ws in weeks:
        holidays = get_holidays_for_week(ws)
        num_hol = len(holidays)
        week_expected[ws] = LEGAL_HOURS_PER_WEEK - num_hol * LEGAL_HOURS_PER_DAY

    all_entries = db_execute(
        "SELECT user_id, week_start, SUM(monday+tuesday+wednesday+thursday+friday) as total "
        "FROM time_entries WHERE week_start >= ? AND week_start <= ? "
        "GROUP BY user_id, week_start",
        (first_monday.isoformat(), end_monday.isoformat())
    ).fetchall()

    user_totals = {}
    for e in all_entries:
        uid = e["user_id"]
        if uid not in user_totals:
            user_totals[uid] = {}
        user_totals[uid][e["week_start"]] = e["total"]

    result = []
    for u in users:
        uid = u["id"]
        ut = user_totals.get(uid, {})
        user_weeks = {}
        complete_count = 0
        for ws in weeks:
            expected = week_expected[ws]
            total = ut.get(ws, 0)
            is_complete = expected <= 0 or abs(total - expected) < 0.01
            if is_complete:
                complete_count += 1
            user_weeks[ws] = {
                "total": total,
                "expected": expected,
                "complete": is_complete,
            }
        result.append({
            "user": dict(u),
            "weeks": user_weeks,
            "complete_count": complete_count,
            "total_weeks": len(weeks),
        })

    return jsonify({
        "year": year,
        "weeks": weeks,
        "users": result,
    })


@app.route("/api/export", methods=["GET"])
def export_data():
    users = [dict(r) for r in db_execute("SELECT * FROM users").fetchall()]
    projects = [dict(r) for r in db_execute("SELECT * FROM projects").fetchall()]
    entries = [dict(r) for r in db_execute("SELECT * FROM time_entries").fetchall()]
    holidays = [dict(r) for r in db_execute("SELECT * FROM custom_holidays").fetchall()]
    return jsonify({
        "exported_at": datetime.now().isoformat(),
        "users": users,
        "projects": projects,
        "time_entries": entries,
        "custom_holidays": holidays,
    })


@app.route("/api/import", methods=["POST"])
def import_data():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    db_execute("DELETE FROM time_entries")
    db_execute("DELETE FROM custom_holidays")
    db_execute("DELETE FROM projects")
    db_execute("DELETE FROM users")

    for u in data.get("users", []):
        db_execute("INSERT INTO users (id, name, time_unit) VALUES (?, ?, ?)",
                   (u["id"], u["name"], u.get("time_unit", "hours")))

    for p in data.get("projects", []):
        db_execute("INSERT INTO projects (id, name, description, active) VALUES (?, ?, ?, ?)",
                   (p["id"], p["name"], p.get("description", ""), p.get("active", 1)))

    for e in data.get("time_entries", []):
        db_execute(
            "INSERT INTO time_entries (id, user_id, project_id, week_start, monday, tuesday, wednesday, thursday, friday) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (e["id"], e["user_id"], e["project_id"], e["week_start"],
             e.get("monday", 0), e.get("tuesday", 0), e.get("wednesday", 0),
             e.get("thursday", 0), e.get("friday", 0)))

    for h in data.get("custom_holidays", []):
        db_execute("INSERT INTO custom_holidays (id, date, label) VALUES (?, ?, ?)",
                   (h["id"], h["date"], h.get("label", "Congé")))

    db_commit()

    # Reset PostgreSQL sequences
    if DATABASE_URL:
        for table in ["users", "projects", "time_entries", "custom_holidays"]:
            db_execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
            )
        db_commit()

    return jsonify({"ok": True, "imported": {
        "users": len(data.get("users", [])),
        "projects": len(data.get("projects", [])),
        "time_entries": len(data.get("time_entries", [])),
        "custom_holidays": len(data.get("custom_holidays", [])),
    }})


if __name__ == "__main__":
    init_db()
    auto_backup()
    app.run(host="0.0.0.0", port=8080, debug=True)
