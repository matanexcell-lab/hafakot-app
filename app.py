import os
import json
import re
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
H_TRANSFER_EXPECTED = "ניוד צפוי"
H_DATE = "תאריך"
H_LAST_UPDATE = "תאריך עדכון אחרון"
H_NOTES = "הערות"

PRODUCT_GROUP_MARKER = "__group_non_pension__"
PRODUCT_GROUP_ITEMS = {
    "הצטרפות לקופת גמל",
    "הצטרפות לקופת גמל עם ניוד",
    "הצטרפות לקרן השתלמות",
    "הצטרפות לקרן השתלמות עם ניוד",
    "הצטרפות לקופת גמל להשקעה",
    "הצטרפות לקופת גמל להשקעה עם ניוד",
}


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


def fetch_headers(sheet_type):
    """Returns just the header row (row 1) - lightweight, used for the new-row form."""
    sheet_name = resolve_sheet(sheet_type)["title"]
    data = _api_get({
        "ranges": f"'{sheet_name}'!1:1",
        "includeGridData": "true",
        "fields": "sheets(data(rowData(values(formattedValue))))",
    })
    sheets = data.get("sheets", [])
    if not sheets:
        return []
    row_data = sheets[0].get("data", [{}])[0].get("rowData", [])
    if not row_data:
        return []
    header_cells = row_data[0].get("values", [])
    return [c.get("formattedValue", "") for c in header_cells]


def create_row(sheet_type, values):
    """Writes the new row into the first fully-empty row right after the
    existing data, instead of relying on the API's automatic 'append'
    detection (which can be unreliable)."""
    headers, rows = fetch_sheet(sheet_type)
    next_row_number = (rows[-1]["row_number"] + 1) if rows else 2
    update_row(sheet_type, next_row_number, values)


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


def delete_row(sheet_type, row_number):
    """Deletes an entire row from the sheet (rows below shift up)."""
    sheet_id = resolve_sheet(sheet_type)["sheetId"]
    requests_body = [
        {
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": row_number - 1,
                    "endIndex": row_number,
                }
            }
        }
    ]
    _api_batch_update(requests_body)


def parse_amount(s):
    """Parses a number out of a cell like '50,000' or '₪50000' or '50000.5'.
    Returns 0 if the cell is empty or not a number."""
    if not s:
        return 0
    cleaned = re.sub(r"[^\d.\-]", "", s.strip())
    if not cleaned or cleaned in ("-", "."):
        return 0
    try:
        return float(cleaned)
    except ValueError:
        return 0


def parse_month_key(date_str):
    """Extracts a 'YYYY-MM' key from a date string like '16/08/2026'.
    Returns None if it can't be parsed."""
    if not date_str:
        return None
    s = date_str.strip()
    m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$", s)
    if not m:
        return None
    _day, month, year = m.groups()
    month = int(month)
    year = int(year)
    if year < 100:
        year += 2000
    if not (1 <= month <= 12):
        return None
    return f"{year:04d}-{month:02d}"


def build_report():
    """Aggregates, by month (from the 'תאריך' column) and product, the SUM
    of the numeric values in ניוד בפועל and ניוד צפוי (not a row count)."""
    headers, rows = fetch_sheet("pension")

    date_idx = headers.index(H_DATE) if H_DATE in headers else -1
    actual_idx = headers.index(H_TRANSFER_ACTUAL) if H_TRANSFER_ACTUAL in headers else -1
    potential_idx = headers.index(H_TRANSFER_EXPECTED) if H_TRANSFER_EXPECTED in headers else -1
    product_idx = headers.index(H_PRODUCT) if H_PRODUCT in headers else -1

    actual_agg = {}
    potential_agg = {}

    for r in rows:
        vals = r["values"]
        if date_idx == -1 or date_idx >= len(vals):
            continue
        month_key = parse_month_key(vals[date_idx])
        if not month_key:
            continue
        product = vals[product_idx].strip() if 0 <= product_idx < len(vals) else ""
        if not product:
            product = "לא צוין"

        if 0 <= actual_idx < len(vals):
            amt = parse_amount(vals[actual_idx])
            if amt:
                actual_agg.setdefault(month_key, {}).setdefault(product, 0)
                actual_agg[month_key][product] += amt
        if 0 <= potential_idx < len(vals):
            amt = parse_amount(vals[potential_idx])
            if amt:
                potential_agg.setdefault(month_key, {}).setdefault(product, 0)
                potential_agg[month_key][product] += amt

    def to_list(agg):
        result = []
        for month_key in sorted(agg.keys(), reverse=True):
            products = agg[month_key]
            total = sum(products.values())
            result.append({"month": month_key, "products": products, "total": total})
        return result

    return {"actual": to_list(actual_agg), "potential": to_list(potential_agg)}


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
        idx = headers.index(H_COMPANY)
        q = query.lower()
        matched = [r for r in rows if r["values"] and q in r["values"][idx].lower()]
    elif search_by == "name":
        if H_CLIENT_NAME not in headers:
            return jsonify({"error": f"לא נמצאה עמודה בשם '{H_CLIENT_NAME}'"}), 500
        idx = headers.index(H_CLIENT_NAME)
        q = query.lower()
        matched = [r for r in rows if r["values"] and q in r["values"][idx].lower()]
    elif search_by == "product":
        if H_PRODUCT not in headers:
            return jsonify({"error": f"לא נמצאה עמודה בשם '{H_PRODUCT}'"}), 500
        idx = headers.index(H_PRODUCT)
        if query == PRODUCT_GROUP_MARKER:
            matched = [
                r for r in rows if r["values"] and r["values"][idx].strip() in PRODUCT_GROUP_ITEMS
            ]
        else:
            matched = [r for r in rows if r["values"] and r["values"][idx].strip() == query]

        month = (data.get("month") or "").strip()
        if month:
            if H_DATE not in headers:
                return jsonify({"error": f"לא נמצאה עמודה בשם '{H_DATE}'"}), 500
            date_idx = headers.index(H_DATE)
            matched = [
                r for r in matched
                if r["values"] and date_idx < len(r["values"])
                and parse_month_key(r["values"][date_idx]) == month
            ]
    else:
        matched = [
            r for r in rows if r["values"] and r["values"][ID_COLUMN_INDEX].strip() == query
        ]

    if mode == "update":
        matched = [r for r in matched if not r["is_green"] and not r["is_red"]]

    return jsonify({"headers": headers, "rows": matched})


@app.route("/api/headers", methods=["POST"])
@login_required
def api_headers():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    try:
        headers = fetch_headers(sheet_type)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"headers": headers})


@app.route("/api/create_row", methods=["POST"])
@login_required
def api_create_row():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    values = data.get("values")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not isinstance(values, list):
        return jsonify({"error": "נתונים חסרים"}), 400

    try:
        create_row(sheet_type, values)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/report", methods=["POST"])
@login_required
def api_report():
    try:
        data = build_report()
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(data)


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


@app.route("/api/delete_row", methods=["POST"])
@login_required
def api_delete_row():
    data = request.get_json(force=True)
    sheet_type = data.get("sheet_type")
    row_number = data.get("row_number")

    if sheet_type not in SHEET_NAMES:
        return jsonify({"error": "סוג גיליון לא תקין"}), 400
    if not row_number:
        return jsonify({"error": "נתונים חסרים"}), 400

    try:
        delete_row(sheet_type, row_number)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
