/* העלאת דוח יומי – פיילוט.
 * קובץ עצמאי: לא נוגע ב-script.js.
 * הדוח נקרא בדפדפן (SheetJS), נשלחות לשרת רק העמודות הנחוצות.
 * שלב 1: "בדיקה" – לא נכתב כלום. שלב 2: כתיבה רק לשורות שסימנת.
 */
(function () {
  "use strict";

  // ---------- מתאמים לפי חברה (לכל חברה דוח בפורמט אחר) ----------
  // כל שדה מזוהה לפי טקסט הכותרת בדוח – לא לפי אות העמודה.
  const ADAPTERS = {
    meitav: {
      label: "מיטב",
      sheetMatch: "מעקב הצטרפויות והעברות",
      headers: {
        id: "ת.ז",
        name: "שם עמית",
        acc: "מס' חשבון מעביר",
        amount: "סכום העברה בפועל",
        transfer_status: "סטטוס העברה",
        join_status: "סטטוס בהצטרפות",
        reject_desc: "תיאור הדחייה",
        reject_detail: "פירוט הדחייה",
        request_type: "סוג בקשה",
        product: "סוג מוצר",
        deposit_date: "תאריך הפקדה ראשונה",
      },
      required: ["id", "acc", "amount", "transfer_status", "join_status", "reject_desc"],
    },
  };

  const $ = (id) => document.getElementById(id);
  const btnOpen = $("btn-daily");
  const panel = $("daily-panel");
  if (!btnOpen || !panel) return;

  const companySel = $("daily-company");
  const fileInput = $("daily-file");
  const fileInfo = $("daily-file-info");
  const pilotInput = $("daily-pilot");
  const btnPreview = $("daily-preview");
  const out = $("daily-output");

  let parsedRows = null;
  let lastItems = [];
  let lastToday = "";
  let applied = false;

  // ---------- עזרים ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  // מסיר כל מה שאינו אות/ספרה – כך גרש/מרכאות מכל סוג לא משנים את ההשוואה
  function norm(s) {
    return String(s == null ? "" : s).replace(/[^0-9A-Za-z֐-׿]/g, "").toLowerCase();
  }
  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function toast(msg, isErr) {
    const t = $("toast");
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.toggle("error", !!isErr);
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 4200);
  }
  function hideOthers() {
    ["results-panel", "reports-panel", "empty-state"].forEach((id) => { const e = $(id); if (e) e.hidden = true; });
  }

  // ---------- פתיחה/סגירה ----------
  companySel.innerHTML = Object.keys(ADAPTERS)
    .map((k) => `<option value="${k}">${esc(ADAPTERS[k].label)}</option>`).join("");

  btnOpen.addEventListener("click", () => {
    hideOthers();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  ["btn-update", "btn-view", "btn-reports", "btn-create-row"].forEach((id) => {
    const b = $(id);
    if (b) b.addEventListener("click", () => { panel.hidden = true; });
  });

  // ---------- קריאת הקובץ ----------
  fileInput.addEventListener("change", async () => {
    parsedRows = null;
    out.innerHTML = "";
    fileInfo.textContent = "";
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    fileInfo.textContent = "קורא את הקובץ…";
    if (typeof XLSX === "undefined") {
      fileInfo.innerHTML = '<span class="dl-bad">ספריית האקסל לא נטענה (בדוק חיבור לאינטרנט) ורענן את הדף.</span>';
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      parsedRows = parseReport(buf, ADAPTERS[companySel.value]);
    } catch (e) {
      parsedRows = null;
      fileInfo.innerHTML = `<span class="dl-bad">${esc(e.message || e)}</span>`;
    }
  });
  companySel.addEventListener("change", () => { fileInput.value = ""; parsedRows = null; fileInfo.textContent = ""; out.innerHTML = ""; });

  function parseReport(buf, ad) {
    const wb = XLSX.read(buf, { type: "array" });
    const want = norm(ad.sheetMatch);
    const sheetName = wb.SheetNames.find((n) => norm(n).includes(want));
    if (!sheetName) {
      throw new Error(`בקובץ אין גיליון בשם "${ad.sheetMatch}". הגיליונות שנמצאו: ${wb.SheetNames.join(", ")}`);
    }
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });

    // איתור שורת הכותרות (מחפשים שורה שמכילה גם ת.ז וגם מס' חשבון מעביר)
    const needIdn = norm(ad.headers.id), needAccN = norm(ad.headers.acc);
    let headerRow = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const cells = grid[i].map(norm);
      if (cells.includes(needIdn) && cells.includes(needAccN)) { headerRow = i; break; }
    }
    if (headerRow === -1) {
      throw new Error(`לא נמצאה שורת כותרות עם "${ad.headers.id}" ו"${ad.headers.acc}" בגיליון "${sheetName}"`);
    }
    const hcells = grid[headerRow].map(norm);
    const col = {};
    const missing = [];
    Object.keys(ad.headers).forEach((k) => {
      const i = hcells.indexOf(norm(ad.headers[k]));
      if (i === -1) { if (ad.required.includes(k)) missing.push(ad.headers[k]); } else col[k] = i;
    });
    if (missing.length) throw new Error("חסרות כותרות בדוח: " + missing.join(", "));

    const rows = [];
    for (let i = headerRow + 1; i < grid.length; i++) {
      const g = grid[i];
      const get = (k) => (col[k] === undefined ? "" : String(g[col[k]] == null ? "" : g[col[k]]).trim());
      const id = get("id");
      if (!id) continue;
      rows.push({
        id, name: get("name"), acc: get("acc"), amount: get("amount"),
        transfer_status: get("transfer_status"), join_status: get("join_status"),
        reject_desc: get("reject_desc"), reject_detail: get("reject_detail"),
        request_type: get("request_type"), product: get("product"), deposit_date: get("deposit_date"),
      });
    }
    if (!rows.length) throw new Error("לא נמצאו שורות נתונים מתחת לשורת הכותרות");
    fileInfo.innerHTML = `✓ נקראו <b>${rows.length}</b> שורות מהגיליון "${esc(sheetName)}" (כותרות בשורה ${headerRow + 1})`;
    return rows;
  }

  // ---------- שלב 1: בדיקה (בלי כתיבה) ----------
  btnPreview.addEventListener("click", async () => {
    if (!parsedRows) {
      out.innerHTML = '<div class="dl-bad">קודם יש לבחור קובץ דוח (xlsx) בשדה "קובץ הדוח היומי" למעלה.</div>';
      toast("קודם בחר קובץ דוח תקין", true);
      return;
    }
    const pilot = pilotInput.value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    lastToday = todayStr();
    applied = false;
    btnPreview.disabled = true;
    out.innerHTML = '<div class="dl-note">בודק מול הגיליון… (לא נכתב כלום)</div>';
    try {
      const res = await fetch("/api/daily/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companySel.value, rows: parsedRows, pilot_ids: pilot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בבדיקה");
      lastItems = data.items;
      renderPreview(data, pilot.length);
    } catch (e) {
      out.innerHTML = `<div class="dl-bad">${esc(e.message || e)}</div>`;
    } finally {
      btnPreview.disabled = false;
    }
  });

  function itemCard(it, selectable) {
    const writes = it.kind
      ? `<div class="dl-write">ייכתב בסטטוס: <b>${esc(lastToday)}-${esc(it.text)}</b>` +
        (it.kind === "done" ? `<br>ניוד בפועל: <b>${esc(it.amount)}</b>` : "") +
        (it.green ? `<br><b>השורה תיצבע בירוק</b>` : "") +
        `<br>תאריך עדכון אחרון: <b>${esc(lastToday)}</b></div>`
      : "";
    const rep = (it.report || []).map((r) =>
      `<div class="dl-rep">בדוח: ${esc(r.name)} · חשבון ${esc(r.acc)} · סכום ${esc(r.amount || "—")} · ${esc(r.transfer_status || r.join_status || "")}${r.reject_desc ? " · " + esc(r.reject_desc) : ""}</div>`
    ).join("");
    const cls = it.level === "warn" ? "dl-warn" : it.level === "ok" ? "dl-ok" : "dl-gray";
    return `<div class="dl-card ${cls}">
      <label class="dl-head">
        ${selectable ? `<input type="checkbox" class="dl-chk" data-row="${it.row_number}" data-level="${it.level}">` : ""}
        <span><b>${esc(it.name)}</b> · ת.ז ${esc(it.id)} · שורה ${it.row_number} באתר</span>
      </label>
      <div class="dl-meta">${esc(it.product)}${it.transfer_company ? " · מעביר: " + esc(it.transfer_company) : ""} · קופה באתר: ${esc(it.fund || "—")}</div>
      ${it.note ? `<div class="dl-notebox">${esc(it.note)}</div>` : ""}
      ${writes}${rep}
    </div>`;
  }

  function renderPreview(data, pilotCount) {
    const s = data.stats;
    const items = data.items;
    const sel = items.filter((i) => (i.level === "ok" || i.level === "warn") && i.kind);
    const review = items.filter((i) => i.level === "review");
    const nomatch = items.filter((i) => i.level === "nomatch");
    const skip = items.filter((i) => i.level === "skip");

    let h = `<div class="dl-sum">
      ${(s.pilot_locked && s.pilot_locked.length) ? `<div class="dl-bad">🔒 מצב פיילוט: האתר עובד רק על ת.ז ${s.pilot_locked.map(esc).join(", ")}</div>` : ""}
      <b>תוצאת בדיקה – לא נכתב כלום</b>
      <div>שורות בדוח: ${s.report_rows}${pilotCount ? ` · פיילוט על ${pilotCount} ת.ז` : ""}</div>
      <div>שורות מיטב באתר ללא "ניוד בפועל" (נבדקו): ${s.eligible}</div>
      <div>שורות שלא נגענו בהן כי כבר יש בהן ניוד בפועל: ${s.skipped_has_actual} · צבועות: ${s.skipped_color}</div>
      <div><b>מוכנות לעדכון: ${sel.length}</b> · לבדיקה ידנית: ${review.length} · ללא התאמה: ${nomatch.length} · דולגו: ${skip.length}</div>
    </div>`;

    if (sel.length) {
      h += `<div class="dl-actions">
        <button type="button" class="action-btn" id="dl-sel-ok">סמן את הירוקות</button>
        <button type="button" class="action-btn" id="dl-sel-none">נקה סימון</button>
      </div>
      <div class="dl-legend"><span class="dl-dot ok"></span>ירוק = התאמה חד-משמעית · <span class="dl-dot warn"></span>צהוב = בדוק לפני סימון (למשל סכום של כמה שורות)</div>`;
      h += sel.map((i) => itemCard(i, true)).join("");
      h += `<button type="button" class="action-btn primary" id="dl-apply" style="margin-top:12px;width:100%;" disabled>עדכן שורות מסומנות (0)</button>`;
    } else {
      h += '<div class="dl-note">אין שורות מוכנות לעדכון.</div>';
    }
    h += `<button type="button" class="action-btn" id="dl-csv" style="margin-top:10px;width:100%;">הורדת קובץ CSV של התצוגה המקדימה (לפני/אחרי)</button>`;

    const group = (title, arr, open) => arr.length
      ? `<details class="dl-group" ${open ? "open" : ""}><summary>${title} (${arr.length})</summary>${arr.map((i) => itemCard(i, false)).join("")}</details>` : "";
    h += group("לבדיקה ידנית – לא ייכתב", review, true);
    h += group("ת.ז נמצאה בדוח אבל אין התאמת חשבון", nomatch, false);
    h += group("דולגו", skip, false);

    out.innerHTML = h;
    wirePreview();
  }

  function wirePreview() {
    const chks = () => [...out.querySelectorAll(".dl-chk")];
    const applyBtn = $("dl-apply");
    const refresh = () => {
      if (!applyBtn) return;
      const n = chks().filter((c) => c.checked).length;
      applyBtn.textContent = `עדכן שורות מסומנות (${n})`;
      applyBtn.disabled = n === 0 || applied;
    };
    out.addEventListener("change", (e) => { if (e.target.classList.contains("dl-chk")) refresh(); });
    const bOk = $("dl-sel-ok"), bNone = $("dl-sel-none");
    if (bOk) bOk.addEventListener("click", () => { chks().forEach((c) => { c.checked = c.dataset.level === "ok"; }); refresh(); });
    if (bNone) bNone.addEventListener("click", () => { chks().forEach((c) => { c.checked = false; }); refresh(); });
    $("dl-csv").addEventListener("click", downloadCsv);
    if (applyBtn) applyBtn.addEventListener("click", applySelected);
    refresh();
  }

  // ---------- שלב 2: כתיבה רק למסומנות ----------
  async function applySelected() {
    const rows = [...out.querySelectorAll(".dl-chk")].filter((c) => c.checked).map((c) => Number(c.dataset.row));
    if (!rows.length) return;
    const items = lastItems.filter((i) => rows.includes(i.row_number) && i.kind)
      .map((i) => ({ row_number: i.row_number, id: i.id, name: i.name, kind: i.kind, text: i.text, amount: i.amount }));
    if (!confirm(`לעדכן ${items.length} שורות בגיליון?\nמומלץ לוודא שנשמרה גרסה בגוגל שיטס (קובץ ← היסטוריית גרסאות ← תן שם לגרסה).`)) return;
    const btn = $("dl-apply");
    btn.disabled = true;
    btn.textContent = "כותב…";
    try {
      const res = await fetch("/api/daily/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, today: lastToday }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בכתיבה");
      applied = true;
      const okN = data.results.filter((r) => r.ok).length;
      let h = `<div class="dl-sum"><b>הסתיים: נכתבו ${okN} מתוך ${data.results.length}</b></div>`;
      h += data.results.map((r) =>
        `<div class="dl-res ${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"} שורה ${r.row_number} · ${esc(r.name)} – ${esc(r.msg)}</div>`).join("");
      h += '<div class="dl-note">כדי לעבוד שוב, העלה/י את הדוח מחדש ולחץ/י "בדיקה".</div>';
      out.innerHTML = h;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "עדכן שורות מסומנות";
      toast(e.message || String(e), true);
    }
  }

  // ---------- CSV ----------
  function downloadCsv() {
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ") + '"';
    const head = ["שורה באתר", "ת.ז", "שם", "מוצר", "חברה מעבירה", "קופה באתר", "רמה", "סטטוס נוכחי (לפני)", "סטטוס חדש (אחרי)", "ניוד בפועל (אחרי)", "הערה", "שורות בדוח"];
    const lines = [head.map(q).join(",")];
    lastItems.forEach((i) => {
      const after = i.kind ? (i.current_status ? i.current_status + " ⏎ " : "") + `${lastToday}-${i.text}` : "";
      const rep = (i.report || []).map((r) => `${r.acc}:${r.amount || r.transfer_status || r.join_status}`).join(" | ");
      lines.push([i.row_number, i.id, i.name, i.product, i.transfer_company, i.fund, i.level,
        i.current_status, after, i.kind === "done" ? i.amount : "", i.note, rep].map(q).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daily-preview-${lastToday.replace(/\//g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
})();
