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
      // רק אלה חובה. אם אין בדוח עמודת "מס' חשבון מעביר" וכד' (למשל דוח של הצטרפויות בלבד) –
      // ממשיכים, ורק ניודים לא יותאמו.
      required: ["id", "join_status"],
      headerKeys: ["id", "join_status"],
      // גיליון "ריכוז דחיות": סיבת הדחייה כשבגיליון הראשי כתוב רק "דחייה"
      rejections: {
        sheetMatch: "ריכוז דחיות",
        headers: { id: "ת.ז", fund: "מס' קופה", product: "סוג מוצר", date: "תאריך הדחייה", reason: "דחייה", detail: "פירוט הדחייה" },
      },
      // גיליון הפקדות: לעצמאי עם הפקדות באותה קופה => הפקדה ראשונה + סכום ההפקדות
      deposits: {
        sheetMatch: "מעקב הפקדות",
        headers: { id: "ת.ז", product: "סוג מוצר", fund: "מס' קופה", status: "מעמד", amount: 'סה"כ סכום הפקדה' },
      },
    },
    harel: {
      label: "הראל",
      sheetMatch: "ניוד נכנס",
      headers: {
        id: "מספר ת.ז",
        name: ["שם פרטי", "שם משפחה"],
        acc: "מספר חשבון מעביר",
        amount: "סכום להעברה",
        transfer_status: "סטטוס הליך ניוד",
        reject_desc: "הערות",
        expected_date: "תאריך יעד לביצוע ההעברה",
      },
      required: ["id", "transfer_status"],
      headerKeys: ["id", "transfer_status"],
    },
    mor: {
      label: "מור",
      sheetMatch: "תהליכי ניוד",
      headers: {
        id: "ת ז עמית",
        name: ["שם פרטי", "שם משפחה"],
        acc: "מספר חשבון העמית בקופה המעבירה",
        amount: "סכום ניוד",
        deposit: "סכום הפקדה",
        reject_desc: "הערות לסיבת דחייה",
        expected_date: "תאריך צפי לקבלת כספים",
        transfer_status: "תאור סיבת סטטוס ניוד",
      },
      doneByDeposit: true,   // הניוד בוצע רק כשיש ערך בעמודת "סכום הפקדה"
      required: ["id", "transfer_status"],
      headerKeys: ["id", "transfer_status"],
      altParser: "mor2",   // דוח 21.01B – ראה parseMor2
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
  let parsedDeposits = [];
  let altDeposits = null;
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
      fillRejectReasons(buf, ADAPTERS[companySel.value], parsedRows);
      parsedDeposits = parseDeposits(buf, ADAPTERS[companySel.value]);
    } catch (e) {
      parsedRows = null;
      fileInfo.innerHTML = `<span class="dl-bad">${esc(e.message || e)}</span>`;
    }
  });
  companySel.addEventListener("change", () => { fileInput.value = ""; parsedRows = null; fileInfo.textContent = ""; out.innerHTML = ""; });

  // מילוי סיבת דחייה מגיליון "ריכוז דחיות" לשורות שכתוב בהן רק "דחייה"
  function fillRejectReasons(buf, ad, rows) {
    if (!ad.rejections) return 0;
    const wb = XLSX.read(buf, { type: "array" });
    const sn = wb.SheetNames.find((n) => norm(n).includes(norm(ad.rejections.sheetMatch)));
    if (!sn) return 0;
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
    const H = ad.rejections.headers;
    const need = [H.id, H.reason].map(norm);
    let hr = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const cells = grid[i].map(norm);
      if (need.every((n) => cells.includes(n))) { hr = i; break; }
    }
    if (hr === -1) return 0;
    const hc = grid[hr].map(norm);
    const ix = {};
    Object.keys(H).forEach((k) => { ix[k] = hc.indexOf(norm(H[k])); });
    const val = (g, k) => (ix[k] < 0 ? "" : String(g[ix[k]] == null ? "" : g[ix[k]]).trim());
    const idn = (x) => String(x).replace(/\D/g, "").replace(/^0+/, "");
    const prodKind = (s) => { const n = norm(s); return n.includes("השתלמות") ? "h" : n.includes("פנסיה") ? "p" : n.includes("גמל") ? "g" : ""; };
    const dnum = (s) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
    const rej = [];
    for (let i = hr + 1; i < grid.length; i++) {
      const g = grid[i];
      if (!val(g, "id") || !val(g, "reason")) continue;
      rej.push({ id: idn(val(g, "id")), fund: val(g, "fund"), product: val(g, "product"), date: val(g, "date"), reason: val(g, "reason"), detail: val(g, "detail") });
    }
    const hasSeq = (a, b) => {  // רצף משותף של 5 ספרות
      const x = String(a).replace(/\D/g, ""), y = String(b).replace(/\D/g, "");
      if (x.length < 5 || y.length < 5) return false;
      for (let k = 0; k + 5 <= x.length; k++) if (y.includes(x.substr(k, 5))) return true;
      return false;
    };
    let filled = 0;
    rows.forEach((r) => {
      const isRej = [r.join_status, r.transfer_status].some((s) => norm(s) === norm("דחייה"));
      if (!isRej || r.reject_desc) return;
      const cands = rej.filter((x) => x.id === idn(r.id));
      if (!cands.length) return;
      const scored = cands.map((x) => ({
        x,
        score: (prodKind(x.product) && prodKind(x.product) === prodKind(r.product) ? 2 : 0) + (r.acc && x.fund && hasSeq(r.acc, x.fund) ? 3 : 0),
      }));
      scored.sort((a, b) => b.score - a.score || dnum(b.x.date) - dnum(a.x.date));
      const best = scored[0].x;
      r.reject_desc = best.reason;
      r.reject_detail = r.reject_detail || best.detail;
      filled++;
    });
    return filled;
  }

  // גיליון "מעקב הפקדות" (אופציונלי) – מחזיר רק שורות עם ערך בסכום ההפקדה
  function parseDeposits(buf, ad) {
    if (altDeposits) return altDeposits;
    if (!ad.deposits) return [];
    const wb = XLSX.read(buf, { type: "array" });
    const dsn = wb.SheetNames.find((n) => norm(n).includes(norm(ad.deposits.sheetMatch)));
    if (!dsn) return [];
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[dsn], { header: 1, raw: false, defval: "" });
    const H = ad.deposits.headers;
    const need = Object.keys(H).map((k) => norm(H[k]));
    let hr = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const cells = grid[i].map(norm);
      if (need.every((n) => cells.includes(n))) { hr = i; break; }
    }
    if (hr === -1) return [];
    const hc = grid[hr].map(norm);
    const ix = {};
    Object.keys(H).forEach((k) => { ix[k] = hc.indexOf(norm(H[k])); });
    const out = [];
    for (let i = hr + 1; i < grid.length; i++) {
      const g = grid[i];
      const v = (k) => String(g[ix[k]] == null ? "" : g[ix[k]]).trim();
      if (!v("id") || !v("amount")) continue;
      out.push({ id: v("id"), product: v("product"), fund: v("fund"), status: v("status"), amount: v("amount") });
    }
    return out;
  }

  // ---------- מור – דוח 21.01B (גיליונות: סטטוס ניודים נכנסים / הפקדה ראשונה / קופות שנפתחו / ריג'קטים) ----------
  function parseMor2(buf) {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const p2 = (n) => String(n).padStart(2, "0");
    const txt = (x) => {
      if (x instanceof Date) {
        const d = new Date(x.getTime() + 12 * 3600 * 1000);   // לעגל ליום הקרוב (שעות/אזורי זמן)
        return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
      }
      return String(x == null ? "" : x).replace(/\s+/g, " ").trim();
    };
    const mapProduct = (s) => {
      const n = norm(s);
      if (n.includes("השתלמות")) return "קרן השתלמות";
      if (n.includes("להשקעה")) return "קופת גמל להשקעה";
      if (n.includes("פנסיה")) return "קרן פנסיה";
      if (n.includes("גמל") || n.includes("תגמולים")) return "קופת גמל";
      return txt(s);
    };
    const sheet = (key) => {
      const sn = wb.SheetNames.find((n) => norm(n).includes(norm(key)));
      return sn ? XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" }) : null;
    };
    // מחזיר [{header->value}] לפי שורת הכותרות שמכילה את כל needed
    const table = (grid, needed) => {
      if (!grid) return [];
      const nn = needed.map(norm);
      let hr = -1;
      for (let i = 0; i < Math.min(grid.length, 30); i++) {
        const c = grid[i].map(norm);
        if (nn.every((n) => c.includes(n))) { hr = i; break; }
      }
      if (hr === -1) return [];
      const hc = grid[hr].map(norm);
      const out = [];
      for (let i = hr + 1; i < grid.length; i++) {
        const g = grid[i];
        out.push((h) => { const k = hc.indexOf(norm(h)); return k < 0 ? "" : g[k]; });
      }
      return out;
    };
    const validId = (x) => /^\d{5,}$/.test(String(x).trim());
    const rows = [], deposits = [];
    const mk = (o) => Object.assign({ id: "", name: "", acc: "", amount: "", transfer_status: "", join_status: "",
      reject_desc: "", reject_detail: "", request_type: "", product: "", deposit_date: "", expected_date: "" }, o);

    // 1. ניודים נכנסים
    table(sheet("סטטוס ניודים נכנסים"), ["ת. ז עמית", "מצב העברה"]).forEach((g) => {
      const id = txt(g("ת. ז עמית"));
      if (!validId(id)) return;
      let status = txt(g("מצב העברה"));
      const why = txt(g("סיבת דחיית הבקשה"));
      if (why) status += " - " + why;
      const done = status.startsWith("ניוד הושלם") || status.startsWith("ניוד מבוטל");
      rows.push(mk({ id, name: txt(g("שם עמית")), acc: txt(g("מספר חשבון במעבירה")),
        amount: txt(g("סכום העברה בפועל")), transfer_status: status,
        expected_date: done ? "" : txt(g("תאריך העברה צפוי")), product: mapProduct(g("שם קופה מקבלת")) }));
    });

    // 2. הפקדה ראשונה
    const firstDep = new Set();
    const seenDep = new Set();
    table(sheet("הפקדה ראשונה"), ["ת. זהות", "סכום הפקדה ראשונה"]).forEach((g) => {
      const id = txt(g("ת. זהות"));
      if (!validId(id)) return;
      const acc = txt(g("מספר חשבון מעבירה בהצטרפות"));
      const product = mapProduct(g("שם קופה"));
      const dd = txt(g("תאריך הפקדה ראשונה"));
      const dkey = [id, product, acc, dd].join("|");
      if (!seenDep.has(dkey)) {
        seenDep.add(dkey);
        rows.push(mk({ id, name: txt(g("שם עמית")), acc, product, join_status: "הקופה נפתחה",
          request_type: acc ? "הצטרפות+ניוד" : "הצטרפות", deposit_date: dd }));
      }
      firstDep.add(id + "|" + product);
      if (!acc) deposits.push({ id, product, fund: txt(g("מספר חשבון")), status: txt(g("מעמד עמית")), amount: txt(g("סכום הפקדה ראשונה")) });
    });

    // 3. קופות שנפתחו (בלי כפילויות, ובלי מי שכבר קיבל הפקדה ראשונה)
    const seen = new Set();
    table(sheet("קופות שנפתחו"), ["ת.ז עמית", "סוג הצטרפות"]).forEach((g) => {
      const id = txt(g("ת.ז עמית"));
      if (!validId(id)) return;
      const product = mapProduct(g("מוצר ראשי"));
      const type = txt(g("סוג הצטרפות")).replace(/\s+/g, "");
      const acc = txt(g("מספר חשבון מעביר"));
      const key = [id, product, type, acc].join("|");
      if (seen.has(key) || firstDep.has(id + "|" + product)) return;
      seen.add(key);
      rows.push(mk({ id, name: txt(g("שם העמית")), acc, product, join_status: "הקופה נפתחה", request_type: type }));
    });

    // 4. ריג'קטים
    const seenRej = new Set();
    table(sheet("ריג'קטים"), ["ת. זהות עמית", "סיבת ריג'קט"]).forEach((g) => {
      const id = txt(g("ת. זהות עמית"));
      if (!validId(id)) return;
      const text = [txt(g("סטטוס")), txt(g("סיבת ריג'קט"))].filter(Boolean).join(" - ");
      const prod = mapProduct(g("שם קופה מקבלת"));
      const rtype = txt(g("סוג הטופס")).replace(/\s+/g, "");
      const rkey = [id, prod, rtype, text].join("|");
      if (seenRej.has(rkey)) return;
      seenRej.add(rkey);
      rows.push(mk({ id, name: txt(g("שם העמית")), acc: txt(g("מספר חשבון במעבירה")),
        product: prod, join_status: text, transfer_status: text, request_type: rtype }));
    });
    return { rows, deposits };
  }

  function parseReport(buf, ad) {
    const wb = XLSX.read(buf, { type: "array" });
    const want = norm(ad.sheetMatch);
    const sheetName = wb.SheetNames.find((n) => norm(n).includes(want));
    altDeposits = null;
    if (!sheetName && ad.altParser === "mor2" && wb.SheetNames.some((n) => norm(n).includes(norm("סטטוס ניודים נכנסים")))) {
      const res = parseMor2(buf);
      altDeposits = res.deposits;
      return res.rows;
    }
    if (!sheetName) {
      throw new Error(`בקובץ אין גיליון בשם "${ad.sheetMatch}". הגיליונות שנמצאו: ${wb.SheetNames.join(", ")}`);
    }
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });

    // איתור שורת הכותרות (מחפשים שורה שמכילה גם ת.ז וגם מס' חשבון מעביר)
    const keyNames = (ad.headerKeys || ["id", "join_status"]).map((k) => ad.headers[k]);
    const needN = keyNames.map(norm);
    let headerRow = -1;
    for (let i = 0; i < Math.min(grid.length, 30); i++) {
      const cells = grid[i].map(norm);
      if (needN.every((n) => cells.includes(n))) { headerRow = i; break; }
    }
    if (headerRow === -1) {
      throw new Error(`לא נמצאה שורת כותרות עם ${keyNames.map((n) => '"' + n + '"').join(" ו")} בגיליון "${sheetName}"`);
    }
    const hcells = grid[headerRow].map(norm);
    const col = {};
    const missing = [];
    Object.keys(ad.headers).forEach((k) => {
      const names = Array.isArray(ad.headers[k]) ? ad.headers[k] : [ad.headers[k]];
      const idxs = names.map((n) => hcells.indexOf(norm(n)));
      if (idxs.includes(-1)) { if (ad.required.includes(k)) missing.push(names.join(" + ")); } else col[k] = idxs;
    });
    if (missing.length) throw new Error("חסרות כותרות בדוח: " + missing.join(", "));

    const rows = [];
    for (let i = headerRow + 1; i < grid.length; i++) {
      const g = grid[i];
      const get = (k) => (col[k] === undefined ? "" : col[k].map((ci) => String(g[ci] == null ? "" : g[ci]).trim()).filter(Boolean).join(" "));
      const id = get("id");
      if (!id) continue;
      // תאריכי ISO מהדוח (מיוצאים ב-UTC, למשל 2025-12-21T22:00) -> dd/mm/yyyy לפי שעון ישראל
      const fmtDate = (x) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(x);
        if (!m) return x;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 12, +m[5]));
        const p = (n) => String(n).padStart(2, "0");
        return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
      };
      let amountVal = get("amount");
      if (ad.doneByDeposit) {
        const num = (x) => parseFloat(String(x).replace(/[^\d.\-]/g, "")) || 0;
        const dep = get("deposit");
        amountVal = num(dep) > 0 ? (num(amountVal) > 0 ? amountVal : dep) : "";
      }
      rows.push({
        id, name: get("name"), acc: get("acc"), amount: amountVal,
        transfer_status: get("transfer_status"), join_status: get("join_status"),
        reject_desc: get("reject_desc"), reject_detail: get("reject_detail"),
        request_type: get("request_type"), product: get("product"), deposit_date: get("deposit_date"),
        expected_date: fmtDate(get("expected_date")),
      });
    }
    if (!rows.length) throw new Error("לא נמצאו שורות נתונים מתחת לשורת הכותרות");
    const absent = ["acc", "amount", "transfer_status"].filter((k) => col[k] === undefined).map((k) => ad.headers[k]);
    fileInfo.innerHTML = `✓ נקראו <b>${rows.length}</b> שורות מהגיליון "${esc(sheetName)}" (כותרות בשורה ${headerRow + 1})` +
      (absent.length ? `<br><span class="dl-bad">שים לב: בדוח אין העמודות: ${esc(absent.join(", "))} – ניודים לא יותאמו, רק הצטרפויות.</span>` : "");
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
        body: JSON.stringify({ company: companySel.value, rows: parsedRows, deposits: parsedDeposits, pilot_ids: pilot }),
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
    const un = data.unhandled || [];
    if (un.length) {
      h += `<details class="dl-group"><summary>ת.ז בדוח שלא קיבלו כרטיס (${un.length})</summary>` +
        un.map((u) => `<div class="dl-card">
          <div><b>${esc(u.name || "")}</b> · ת.ז ${esc(u.id)}</div>
          <div class="dl-note">${esc(u.reason)}</div>
          ${(u.report || []).map((r) => `<div class="dl-rep">בדוח: ${esc(typeof r === "string" ? r : [r.name, r.acc ? "חשבון " + r.acc : "", r.amount ? "סכום " + r.amount : "", r.transfer_status || r.join_status].filter(Boolean).join(" · "))}</div>`).join("")}
        </div>`).join("") + "</details>";
    }

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
