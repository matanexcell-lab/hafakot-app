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
H_TRANSFER_FUND_NUMBER = "מספר קופה מעבירה"

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


def _api_values_batch_update(data):
    """data = [{"range": "'tab'!A1", "values": [[...]]}, ...] - writes only those cells."""
    http = get_http()
    resp = http.post(
        f"{SHEETS_API_BASE}/{SPREADSHEET_ID}/values:batchUpdate",
        json={"valueInputOption": "USER_ENTERED", "data": data},
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


# ---------- Daily report import (per-company adapters) ----------

# Each company has its own report format. The browser reads the Excel file and
# sends only the columns we need, already translated to these generic keys:
#   id, name, acc (transfer account), amount, transfer_status,
#   join_status, reject_desc, reject_detail
# Adding a company = adding a browser-side adapter (script.js) + an entry here.
DAILY_COMPANIES = {
    "meitav": {
        "label": "מיטב",
        "site_company": "מיטב",  # substring that must appear in the site's 'חברה' column
        "pending_statuses": ["ממתין להפקדה ראשונה", "בתהליך קליטת סדין"],
        "reject_word": "דחייה",
    }
}

# PILOT LOCK: while this list is non-empty, the daily import can preview and
# write ONLY for these IDs, whatever the report or the browser sends.
# To open it to everyone: set the list to [] (or set env DAILY_PILOT_IDS=off).
DAILY_PILOT_IDS = ["239149982", "324190263"]  # ליאם מאיר פרחי, קורל קולדובסקי
_env_pilot = os.environ.get("DAILY_PILOT_IDS")
if _env_pilot is not None:
    DAILY_PILOT_IDS = [] if _env_pilot.strip().lower() in ("", "off") else [
        x for x in re.split(r"[\s,;]+", _env_pilot) if x]


def pilot_lock():
    return {norm_id(x) for x in DAILY_PILOT_IDS if norm_id(x)}


DONE_TEXT = "ניוד בוצע לפי דוח יומי ממוכן"
MIN_COMMON = 5  # a shared sequence of this many characters is enough to match accounts


def norm_id(s):
    """Digits only, leading zeros dropped (so 066690355 == 66690355)."""
    return re.sub(r"\D", "", s or "").lstrip("0")


def norm_acc(s):
    return re.sub(r"[^0-9A-Za-z֐-׿]", "", s or "").lower()


def accounts_match(a, b, k=MIN_COMMON):
    a, b = norm_acc(a), norm_acc(b)
    if not a or not b:
        return False
    if len(a) < k or len(b) < k:
        return a == b
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return any(short[i:i + k] in long_ for i in range(len(short) - k + 1))


def fmt_amount(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def classify_report_row(r, cfg):
    """Returns (kind, text, amount) for a single report row.
    kind: 'done' | 'pending' | 'reject' | 'none'"""
    amount = parse_amount(r.get("amount", ""))
    if amount > 0:
        return "done", DONE_TEXT, amount
    transfer_status = (r.get("transfer_status") or "").strip()
    if transfer_status in cfg["pending_statuses"]:
        return "pending", transfer_status, 0
    if (r.get("join_status") or "").strip() == cfg["reject_word"]:
        desc = (r.get("reject_desc") or "").strip()
        detail = (r.get("reject_detail") or "").strip()
        text = cfg["reject_word"]
        if desc:
            text += " " + desc
        if detail and desc == "אחר":
            text += " - " + detail
        return "reject", text, 0
    return "none", "", 0


def last_status_text(status_cell):
    """Text of the last line in the status history, without its leading date."""
    lines = [l.strip() for l in (status_cell or "").splitlines() if l.strip()]
    if not lines:
        return ""
    return re.sub(r"^\d{1,2}/\d{1,2}/\d{2,4}\s*-\s*", "", lines[-1]).strip()


def plan_daily_updates(company_key, report_rows, headers, sheet_rows, pilot_ids=None):
    """Pure function: decides what WOULD be written. Never touches Google.

    Only site rows that (a) belong to the company, (b) have an empty
    'ניוד בפועל', (c) are neither green nor red, are considered.
    Returns {"items": [...], "stats": {...}}"""
    cfg = DAILY_COMPANIES[company_key]

    def idx(name):
        return headers.index(name) if name in headers else -1

    i_name, i_company = idx(H_CLIENT_NAME), idx(H_COMPANY)
    i_product, i_tcomp = idx(H_PRODUCT), idx(H_TRANSFER_COMPANY)
    i_fund, i_status = idx(H_TRANSFER_FUND_NUMBER), idx(H_STATUS)
    i_actual = idx(H_TRANSFER_ACTUAL)
    for need, i in ((H_TRANSFER_ACTUAL, i_actual), (H_STATUS, i_status), (H_COMPANY, i_company)):
        if i == -1:
            raise RuntimeError(f"לא נמצאה עמודה בשם '{need}' בגיליון")

    def cell(r, i):
        return (r["values"][i] if 0 <= i < len(r["values"]) else "").strip()

    pilot = {norm_id(x) for x in (pilot_ids or []) if norm_id(x)}

    # report rows grouped by id
    by_id = {}
    for n, r in enumerate(report_rows):
        rid = norm_id(r.get("id", ""))
        if not rid or (pilot and rid not in pilot):
            continue
        r = dict(r)
        r["_n"] = n
        by_id.setdefault(rid, []).append(r)

    stats = {"site_rows_total": len(sheet_rows), "skipped_has_actual": 0, "skipped_color": 0,
             "skipped_other_company": 0, "eligible": 0, "id_not_in_report": 0}
    eligible = []
    for r in sheet_rows:
        rid = norm_id(r["values"][ID_COLUMN_INDEX] if len(r["values"]) > ID_COLUMN_INDEX else "")
        if not rid:
            continue
        if pilot and rid not in pilot:
            continue
        if cfg["site_company"] not in cell(r, i_company):
            stats["skipped_other_company"] += 1
            continue
        if cell(r, i_actual):
            stats["skipped_has_actual"] += 1
            continue
        if r["is_green"] or r["is_red"]:
            stats["skipped_color"] += 1
            continue
        eligible.append((r, rid))
    stats["eligible"] = len(eligible)

    # candidates per site row
    cands = {}
    usage = {}  # report row n -> list of site row numbers that matched it
    for r, rid in eligible:
        fund = cell(r, i_fund)
        found = []
        for rep in by_id.get(rid, []):
            if fund and accounts_match(fund, rep.get("acc", "")):
                kind, text, amount = classify_report_row(rep, cfg)
                found.append((rep, kind, text, amount))
        cands[r["row_number"]] = found
        for rep, *_ in found:
            usage.setdefault(rep["_n"], []).append(r["row_number"])

    items = []
    for r, rid in eligible:
        rn = r["row_number"]
        base = {
            "row_number": rn,
            "id": r["values"][ID_COLUMN_INDEX].strip(),
            "name": cell(r, i_name),
            "product": cell(r, i_product),
            "transfer_company": cell(r, i_tcomp),
            "fund": cell(r, i_fund),
            "current_status": cell(r, i_status),
        }
        found = cands.get(rn, [])
        if not found:
            if rid in by_id:
                base.update(level="nomatch", kind="", text="", amount=0,
                            note="ת.ז קיימת בדוח אבל אף מספר חשבון לא תאם" if base["fund"]
                            else "בשורה באתר אין מספר קופה מעבירה",
                            report=[_rep_view(x) for x in by_id[rid]])
                items.append(base)
            else:
                stats["id_not_in_report"] += 1
            continue

        done = [f for f in found if f[1] == "done"]
        pending = [f for f in found if f[1] == "pending"]
        reject = [f for f in found if f[1] == "reject"]
        none_ = [f for f in found if f[1] == "none"]
        report_view = [_rep_view(f[0]) for f in found]
        level, kind, text, amount, note = "ok", "", "", 0, ""

        if done:
            kind, text = "done", DONE_TEXT
            amount = round(sum(f[3] for f in done), 2)
            shared = [f for f in done if len(usage.get(f[0]["_n"], [])) > 1]
            if shared:
                level, kind, text, amount = "review", "", "", 0
                note = "שורת דוח אחת מתאימה ליותר משורה אחת באתר – לא ניתן לשייך סכום. לבדיקה ידנית"
            elif len(done) > 1:
                level = "warn"
                note = f"סכום של {len(done)} שורות בדוח עם אותו חשבון: " + " + ".join(
                    fmt_amount(f[3]) for f in done)
        elif pending:
            texts = {f[2] for f in pending}
            if len(texts) > 1:
                level, note = "review", "בדוח כמה סטטוסים שונים לאותו חשבון: " + " / ".join(sorted(texts))
            else:
                kind, text = "pending", pending[0][2]
                if len(pending) > 1:
                    level, note = "warn", f"{len(pending)} שורות בדוח עם אותו סטטוס"
        elif reject:
            texts = {f[2] for f in reject}
            if len(texts) > 1:
                level, note = "review", "כמה דחיות שונות לאותו חשבון: " + " / ".join(sorted(texts))
            else:
                kind, text = "reject", reject[0][2]
                if len(reject) > 1:
                    level, note = "warn", f"{len(reject)} שורות דחייה זהות בדוח"
        else:
            level = "review"
            note = "נמצאה התאמה, אבל אין בדוח סכום בפועל וגם הסטטוס אינו אחד מהמוגדרים – אין מה לעדכן"

        # a mix of outcomes (e.g. one fund moved, another rejected) deserves a look
        if level == "ok" and kind and (len({f[1] for f in found if f[1] != "none"}) > 1):
            level = "warn"
            note = "בדוח יש גם שורות מסוג אחר לאותו חשבון (למשל דחייה לצד ניוד שבוצע) – נבחר הניוד שבוצע"

        if kind and last_status_text(base["current_status"]) == text:
            level, note = "skip", "הסטטוס הזה כבר רשום אחרון בהיסטוריה – לא יתווסף שוב"
            kind = ""

        base.update(level=level, kind=kind, text=text, amount=amount, note=note, report=report_view)
        items.append(base)

    items.sort(key=lambda x: x["row_number"])
    stats["will_write"] = sum(1 for x in items if x["level"] in ("ok", "warn") and x["kind"])
    return {"items": items, "stats": stats}


def _rep_view(rep):
    return {
        "name": rep.get("name", ""),
        "acc": rep.get("acc", ""),
        "amount": rep.get("amount", ""),
        "transfer_status": rep.get("transfer_status", ""),
        "join_status": rep.get("join_status", ""),
        "reject_desc": rep.get("reject_desc", ""),
    }


def apply_daily_updates(items, today):
    """Writes ONLY the chosen cells, after re-reading the sheet and re-checking
    every safety condition. Returns a per-row result list."""
    sheet_info = resolve_sheet("pension")
    title = sheet_info["title"]
    headers, rows = fetch_sheet("pension")
    by_row = {r["row_number"]: r for r in rows}

    def idx(name):
        return headers.index(name) if name in headers else -1

    i_status, i_actual, i_last = idx(H_STATUS), idx(H_TRANSFER_ACTUAL), idx(H_LAST_UPDATE)
    if min(i_status, i_actual, i_last) == -1:
        raise RuntimeError("חסרה אחת העמודות: סטטוס הפקה / ניוד בפועל / תאריך עדכון אחרון")

    results, data = [], []
    for it in items:
        rn = it.get("row_number")
        res = {"row_number": rn, "name": it.get("name", ""), "ok": False, "msg": ""}
        results.append(res)
        r = by_row.get(rn)
        text = (it.get("text") or "").strip()
        kind = it.get("kind")
        if not r or not text or kind not in ("done", "pending", "reject"):
            res["msg"] = "נתונים לא תקינים / השורה לא נמצאה"
            continue
        if norm_id(r["values"][ID_COLUMN_INDEX]) != norm_id(it.get("id", "")):
            res["msg"] = "הת.ז בשורה השתנתה מאז התצוגה המקדימה – לא נכתב"
            continue
        if (r["values"][i_actual] or "").strip():
            res["msg"] = "כבר יש ערך בניוד בפועל – לא נכתב"
            continue
        if r["is_green"] or r["is_red"]:
            res["msg"] = "השורה צבועה – לא נכתב"
            continue
        existing = r["values"][i_status] or ""
        if last_status_text(existing) == text:
            res["msg"] = "הסטטוס כבר רשום – לא נכתב"
            continue
        new_status = (existing.rstrip() + "\n" if existing.strip() else "") + f"{today}-{text}"
        cells = [(i_status, new_status), (i_last, today)]
        if kind == "done":
            amount = parse_amount(str(it.get("amount", "")))
            if amount <= 0:
                res["msg"] = "סכום לא תקין – לא נכתב"
                continue
            cells.append((i_actual, fmt_amount(amount)))
        for ci, val in cells:
            data.append({"range": f"'{title}'!{col_letter(ci + 1)}{rn}", "values": [[val]]})
        res["ok"], res["msg"] = True, "נכתב"
    if data:
        _api_values_batch_update(data)
    return results


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


@app.route("/api/daily/preview", methods=["POST"])
@login_required
def api_daily_preview():
    """Dry run: reads the sheet, decides what would be written, writes NOTHING."""
    data = request.get_json(force=True)
    company = data.get("company")
    rows = data.get("rows")
    if company not in DAILY_COMPANIES:
        return jsonify({"error": "חברה לא נתמכת"}), 400
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "לא התקבלו שורות מהדוח"}), 400
    try:
        headers, sheet_rows = fetch_sheet("pension")
        lock = pilot_lock()
        pilot = sorted(lock) if lock else data.get("pilot_ids")
        result = plan_daily_updates(company, rows, headers, sheet_rows, pilot)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    result["stats"]["pilot_locked"] = sorted(lock)
    result["stats"]["report_rows"] = len(rows)
    return jsonify(result)


@app.route("/api/daily/apply", methods=["POST"])
@login_required
def api_daily_apply():
    data = request.get_json(force=True)
    items = data.get("items")
    today = (data.get("today") or "").strip()
    if not isinstance(items, list) or not items:
        return jsonify({"error": "לא נבחרו שורות"}), 400
    if not re.match(r"^\d{2}/\d{2}/\d{4}$", today):
        return jsonify({"error": "תאריך לא תקין"}), 400
    lock = pilot_lock()
    if lock and any(norm_id(it.get("id", "")) not in lock for it in items):
        return jsonify({"error": "מצב פיילוט: מותר לעדכן רק את הת.ז שהוגדרו לפיילוט"}), 403
    try:
        results = apply_daily_updates(items, today)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"results": results})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
