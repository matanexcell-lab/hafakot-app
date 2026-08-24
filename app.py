import os
import json
from functools import wraps
from urllib.parse import quote

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import AuthorizedSession

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID")
SITE_PASSWORD = os.environ.get("SITE_PASSWORD")

SHEET_NAMES = {
    "pension": "פנסיוני",
    "detail": "פרט",
}

ID_COLUMN_INDEX = 1  # column B, zero-based

# Header names used for smart behaviors (status auto-log, transfer flow, previews)
H_CLIENT_NAME = "שם לקוח"
H_COMPANY = "חברה"
H_TRANSFER_COMPANY = "חברה מעבירה"
H_PRODUCT = "סוג ההצעה / מוצר"
H_STATUS = "סטטוס הפקה"
H_TRANSFER_ACTUAL = "ניוד בפועל"
H_LAST_UPDATE = "תאריך עדכון אחרון"


# ---------- Google Sheets helpers ----------

SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

_http = None


def get_http():
    global _http
    if _http is not None:
        return _http
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not creds_json:
        raise RuntimeError("Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable")
    creds_dict = json.loads(creds_json)
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    _http = AuthorizedSession(creds)
    return _http


def _api_get(params):
    http = get_http()
    resp = http.get(f"{SHEETS_API_BASE}/{SPREADSHEET_ID}", params=params)
    if not resp.ok:
        raise RuntimeError(f"שגיאה מגוגל שיטס: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def _api_put_values(range_, values):
    http = get_http()
    url = f"{SHEETS_API_BASE}/{SPREADSHEET_ID}/values/{quote(range_, safe='')}"
    resp = http.put(
        url,
        params={"valueInputOption": "USER_ENTERED"},
        json={"values": [values]},
    )
    if not resp.ok:
        raise RuntimeError(f"שגיאה בשמירה לגוגל שיטס: {resp.status_code} {resp.text[:300]}")


def _api_batch_update(requests_body):
    http = get_http()
    resp = http.post(f"{SHEETS_API_BASE}/{SPREADSHEET_ID}:batchUpdate", json={"requests": requests_body})
    if not resp.ok:
        raise RuntimeError(f"שגיאה בעדכון פורמט בגוגל שיטס: {resp.status_code} {resp.text[:300]}")


def col_letter(n):
    """1-indexed column count -> spreadsheet column letter (e.g. 28 -> AB)."""
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


GREEN_RGB = {"red": 0.573, "green": 0.816, "blue": 0.314}
RED_RGB = {"red": 0.957, "green": 0.263, "blue": 0.212}


def _close_to(color, target, tol=0.03):
    if not color:
        return False
    return (
        abs(color.get("red", 1) - target["red"]) <= tol
        and abs(color.get("green", 1) - target["green"]) <= tol
        and abs(color.get("blue", 1) - target["blue"]) <= tol
    )


def is_green(color):
    """Is this exactly the green we use for 'reported' rows?"""
    return _close_to(color, GREEN_RGB)


def is_red(color):
    """Is this exactly the red we use for 'not relevant' rows?"""
    return _close_to(color, RED_RGB)


def resolve_sheet(sheet_type):
    """Ask Google for the exact tab titles + sheetId and match against our configured name.
    Returns {"title": ..., "sheetId": ...}. Avoids mismatches from hidden characters."""
    target = SHEET_NAMES[sheet_type]
    data = _api_get({"fields": "sheets.properties(title,sheetId)"})
    props = [s["properties"] for s in data.get("sheets", [])]
    for p in props:
        if p["title"].strip() == target.strip():
            return {"title": p["title"], "sheetId": p["sheetId"]}
    titles = ", ".join(p["title"] for p in props)
    raise RuntimeError(
        f"לא נמצא טאב בשם '{target}' בגיליון. הטאבים שנמצאו הם: {titles}"
    )


def fetch_sheet(sheet_type):
    """Returns (headers, rows) where rows is a list of dicts:
    {row_number, values: [...], is_green: bool}
    row_number is 1-indexed as it appears in the actual spreadsheet.

    Uses two lighter API calls instead of one heavy one: values for all
    columns (no formatting), and background color for column A only.
    This keeps memory usage low even on large sheets.
    """
    sheet_info = resolve_sheet(sheet_type)
    sheet_name = sheet_info["title"]

    values_resp = _api_get({
        "ranges": f"'{sheet_name}'",
        "includeGridData": "true",
        "fields": "sheets(data(rowData(values(formattedValue))))",
    })
    color_resp = _api_get({
        "ranges": f"'{sheet_name}'!A:A",
        "includeGridData": "true",
        "fields": "sheets(data(rowData(values(effectiveFormat.backgroundColor))))",
    })

    v_sheets = values_resp.get("sheets", [])
    c_sheets = color_resp.get("sheets", [])
    if not v_sheets:
        return [], []
    v_row_data = v_sheets[0].get("data", [{}])[0].get("rowData", [])
    c_row_data = c_sheets[0].get("data", [{}])[0].get("rowData", []) if c_sheets else []
    if not v_row_data:
        return [], []

    header_cells = v_row_data[0].get("values", [])
    headers = [c.get("formattedValue", "") for c in header_cells]
    num_cols = len(headers)

    rows = []
    for idx, row in enumerate(v_row_data[1:], start=2):
        cells = row.get("values", [])
        if not cells:
            continue
        values = []
        for i in range(num_cols):
            if i < len(cells):
                values.append(cells[i].get("formattedValue", ""))
            else:
                values.append("")
        if not any(v.strip() for v in values):
            continue

        row_color = None
        color_row_idx = idx - 1  # 0-indexed into c_row_data
        if color_row_idx < len(c_row_data):
            c_cells = c_row_data[color_row_idx].get("values", [])
            if c_cells:
                row_color = c_cells[0].get("effectiveFormat", {}).get("backgroundColor")

        rows.append(
            {
                "row_number": idx,
                "values": values,
                "is_green": is_green(row_color),
                "is_red": is_red(row_color),
            }
        )
    return headers, rows


def update_row(sheet_type, row_number, values):
    sheet_name = resolve_sheet(sheet_type)["title"]
    last_col = col_letter(len(values))
    range_ = f"'{sheet_name}'!A{row_number}:{last_col}{row_number}"
    _api_put_values(range_, values)


def set_row_color(sheet_type, row_number, num_cols, color_name):
    """Paints (or clears) the background color of an entire row.
    color_name is one of: "green", "red", "none"."""
    sheet_id = resolve_sheet(sheet_type)["sheetId"]
    colors = {
        "green": GREEN_RGB,
        "red": RED_RGB,
        "none": {"red": 1, "green": 1, "blue": 1},
    }
    color = colors.get(color_name, colors["none"])
    requests_body = [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_number - 1,
                    "endRowIndex": row_number,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColorStyle": {"rgbColor": color}
                    }
                },
                "fields": "userEnteredFormat.backgroundColorStyle",
            }
        }
    ]
    _api_batch_update(requests_body)


# ---------- Auth ----------


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if SITE_PASSWORD and not session.get("authed"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)

    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    if not SITE_PASSWORD:
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        if request.form.get("password") == SITE_PASSWORD:
            session["authed"] = True
            return redirect(url_for("index"))
        error = "סיסמה שגויה"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.pop("authed", None)
    return redirect(url_for("login"))


# ---------- Routes ----------


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/api/search", methods=["POST"])
@login_required
def api_search():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    search_by = data.get("search_by", "tz")
    query = (data.get("query") or "").strip()
    mode = data.get("mode")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not query:
        return jsonify({"error": "יש להזין ערך לחיפוש"}), 400

    try:
        headers, rows = fetch_sheet(sheet_type)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    if search_by == "company":
        if H_COMPANY not in headers:
            return jsonify({"error": f"לא נמצאה עמודה בשם '{H_COMPANY}'"}), 500
        company_idx = headers.index(H_COMPANY)
        q = query.lower()
        matched = [
            r for r in rows if r["values"] and q in r["values"][company_idx].lower()
        ]
    else:
        matched = [
            r for r in rows if r["values"] and r["values"][ID_COLUMN_INDEX].strip() == query
        ]

    if mode == "update":
        matched = [r for r in matched if not r["is_green"] and not r["is_red"]]

    return jsonify({"headers": headers, "rows": matched})


@app.route("/api/update", methods=["POST"])
@login_required
def api_update():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    row_number = data.get("row_number")
    values = data.get("values")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not row_number or not isinstance(values, list):
        return jsonify({"error": "נתונים חסרים"}), 400

    try:
        update_row(sheet_type, row_number, values)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/mark_row", methods=["POST"])
@login_required
def api_mark_row():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    row_number = data.get("row_number")
    num_cols = data.get("num_cols")
    color = data.get("color", "none")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not row_number or not num_cols:
        return jsonify({"error": "נתונים חסרים"}), 400
    if color not in ("green", "red", "none"):
        return jsonify({"error": "צבע לא תקין"}), 400

    try:
        set_row_color(sheet_type, row_number, num_cols, color)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
