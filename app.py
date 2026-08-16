import os
import json
from functools import wraps

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

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


# ---------- Google Sheets helpers ----------

_service = None


def get_service():
    global _service
    if _service is not None:
        return _service
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not creds_json:
        raise RuntimeError("Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable")
    creds_dict = json.loads(creds_json)
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    _service = build("sheets", "v4", credentials=creds)
    return _service


def col_letter(n):
    """1-indexed column count -> spreadsheet column letter (e.g. 28 -> AB)."""
    result = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


def is_green(color):
    """Heuristic: does this background color look like a 'green' highlight?"""
    if not color:
        return False
    r = color.get("red", 1)
    g = color.get("green", 1)
    b = color.get("blue", 1)
    if r > 0.97 and g > 0.97 and b > 0.97:
        return False
    return g > r + 0.04 and g > b + 0.04


def resolve_sheet_title(sheet_type):
    """Ask Google for the exact tab titles and match against our configured name.
    This avoids mismatches from hidden characters or encoding differences."""
    service = get_service()
    target = SHEET_NAMES[sheet_type]
    resp = (
        service.spreadsheets()
        .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties(title)")
        .execute()
    )
    titles = [s["properties"]["title"] for s in resp.get("sheets", [])]
    for t in titles:
        if t.strip() == target.strip():
            return t
    raise RuntimeError(
        f"לא נמצא טאב בשם '{target}' בגיליון. הטאבים שנמצאו הם: {', '.join(titles)}"
    )


def fetch_sheet(sheet_type):
    """Returns (headers, rows) where rows is a list of dicts:
    {row_number, values: [...], is_green: bool}
    row_number is 1-indexed as it appears in the actual spreadsheet.
    """
    service = get_service()
    sheet_name = resolve_sheet_title(sheet_type)
    resp = (
        service.spreadsheets()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            ranges=[f"'{sheet_name}'"],
            includeGridData=True,
            fields="sheets(data(rowData(values(formattedValue,effectiveFormat.backgroundColor))))",
        )
        .execute()
    )
    sheets = resp.get("sheets", [])
    if not sheets:
        return [], []
    row_data = sheets[0].get("data", [{}])[0].get("rowData", [])
    if not row_data:
        return [], []

    header_cells = row_data[0].get("values", [])
    headers = [c.get("formattedValue", "") for c in header_cells]
    num_cols = len(headers)

    rows = []
    for idx, row in enumerate(row_data[1:], start=2):
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
        if cells:
            row_color = cells[0].get("effectiveFormat", {}).get("backgroundColor")
        rows.append(
            {
                "row_number": idx,
                "values": values,
                "is_green": is_green(row_color),
            }
        )
    return headers, rows


def update_row(sheet_type, row_number, values):
    service = get_service()
    sheet_name = resolve_sheet_title(sheet_type)
    last_col = col_letter(len(values))
    range_ = f"'{sheet_name}'!A{row_number}:{last_col}{row_number}"
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=range_,
        valueInputOption="USER_ENTERED",
        body={"values": [values]},
    ).execute()


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
    tz = (data.get("tz") or "").strip()
    mode = data.get("mode")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not tz:
        return jsonify({"error": "יש להזין תעודת זהות"}), 400

    try:
        headers, rows = fetch_sheet(sheet_type)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    matched = [r for r in rows if r["values"] and r["values"][ID_COLUMN_INDEX].strip() == tz]

    if mode == "update":
        matched = [r for r in matched if not r["is_green"]]

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


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
