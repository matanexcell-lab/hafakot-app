window.addEventListener("error", (e) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div style="background:#c0392b;color:#fff;padding:14px;font-size:13px;direction:ltr;text-align:left;white-space:pre-wrap;">JS ERROR: ${e.message}
File: ${e.filename}
Line: ${e.lineno}:${e.colno}</div>`
  );
});

(() => {
  const H_ID = "ת.ז";
  const H_CLIENT_NAME = "שם לקוח";
  const H_COMPANY = "חברה";
  const H_TRANSFER_COMPANY = "חברה מעבירה";
  const H_TRANSFER_FUND_NUMBER = "מספר קופה מעבירה";
  const H_PRODUCT = "סוג ההצעה / מוצר";
  const H_STATUS = "סטטוס הפקה";
  const H_LAST_UPDATE = "תאריך עדכון אחרון";
  const H_TRANSFER_EXPECTED = "ניוד צפוי";
  const H_TRANSFER_ACTUAL = "ניוד בפועל";
  const H_NOTES = "הערות";

  const STATUS_OPTIONS = {
    pension: [
      "ניוד בוצע אישור בבאפי",
      "ניוד בוצע לפי דוח יומי",
      "ניוד בוצע לפי אתר",
    ],
    detail: ["הופק"],
  };
  // סטטוסים שנוספו מהאתר – נשמרים בגיליון (לשונית "סטטוסים מותאמים"), לכן משותפים בין מחשב וטלפון
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ADD_STATUS_VALUE = "__add_status__";
  const customStatuses = { pension: [], detail: [] };
  function allStatusOptions(type) {
    const base = STATUS_OPTIONS[type] || [];
    return base.concat((customStatuses[type] || []).filter((x) => !base.includes(x)));
  }
  async function statusApi(path, body) {
    const res = await fetch(path, body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "שגיאה");
    customStatuses.pension = data.pension || [];
    customStatuses.detail = data.detail || [];
  }
  const customStatusesReady = statusApi("/api/status_options").catch(() => {});
  const COMPANY_OPTIONS_BY_TYPE = {
    pension: ["הראל", "ילין לפידות", "מיטב", "מגדל", "כלל", "הפניקס", "אלטשולר שחם", "אנליסט", "מור", "הכשרה"],
    detail: ["הראל", "מגדל", "כלל", "הפניקס", "הכשרה"],
  };
  const COMPANY_OTHER_VALUE = "__other_company__";
  const PRODUCT_CONFIG = {
    pension: {
      options: [
        "הצטרפות לקרן השתלמות",
        "הצטרפות לקרן השתלמות עם ניוד",
        "הצטרפות לקרן פנסיה",
        "הצטרפות לקרן פנסיה עם ניוד",
        "הצטרפות לקופת גמל",
        "הצטרפות לקופת גמל עם ניוד",
        "הצטרפות לקופת גמל להשקעה",
        "הצטרפות לקופת גמל להשקעה עם ניוד",
        "מינוי סוכן",
      ],
      other: false,
    },
    detail: {
      options: [
        "הצעה לביטוח חיים",
        "הצעה לביטוח בריאות",
        "הצעה לביטוח בריאות ומחלות קשות",
        "הצעה לביטוח חיים למשכנתא",
        "הצעה לביטוח חיים משועבד",
      ],
      other: true,
    },
  };
  const H_DATE = "תאריך";
  const H_DATE_SENT_TO_INSURER = "תאריך שנשלח לחברת הביטוח";
  const OTHER_VALUE = "__other__";

  const SEARCH_LABELS = {
    tz: { label: "תעודת זהות לקוח", placeholder: "לדוגמה: 123456789", numeric: true },
    name: { label: "שם לקוח", placeholder: "לדוגמה: ישראל ישראלי", numeric: false },
    company: { label: "שם חברה", placeholder: "לדוגמה: הראל", numeric: false },
    product: { label: "סוג הצעה / מוצר", placeholder: "", numeric: false },
  };

  const state = {
    sheetType: "pension",
    searchBy: "tz",
    mode: null,
    headers: [],
    rows: [],
  };

  const tzInput = document.getElementById("tz-input");
  const companySearchSelect = document.getElementById("company-search-select");
  const productSearchSelect = document.getElementById("product-search-select");
  const productMonthSelect = document.getElementById("product-month-select");
  const searchLabel = document.getElementById("search-label");
  const searchByGroup = document.getElementById("search-by-group");
  const sheetTypeGroup = document.getElementById("sheet-type-group");
  const btnUpdate = document.getElementById("btn-update");
  const btnView = document.getElementById("btn-view");
  const resultsPanel = document.getElementById("results-panel");
  const resultsTitle = document.getElementById("results-title");
  const resultsCount = document.getElementById("results-count");
  const resultsList = document.getElementById("results-list");
  const resultsSortSelect = document.getElementById("results-sort-select");
  const emptyState = document.getElementById("empty-state");
  const emptyText = document.getElementById("empty-text");
  const loading = document.getElementById("loading");
  const modalBackdrop = document.getElementById("edit-backdrop");
  const modalBody = document.getElementById("modal-body");
  const modalFooter = document.querySelector(".modal-footer");
  const modalClose = document.getElementById("modal-close");
  const saveRowBtn = document.getElementById("save-row");
  const modalTitleEl = document.querySelector(".modal-header h3");
  const btnCreateRow = document.getElementById("btn-create-row");
  const btnReports = document.getElementById("btn-reports");
  const reportsPanel = document.getElementById("reports-panel");
  const reportsSegmentGroup = document.getElementById("reports-segment-group");
  const reportProductSelect = document.getElementById("report-product-select");
  const reportMonthSelect = document.getElementById("report-month-select");
  const reportResultNumber = document.getElementById("report-result-number");
  const reportResultLabel = document.getElementById("report-result-label");
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let activeRow = null; // the row currently open in the modal
  let markGreenBtn = null;
  let markRedBtn = null;
  let deleteRowBtn = null;
  let deleteConfirmPending = false;
  let isCreating = false;
  let createModalHeaders = [];
  let reportData = null;
  let reportKind = "actual";
  let reportSheetType = "pension";
  const reportYtdEl = document.createElement("div");
  reportYtdEl.style.cssText = "margin-top:14px;padding-top:12px;border-top:1.5px dashed var(--line);";
  reportResultLabel.insertAdjacentElement("afterend", reportYtdEl);

  function reportNames() {
    return reportSheetType === "detail"
      ? { actual: "פרמיה בפועל", potential: "צפי פרמיה" }
      : { actual: "ניוד בפועל", potential: "צפי ניוד" };
  }

  const HEBREW_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];

  function formatMonthKey(key) {
    const [year, month] = key.split("-").map(Number);
    return `${HEBREW_MONTHS[month - 1]} ${year}`;
  }

  const REPORT_PRODUCT_GROUP_VALUE = "__group_non_pension__";
  const REPORT_ALL_PRODUCTS = "__all_products__";
  const REPORT_PRODUCT_GROUP_LABEL = "גמל + השתלמות + גמל להשקעה (הכל יחד)";
  const REPORT_PRODUCT_GROUP_ITEMS = [
    "הצטרפות לקופת גמל",
    "הצטרפות לקופת גמל עם ניוד",
    "הצטרפות לקרן השתלמות",
    "הצטרפות לקרן השתלמות עם ניוד",
    "הצטרפות לקופת גמל להשקעה",
    "הצטרפות לקופת גמל להשקעה עם ניוד",
  ];

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle("error", !!isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function getVal(headers, row, headerName) {
    let idx = headers.indexOf(headerName);
    if (idx === -1) {   // tolerate stray spaces in the sheet's header cell
      const want = headerName.replace(/\s+/g, " ").trim();
      idx = headers.findIndex((h) => String(h || "").replace(/\s+/g, " ").trim() === want);
    }
    if (idx === -1) return "";
    return (row.values[idx] || "").trim();
  }

  function parseDateForSort(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m.map(Number);
    if (y < 100) y += 2000;
    return y * 10000 + mo * 100 + d;
  }

  // Validates business rules tied to the selected product, using the final
  // values array about to be saved. Returns true if OK, or shows a toast
  // and returns false if the save should be blocked.
  function validateProductRules(headers, values) {
    const productIdx = headers.indexOf(H_PRODUCT);
    if (productIdx === -1) return true;
    const product = (values[productIdx] || "").trim();
    if (!product) return true;

    if (product === "מינוי סוכן") {
      const notesIdx = headers.indexOf(H_NOTES);
      const notesVal = notesIdx !== -1 ? (values[notesIdx] || "").trim() : "";
      if (!notesVal) {
        showToast("יש לרשום בהערות על מה יהיה מינוי סוכן", true);
        return false;
      }
    }

    if (product.includes("ניוד")) {
      const transferExpectedIdx = headers.indexOf(H_TRANSFER_EXPECTED);
      const transferVal = transferExpectedIdx !== -1 ? (values[transferExpectedIdx] || "").trim() : "";
      if (!transferVal) {
        showToast("יש לרשום ניוד צפוי", true);
        return false;
      }
    }

    return true;
  }

  function populateCompanySearchSelect() {
    const options = COMPANY_OPTIONS_BY_TYPE[state.sheetType] || [];
    companySearchSelect.innerHTML =
      `<option value="">בחר חברה…</option>` +
      options.map((opt) => `<option value="${opt}">${opt}</option>`).join("");
  }
  populateCompanySearchSelect();

  function populateProductSearchSelect() {
    const config = PRODUCT_CONFIG[state.sheetType] || { options: [] };
    let html = `<option value="">בחר מוצר…</option>`;
    if (state.sheetType === "pension") {
      html += `<option value="${REPORT_PRODUCT_GROUP_VALUE}">${REPORT_PRODUCT_GROUP_LABEL}</option>`;
    }
    if (state.sheetType === "detail") {
      html += `<option value="__group_detail_all__">כל המוצרים (הכל יחד)</option>`;
    }
    html += config.options.map((opt) => `<option value="${opt}">${opt}</option>`).join("");
    productSearchSelect.innerHTML = html;
  }
  populateProductSearchSelect();

  function populateProductMonthSelect() {
    const now = new Date();
    let html = `<option value="">בחר חודש…</option>`;
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      html += `<option value="${key}">${formatMonthKey(key)}</option>`;
    }
    productMonthSelect.innerHTML = html;
  }
  populateProductMonthSelect();

  function showSearchWidget(kind) {
    tzInput.hidden = kind !== "text";
    companySearchSelect.hidden = kind !== "company";
    productSearchSelect.hidden = kind !== "product";
    productMonthSelect.hidden = kind !== "product";
  }

  searchByGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...searchByGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.searchBy = btn.dataset.value;
    const cfg = SEARCH_LABELS[state.searchBy];
    searchLabel.textContent = cfg.label;
    if (state.searchBy === "company") {
      showSearchWidget("company");
      companySearchSelect.value = "";
    } else if (state.searchBy === "product") {
      showSearchWidget("product");
      productSearchSelect.value = "";
      productMonthSelect.value = "";
    } else {
      showSearchWidget("text");
      tzInput.placeholder = cfg.placeholder;
      if (cfg.numeric) {
        tzInput.inputMode = "numeric";
        tzInput.maxLength = 9;
      } else {
        tzInput.inputMode = "text";
        tzInput.removeAttribute("maxlength");
      }
      tzInput.value = "";
    }
  });

  sheetTypeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...sheetTypeGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.sheetType = btn.dataset.value;
    populateCompanySearchSelect();
    populateProductSearchSelect();
  });

  btnUpdate.addEventListener("click", () => runSearch("update"));
  btnView.addEventListener("click", () => runSearch("view"));

  function setLoading(isLoading) {
    loading.hidden = !isLoading;
    if (isLoading) {
      resultsPanel.hidden = true;
      emptyState.hidden = true;
      reportsPanel.hidden = true;
    }
  }

  async function runSearch(mode) {
    let query;
    if (state.searchBy === "company") {
      query = companySearchSelect.value.trim();
    } else if (state.searchBy === "product") {
      query = productSearchSelect.value.trim();
    } else {
      query = tzInput.value.trim();
    }
    if (!query) {
      showToast(`יש לבחור/להזין ${SEARCH_LABELS[state.searchBy].label}`, true);
      if (state.searchBy === "tz" || state.searchBy === "name") tzInput.focus();
      return;
    }
    let month = "";
    if (state.searchBy === "product") {
      month = productMonthSelect.value.trim();
      if (!month) {
        showToast("יש לבחור גם חודש", true);
        return;
      }
    }
    state.mode = mode;
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          search_by: state.searchBy,
          query,
          month,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "שגיאה בטעינת הנתונים");
      }
      state.headers = data.headers;
      state.rows = data.rows;
      renderResults();
    } catch (err) {
      showToast(err.message, true);
      emptyText.textContent = "אירעה שגיאה. נסה שוב.";
      emptyState.hidden = false;
    } finally {
      setLoading(false);
    }
  }

  function renderResults() {
    const { headers, mode } = state;
    let rows = state.rows;

    if (!rows.length) {
      resultsPanel.hidden = true;
      emptyText.textContent =
        mode === "update"
          ? "לא נמצאו שורות הממתינות לעדכון"
          : "לא נמצאו שורות";
      emptyState.hidden = false;
      return;
    }

    const sortOrder = resultsSortSelect.value;
    if (sortOrder === "asc" || sortOrder === "desc") {
      const lastUpdateIdx = headers.indexOf(H_LAST_UPDATE);
      rows = [...rows].sort((a, b) => {
        const da = lastUpdateIdx !== -1 ? parseDateForSort(a.values[lastUpdateIdx]) : null;
        const db = lastUpdateIdx !== -1 ? parseDateForSort(b.values[lastUpdateIdx]) : null;
        if (da === null && db === null) return 0;
        if (da === null) return 1; // rows without a date go last
        if (db === null) return -1;
        return sortOrder === "asc" ? da - db : db - da;
      });
    }

    emptyState.hidden = true;
    resultsPanel.hidden = false;
    resultsTitle.textContent = mode === "update" ? "שורות לעדכון" : "כל השורות";
    resultsCount.textContent = `${rows.length} שורות`;

    resultsList.innerHTML = "";
    rows.forEach((row) => {
      resultsList.appendChild(renderRowCard(row, headers));
    });
  }

  resultsSortSelect.addEventListener("change", renderResults);

  function renderRowCard(row, headers) {
    const card = document.createElement("div");
    card.className = "row-card" + (row.is_green ? " is-green" : row.is_red ? " is-red" : "");

    const ribbon = document.createElement("div");
    ribbon.className = "ribbon";
    card.appendChild(ribbon);

    const body = document.createElement("div");
    body.className = "row-card-body";

    const statusLabel = row.is_green ? "דווח" : row.is_red ? "לא רלוונטי" : "ממתין";
    const top = document.createElement("div");
    top.className = "row-card-top";
    top.innerHTML = `
      <span class="row-number">שורה ${row.row_number}</span>
      <span class="status-badge">${statusLabel}</span>
    `;
    body.appendChild(top);

    const fields = document.createElement("div");
    fields.className = "row-fields";

    const clientName = getVal(headers, row, H_CLIENT_NAME);
    const clientId = getVal(headers, row, H_ID);
    const company = getVal(headers, row, H_COMPANY);
    const product = getVal(headers, row, H_PRODUCT);
    const transferCompany = getVal(headers, row, H_TRANSFER_COMPANY);
    const transferFundNumber = getVal(headers, row, H_TRANSFER_FUND_NUMBER);
    const transferExpected = getVal(headers, row, H_TRANSFER_EXPECTED);
    const transferActual = getVal(headers, row, H_TRANSFER_ACTUAL);
    const lastUpdate = getVal(headers, row, H_LAST_UPDATE);

    const addField = (label, value) => {
      const l = document.createElement("span");
      l.className = "row-field-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "row-field-value";
      v.textContent = value;
      fields.appendChild(l);
      fields.appendChild(v);
    };

    if (clientName) addField(H_CLIENT_NAME, clientName);
    if (clientId) addField(H_ID, clientId);
    if (company) addField(H_COMPANY, company);
    if (product) addField(H_PRODUCT, product);
    if (transferCompany) addField(H_TRANSFER_COMPANY, transferCompany);
    if (transferFundNumber) addField(H_TRANSFER_FUND_NUMBER, transferFundNumber);
    if (transferExpected) addField(H_TRANSFER_EXPECTED, transferExpected);
    if (transferActual) addField(H_TRANSFER_ACTUAL, transferActual);
    if (lastUpdate) addField(H_LAST_UPDATE, lastUpdate);

    body.appendChild(fields);

    const footer = document.createElement("div");
    footer.className = "row-card-footer";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "edit-link";
    link.textContent = "עריכת שורה >";
    link.addEventListener("click", () => openModal(row));
    footer.appendChild(link);
    body.appendChild(footer);

    card.appendChild(body);
    return card;
  }

  function openModal(row) {
    modalBody.innerHTML = "";
    activeRow = row;
    isCreating = false;
    deleteConfirmPending = false;
    modalTitleEl.textContent = "עריכת שורה";
    saveRowBtn.textContent = "שמירת שינויים";

    // reset footer buttons
    if (markGreenBtn) { markGreenBtn.remove(); markGreenBtn = null; }
    if (markRedBtn) { markRedBtn.remove(); markRedBtn = null; }
    if (deleteRowBtn) { deleteRowBtn.remove(); deleteRowBtn = null; }

    markGreenBtn = document.createElement("button");
    markGreenBtn.type = "button";
    markGreenBtn.className = "action-btn";
    markGreenBtn.textContent = row.is_green ? "בטל סימון ירוק (דווח)" : "סמן שורה כדווח (ירוק)";
    markGreenBtn.addEventListener("click", () => toggleColor(row, "green"));
    modalFooter.insertBefore(markGreenBtn, saveRowBtn);

    markRedBtn = document.createElement("button");
    markRedBtn.type = "button";
    markRedBtn.className = "action-btn";
    markRedBtn.textContent = row.is_red ? "בטל סימון אדום (לא רלוונטי)" : "סמן שורה כלא רלוונטי (אדום)";
    markRedBtn.addEventListener("click", () => toggleColor(row, "red"));
    modalFooter.insertBefore(markRedBtn, saveRowBtn);

    deleteRowBtn = document.createElement("button");
    deleteRowBtn.type = "button";
    deleteRowBtn.className = "action-btn danger";
    deleteRowBtn.textContent = "מחיקת שורה";
    deleteRowBtn.addEventListener("click", () => handleDeleteClick(row));
    modalFooter.insertBefore(deleteRowBtn, saveRowBtn);

    const headers = state.headers;
    const statusIdx = headers.indexOf(H_STATUS);
    const companyIdx = headers.indexOf(H_COMPANY);
    const transferCompanyIdx = headers.indexOf(H_TRANSFER_COMPANY);
    const productIdx = headers.indexOf(H_PRODUCT);

    headers.forEach((header, i) => {
      if (i === statusIdx) {
        renderStatusField(header, row, i);
        return;
      }
      if (i === companyIdx) {
        renderCompanyField(header, row, i);
        return;
      }
      if (i === transferCompanyIdx) {
        renderTransferCompanyField(header, row, i);
        return;
      }
      if (i === productIdx) {
        renderProductField(header, row, i);
        return;
      }

      const field = document.createElement("div");
      field.className = "modal-field";
      const locked = header === H_ID;
      if (locked) field.classList.add("locked");
      const label = document.createElement("label");
      label.textContent = header || `עמודה ${i + 1}`;
      field.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.value = row.values[i] || "";
      input.dataset.colIndex = i;
      if (locked) input.disabled = true;
      field.appendChild(input);
      modalBody.appendChild(field);
    });

    modalBackdrop.hidden = false;
  }

  btnCreateRow.addEventListener("click", async () => {
    btnCreateRow.disabled = true;
    try {
      const res = await fetch("/api/headers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_type: state.sheetType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בטעינת שדות הגיליון");
      openCreateModal(data.headers);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btnCreateRow.disabled = false;
    }
  });

  btnReports.addEventListener("click", async () => {
    btnReports.disabled = true;
    resultsPanel.hidden = true;
    emptyState.hidden = true;
    setLoading(true);
    try {
      reportSheetType = state.sheetType;
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_type: reportSheetType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בטעינת הדוח");
      reportData = data;
      reportsPanel.hidden = false;
      populateReportSelectors();
      updateReportResult();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
      btnReports.disabled = false;
    }
  });

  reportsSegmentGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...reportsSegmentGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    reportKind = btn.dataset.value;
    populateReportSelectors();
    updateReportResult();
  });

  reportProductSelect.addEventListener("change", updateReportResult);
  reportMonthSelect.addEventListener("change", updateReportResult);

  function populateReportSelectors() {
    // Products: fixed pension product list, so the dropdown is always complete
    // even for products with zero results this month.
    const names = reportNames();
    const segBtns = reportsSegmentGroup.querySelectorAll(".segment");
    if (segBtns[0]) segBtns[0].textContent = names.actual;
    if (segBtns[1]) segBtns[1].textContent = names.potential;

    let products;
    if (reportSheetType === "detail") {
      // configured products + any other product text that actually appears in the data
      const seen = new Set(PRODUCT_CONFIG.detail.options);
      ["actual", "potential"].forEach((k) => ((reportData && reportData[k]) || []).forEach((e) => Object.keys(e.products).forEach((p) => seen.add(p))));
      products = [...seen];
    } else {
      products = PRODUCT_CONFIG.pension.options;
    }
    const prevProduct = reportProductSelect.value;
    const specialOpt = reportSheetType === "detail"
      ? `<option value="${REPORT_ALL_PRODUCTS}">כל המוצרים יחד</option>`
      : `<option value="${REPORT_PRODUCT_GROUP_VALUE}">${REPORT_PRODUCT_GROUP_LABEL}</option>`;
    reportProductSelect.innerHTML =
      `<option value="">בחר מוצר…</option>` + specialOpt +
      products.map((p) => `<option value="${p}">${p}</option>`).join("");
    if (prevProduct === REPORT_PRODUCT_GROUP_VALUE || prevProduct === REPORT_ALL_PRODUCTS || products.includes(prevProduct)) {
      reportProductSelect.value = prevProduct;
    }

    // Months: only months that actually appear in this metric's data.
    const months = [...new Set(["potential", "actual"].flatMap((k) => ((reportData && reportData[k]) || []).map((e) => e.month)))].sort().reverse();
    const prevMonth = reportMonthSelect.value;
    const years = [...new Set(months.map((m) => m.split("-")[0]))].sort().reverse();
    const periodOptions = [`<option value="">בחר חודש / שנה…</option>`];
    if (years.length) {
      periodOptions.push(`<optgroup label="שנים">`);
      periodOptions.push(`<option value="all">כל התקופה (כל השנים)</option>`);
      years.forEach((y) => periodOptions.push(`<option value="year:${y}">שנת ${y} (כל החודשים)</option>`));
      periodOptions.push(`</optgroup><optgroup label="חודשים">`);
    }
    months.forEach((m) => periodOptions.push(`<option value="${m}">${formatMonthKey(m)}</option>`));
    if (years.length) periodOptions.push(`</optgroup>`);
    reportMonthSelect.innerHTML = periodOptions.join("");
    const validValues = [...months, "all", ...years.map((y) => `year:${y}`)];
    if (validValues.includes(prevMonth)) reportMonthSelect.value = prevMonth;
  }

  function periodLabel(value) {
    if (value === "all") return "כל התקופה";
    if (value.startsWith("year:")) return `שנת ${value.slice(5)}`;
    return formatMonthKey(value);
  }

  function entriesForPeriod(value, kind) {
    const all = reportData[kind || reportKind] || [];
    if (value === "all") return all;
    if (value.startsWith("year:")) return all.filter((e) => e.month.startsWith(value.slice(5) + "-"));
    return all.filter((e) => e.month === value);
  }

  function sumFor(entries, product) {
    let sum = 0;
    entries.forEach((en) => {
      if (product === REPORT_ALL_PRODUCTS) {
        sum += Object.values(en.products).reduce((a, b) => a + b, 0);
      } else if (product === REPORT_PRODUCT_GROUP_VALUE) {
        sum += REPORT_PRODUCT_GROUP_ITEMS.reduce((acc, p) => acc + (en.products[p] || 0), 0);
      } else {
        sum += en.products[product] || 0;
      }
    });
    return sum;
  }

  // ---------- דוח משולב: צפי + בפועל + פער ----------
  const GAP_LIMIT = 0.20;
  const fmtNum = (n) => Math.round(n).toLocaleString("he-IL");
  const isAllScope = (p) => p === REPORT_ALL_PRODUCTS || p === REPORT_PRODUCT_GROUP_VALUE;
  const scopeParam = (p) => (p === REPORT_ALL_PRODUCTS ? "__all__" : p === REPORT_PRODUCT_GROUP_VALUE ? "__group__" : p);

  function gapInfo(e, a) {
    const gap = a - e;
    const pct = e > 0 ? gap / e : (a > 0 ? Infinity : 0);
    return { gap, pct, flagged: Math.abs(pct) > GAP_LIMIT };
  }
  function gapText(g) {
    if (!isFinite(g.pct)) return "ללא צפי";
    const sign = g.gap > 0 ? "+" : "";
    return `${sign}${(g.pct * 100).toFixed(0)}%`;
  }
  const gapCls = (g) => (g.flagged ? "rp-bad" : "rp-ok");

  function triple(e, a, names) {
    const g = gapInfo(e, a);
    return `<div class="rp-grid">
      <div><div class="rp-num">${fmtNum(e)}</div><div class="rp-lbl">${esc(names.potential)}</div></div>
      <div><div class="rp-num">${fmtNum(a)}</div><div class="rp-lbl">${esc(names.actual)}</div></div>
      <div><div class="rp-num ${gapCls(g)}">${g.gap > 0 ? "+" : ""}${fmtNum(g.gap)}</div><div class="rp-lbl ${gapCls(g)}">פער · ${gapText(g)}</div></div>
    </div>`;
  }

  function renderWhy(d) {
    const pctTxt = d.gap_pct == null ? "ללא צפי" : `${d.gap_pct > 0 ? "+" : ""}${d.gap_pct}%`;
    let h = `<b>למה יש פער (${pctTxt})?</b> צפי ${fmtNum(d.expected)}, בפועל ${fmtNum(d.actual)}, פער ${d.gap > 0 ? "+" : ""}${fmtNum(d.gap)}.<ul>`;
    if (!d.buckets.length) h += "<li>לא נמצאו שורות שמסבירות את הפער.</li>";
    d.buckets.forEach((b) => {
      const sign = b.amount > 0 ? "+" : "";
      h += `<li><b>${b.count} ${esc(b.text)}</b> (${sign}${fmtNum(b.amount)})`;
      b.rows.forEach((r) => {
        const who = esc(r.name || r.id || `שורה ${r.row}`);
        let amounts;
        if (b.key === "both") amounts = `צפי ${fmtNum(r.expected)} ← בפועל ${fmtNum(r.actual)}`;
        else if (b.key === "moved") amounts = `צפי ${fmtNum(r.expected)} · בפועל ${fmtNum(r.actual)}`;
        else if (b.key.startsWith("not_done")) amounts = `צפי ${fmtNum(r.expected)}`;
        else amounts = `בפועל ${fmtNum(r.actual)}`;
        const extra = [r.other_month ? `ב${esc(r.other_month)}` : "", r.status ? esc(r.status) : ""].filter(Boolean).join(" · ");
        h += `<small>${who} · ${esc(r.product)} · ${amounts}${extra ? " · " + extra : ""} · שורה ${r.row}</small>`;
      });
      if (b.more) h += `<small>ועוד ${b.more}…</small>`;
      h += `</li>`;
    });
    return h + "</ul>";
  }

  async function loadWhy(container, month, product) {
    container.innerHTML = "טוען הסבר…";
    try {
      const res = await fetch("/api/report/explain", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_type: reportSheetType, month, product: scopeParam(product) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      container.innerHTML = renderWhy(d);
    } catch (err) { container.textContent = err.message || "לא ניתן לטעון הסבר"; }
  }

  function rowsTable(items, names, withWhy) {
    // items: [{label, e, a, month, product}]
    let h = `<div class="rp-row rp-head"><span></span><span>${esc(names.potential)}</span><span>${esc(names.actual)}</span><span>פער</span></div>`;
    items.forEach((it, i) => {
      const g = gapInfo(it.e, it.a);
      h += `<div class="rp-row${g.flagged && (it.e || it.a) ? " rp-flag" : ""}" data-i="${i}">
        <span>${esc(it.label)}</span><span>${fmtNum(it.e)}</span><span>${fmtNum(it.a)}</span>
        <span class="${gapCls(g)}">${gapText(g)}</span>`;
      if (withWhy && g.flagged && (it.e || it.a) && it.month) h += `<button type="button" class="rp-why-btn" data-i="${i}">למה יש פער?</button>`;
      h += `</div>`;
    });
    return h;
  }

  function wireWhy(container, items) {
    container.querySelectorAll(".rp-why-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".rp-row");
        const it = items[Number(btn.dataset.i)];
        let box = row.querySelector(".rp-why");
        if (!box) { box = document.createElement("div"); box.className = "rp-why"; row.appendChild(box); loadWhy(box, it.month, it.product); }
        else box.hidden = !box.hidden;
      });
    });
  }

  const reportDash = document.getElementById("report-dash");

  function updateReportResult() {
    const product = reportProductSelect.value;
    const month = reportMonthSelect.value;
    reportYtdEl.innerHTML = "";
    if (!product || !month) {
      reportDash.innerHTML = `<div class="dl-note" style="text-align:center">בחר מוצר וחודש / שנה</div>`;
      return;
    }
    const names = reportNames();
    const productLabel = product === REPORT_PRODUCT_GROUP_VALUE ? REPORT_PRODUCT_GROUP_LABEL
      : product === REPORT_ALL_PRODUCTS ? "כל המוצרים יחד" : product;
    const E = sumFor(entriesForPeriod(month, "potential"), product);
    const A = sumFor(entriesForPeriod(month, "actual"), product);
    const single = /^\d{4}-\d{2}$/.test(month);
    let html = `<div class="rp-card"><div class="rp-title">${esc(periodLabel(month))} · ${esc(productLabel)}</div>${triple(E, A, names)}`;
    html += single && gapInfo(E, A).flagged && (E || A) ? `<div class="rp-why" id="rp-main-why" style="margin-top:10px"></div>` : "";
    html += `</div>`;

    // מצטבר מתחילת השנה
    if (single) {
      const year = month.slice(0, 4);
      const inYtd = (e) => e.month.startsWith(year + "-") && e.month <= month;
      const yE = sumFor((reportData.potential || []).filter(inYtd), product);
      const yA = sumFor((reportData.actual || []).filter(inYtd), product);
      html += `<div class="rp-card"><div class="rp-title">מתחילת ${year} ועד ${esc(formatMonthKey(month))} (מצטבר)</div>${triple(yE, yA, names)}</div>`;
    }

    // לפי מוצר (כשנבחרו כמה מוצרים יחד)
    const prodItems = [];
    if (isAllScope(product)) {
      const keys = new Set();
      ["potential", "actual"].forEach((k) => entriesForPeriod(month, k).forEach((en) => Object.keys(en.products).forEach((p) => keys.add(p))));
      [...keys].filter((p) => product === REPORT_ALL_PRODUCTS || REPORT_PRODUCT_GROUP_ITEMS.includes(p)).sort().forEach((p) => {
        prodItems.push({ label: p, e: sumFor(entriesForPeriod(month, "potential"), p), a: sumFor(entriesForPeriod(month, "actual"), p), month: single ? month : "", product: p });
      });
      if (prodItems.length) html += `<div class="rp-card" id="rp-prod"><div class="rp-title">לפי מוצר · ${esc(periodLabel(month))}</div>${rowsTable(prodItems, names, single)}</div>`;
    }

    // לפי חודשים (בשנה / בכל התקופה)
    const monthSet = new Set();
    const yearOf = single ? month.slice(0, 4) : (month.startsWith("year:") ? month.slice(5) : "");
    ["potential", "actual"].forEach((k) => (reportData[k] || []).forEach((en) => { if (!yearOf || en.month.startsWith(yearOf + "-")) monthSet.add(en.month); }));
    const monthItems = [...monthSet].sort().reverse().map((m) => ({
      label: formatMonthKey(m), e: sumFor(entriesForPeriod(m, "potential"), product), a: sumFor(entriesForPeriod(m, "actual"), product), month: m, product,
    }));
    if (monthItems.length > 1 || (monthItems.length === 1 && !single)) {
      html += `<div class="rp-card" id="rp-months"><div class="rp-title">לפי חודשים${yearOf ? " · " + yearOf : ""}</div>${rowsTable(monthItems, names, true)}</div>`;
    }
    html += `<div class="dl-note">פער מסומן באדום כשהוא עולה על 20% מהצפי. לחיצה על "למה יש פער?" מסבירה לפי השורות בגיליון.</div>`;
    reportDash.innerHTML = html;

    const mainWhy = document.getElementById("rp-main-why");
    if (mainWhy) loadWhy(mainWhy, month, product);
    const prodBox = document.getElementById("rp-prod"); if (prodBox) wireWhy(prodBox, prodItems);
    const monBox = document.getElementById("rp-months"); if (monBox) wireWhy(monBox, monthItems);
  }

  function openCreateModal(headers) {
    modalBody.innerHTML = "";
    activeRow = null;
    isCreating = true;
    deleteConfirmPending = false;
    modalTitleEl.textContent = "שורה חדשה";
    saveRowBtn.textContent = "יצירת שורה";
    createModalHeaders = headers;

    if (markGreenBtn) { markGreenBtn.remove(); markGreenBtn = null; }
    if (markRedBtn) { markRedBtn.remove(); markRedBtn = null; }
    if (deleteRowBtn) { deleteRowBtn.remove(); deleteRowBtn = null; }

    const blankValues = new Array(headers.length).fill("");
    const statusIdx = headers.indexOf(H_STATUS);
    const lastUpdateIdx = headers.indexOf(H_LAST_UPDATE);
    const dateIdx = headers.indexOf(H_DATE);
    const dateSentIdx = headers.indexOf(H_DATE_SENT_TO_INSURER);
    if (statusIdx !== -1) blankValues[statusIdx] = `${todayStr()}-נשלחו מסמכים`;
    if (lastUpdateIdx !== -1) blankValues[lastUpdateIdx] = todayStr();
    if (dateIdx !== -1) blankValues[dateIdx] = todayStr();
    if (dateSentIdx !== -1) blankValues[dateSentIdx] = todayStr();

    const blankRow = { row_number: null, values: blankValues, is_green: false, is_red: false };

    const companyIdx = headers.indexOf(H_COMPANY);
    const transferCompanyIdx = headers.indexOf(H_TRANSFER_COMPANY);
    const productIdx = headers.indexOf(H_PRODUCT);

    headers.forEach((header, i) => {
      if (i === companyIdx) { renderCompanyField(header, blankRow, i); return; }
      if (i === transferCompanyIdx) { renderTransferCompanyField(header, blankRow, i); return; }
      if (i === productIdx) { renderProductField(header, blankRow, i); return; }

      const field = document.createElement("div");
      field.className = "modal-field";
      const label = document.createElement("label");
      label.textContent = header || `עמודה ${i + 1}`;
      field.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.value = blankRow.values[i] || "";
      input.dataset.colIndex = i;
      field.appendChild(input);
      modalBody.appendChild(field);
    });

    modalBackdrop.hidden = false;
  }

  function renderStatusField(header, row, i) {
    const field = document.createElement("div");
    field.className = "modal-field";
    const label = document.createElement("label");
    label.textContent = header;
    field.appendChild(label);

    const historyBox = document.createElement("textarea");
    historyBox.value = row.values[i] || "";
    historyBox.rows = 4;
    historyBox.dataset.colIndex = i;
    historyBox.style.width = "100%";
    historyBox.style.padding = "10px 12px";
    historyBox.style.borderRadius = "8px";
    historyBox.style.border = "1.5px solid var(--line)";
    historyBox.style.background = "var(--paper)";
    historyBox.style.color = "var(--ink)";
    historyBox.style.fontFamily = "inherit";
    historyBox.style.fontSize = "13px";
    field.appendChild(historyBox);

    const editHint = document.createElement("p");
    editHint.textContent = "אפשר לתקן כאן ישירות את הטקסט הקיים.";
    editHint.style.fontSize = "11px";
    editHint.style.color = "var(--ink-soft)";
    editHint.style.margin = "4px 0 0";
    field.appendChild(editHint);

    const hint = document.createElement("label");
    hint.textContent = "הוספת עדכון סטטוס חדש (יתווסף עם תאריך היום מתחת להיסטוריה)";
    hint.style.marginTop = "8px";
    field.appendChild(hint);

    const select = document.createElement("select");
    select.dataset.statusSelect = "1";
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.borderRadius = "8px";
    select.style.border = "1.5px solid var(--line)";
    select.style.background = "var(--paper)";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "כתוב כאן את העדכון";
    otherInput.dataset.statusOtherInput = "1";
    otherInput.style.marginTop = "8px";
    otherInput.hidden = true;

    // שורת "הוספת סטטוס קבוע לרשימה"
    const addRow = document.createElement("div");
    addRow.style.cssText = "display:flex;gap:8px;margin-top:8px";
    addRow.hidden = true;
    const addInput = document.createElement("input");
    addInput.type = "text"; addInput.placeholder = "טקסט הסטטוס החדש"; addInput.style.flex = "1";
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "action-btn primary"; addBtn.textContent = "הוסף לרשימה";
    addBtn.style.cssText = "flex:none;width:auto;padding:8px 14px";
    addRow.appendChild(addInput); addRow.appendChild(addBtn);

    // הסרת סטטוס מותאם שנבחר
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "action-btn"; delBtn.textContent = "הסר סטטוס זה מהרשימה";
    delBtn.style.cssText = "margin-top:8px;width:auto;padding:6px 12px;font-size:12px";
    delBtn.hidden = true;

    function buildOptions(selected) {
      const type = state.sheetType;
      let html = `<option value="">בחר עדכון…</option>`;
      allStatusOptions(type).forEach((opt) => {
        html += `<option value="${esc(opt)}"${opt === selected ? " selected" : ""}>${esc(opt)}</option>`;
      });
      html += `<option value="${OTHER_VALUE}">אחר… (חד־פעמי)</option>`;
      html += `<option value="${ADD_STATUS_VALUE}">➕ הוספת סטטוס חדש לרשימה…</option>`;
      select.innerHTML = html;
    }
    function refreshExtras() {
      otherInput.hidden = select.value !== OTHER_VALUE;
      if (otherInput.hidden) otherInput.value = "";
      addRow.hidden = select.value !== ADD_STATUS_VALUE;
      delBtn.hidden = !(customStatuses[state.sheetType] || []).includes(select.value);
    }
    buildOptions("");
    customStatusesReady.then(() => { const cur = select.value; buildOptions(cur); refreshExtras(); });

    field.appendChild(select);
    field.appendChild(otherInput);
    field.appendChild(addRow);
    field.appendChild(delBtn);

    select.addEventListener("change", refreshExtras);
    addBtn.addEventListener("click", async () => {
      const text = addInput.value.replace(/\s+/g, " ").trim();
      if (!text) { showToast("כתוב את טקסט הסטטוס", true); return; }
      addBtn.disabled = true;
      try {
        await statusApi("/api/status_options/add", { sheet_type: state.sheetType, text });
        buildOptions(text); addInput.value = ""; refreshExtras();
        showToast("הסטטוס נוסף לרשימה (מסונכרן בכל המכשירים)");
      } catch (e) { showToast(e.message || "ההוספה נכשלה", true); }
      addBtn.disabled = false;
    });
    delBtn.addEventListener("click", async () => {
      const text = select.value;
      if (!text || !confirm(`להסיר את "${text}" מהרשימה? (עדכונים שכבר נרשמו בשורות לא ישתנו)`)) return;
      try {
        await statusApi("/api/status_options/delete", { sheet_type: state.sheetType, text });
        buildOptions(""); refreshExtras();
        showToast("הסטטוס הוסר מהרשימה");
      } catch (e) { showToast(e.message || "ההסרה נכשלה", true); }
    });

    modalBody.appendChild(field);
  }

  function renderCompanyField(header, row, i) {
    const field = document.createElement("div");
    field.className = "modal-field";
    const label = document.createElement("label");
    label.textContent = header;
    field.appendChild(label);

    const currentValue = (row.values[i] || "").trim();
    const options = COMPANY_OPTIONS_BY_TYPE[state.sheetType] || [];
    const isKnown = options.includes(currentValue);

    const select = document.createElement("select");
    select.dataset.companySelect = "1";
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.borderRadius = "8px";
    select.style.border = "1.5px solid var(--line)";
    select.style.background = "var(--paper)";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";

    let optionsHtml = currentValue ? "" : `<option value="">בחר חברה…</option>`;
    options.forEach((opt) => {
      optionsHtml += `<option value="${opt}"${opt === currentValue ? " selected" : ""}>${opt}</option>`;
    });
    optionsHtml += `<option value="${COMPANY_OTHER_VALUE}"${!isKnown && currentValue ? " selected" : ""}>אחר…</option>`;
    select.innerHTML = optionsHtml;
    field.appendChild(select);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "שם חברה";
    otherInput.dataset.companyOtherInput = "1";
    otherInput.style.marginTop = "8px";
    otherInput.value = !isKnown ? currentValue : "";
    otherInput.hidden = isKnown || !currentValue ? true : false;
    if (select.value === COMPANY_OTHER_VALUE) otherInput.hidden = false;
    field.appendChild(otherInput);

    select.addEventListener("change", () => {
      otherInput.hidden = select.value !== COMPANY_OTHER_VALUE;
      if (otherInput.hidden) otherInput.value = "";
    });

    modalBody.appendChild(field);
  }

  function renderTransferCompanyField(header, row, i) {
    const field = document.createElement("div");
    field.className = "modal-field";
    const label = document.createElement("label");
    label.textContent = header;
    field.appendChild(label);

    const currentValue = (row.values[i] || "").trim();
    const options = COMPANY_OPTIONS_BY_TYPE[state.sheetType] || [];
    const isKnown = options.includes(currentValue);

    const select = document.createElement("select");
    select.dataset.transferCompanySelect = "1";
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.borderRadius = "8px";
    select.style.border = "1.5px solid var(--line)";
    select.style.background = "var(--paper)";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";

    let optionsHtml = `<option value="">לא רלוונטי / ללא ניוד</option>`;
    options.forEach((opt) => {
      optionsHtml += `<option value="${opt}"${opt === currentValue ? " selected" : ""}>${opt}</option>`;
    });
    optionsHtml += `<option value="${COMPANY_OTHER_VALUE}"${!isKnown && currentValue ? " selected" : ""}>אחר…</option>`;
    select.innerHTML = optionsHtml;
    field.appendChild(select);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "שם חברה מעבירה";
    otherInput.dataset.transferCompanyOtherInput = "1";
    otherInput.style.marginTop = "8px";
    otherInput.value = !isKnown ? currentValue : "";
    otherInput.hidden = select.value !== COMPANY_OTHER_VALUE;
    field.appendChild(otherInput);

    select.addEventListener("change", () => {
      otherInput.hidden = select.value !== COMPANY_OTHER_VALUE;
      if (otherInput.hidden) otherInput.value = "";
    });

    modalBody.appendChild(field);
  }

  function renderProductField(header, row, i) {
    const field = document.createElement("div");
    field.className = "modal-field";
    const label = document.createElement("label");
    label.textContent = header;
    field.appendChild(label);

    const config = PRODUCT_CONFIG[state.sheetType] || { options: [], other: false };
    const currentValue = (row.values[i] || "").trim();

    const select = document.createElement("select");
    select.dataset.productSelect = "1";
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.borderRadius = "8px";
    select.style.border = "1.5px solid var(--line)";
    select.style.background = "var(--paper)";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";

    let optionsHtml = currentValue ? "" : `<option value="">בחר סוג הצעה / מוצר…</option>`;
    config.options.forEach((opt) => {
      optionsHtml += `<option value="${opt}"${opt === currentValue ? " selected" : ""}>${opt}</option>`;
    });
    const isKnownProduct = config.options.includes(currentValue);
    if (config.other) {
      optionsHtml += `<option value="${OTHER_VALUE}"${!isKnownProduct && currentValue ? " selected" : ""}>אחר…</option>`;
    }
    select.innerHTML = optionsHtml;
    field.appendChild(select);

    if (config.other) {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.placeholder = "כתוב כאן";
      otherInput.dataset.productOtherInput = "1";
      otherInput.style.marginTop = "8px";
      otherInput.value = !isKnownProduct ? currentValue : "";
      otherInput.hidden = select.value !== OTHER_VALUE;
      field.appendChild(otherInput);

      select.addEventListener("change", () => {
        otherInput.hidden = select.value !== OTHER_VALUE;
        if (otherInput.hidden) otherInput.value = "";
      });
    }

    modalBody.appendChild(field);
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    activeRow = null;
    isCreating = false;
    deleteConfirmPending = false;
    if (markGreenBtn) { markGreenBtn.remove(); markGreenBtn = null; }
    if (markRedBtn) { markRedBtn.remove(); markRedBtn = null; }
    if (deleteRowBtn) { deleteRowBtn.remove(); deleteRowBtn = null; }
  }

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  async function toggleColor(row, colorName) {
    const isActive = colorName === "green" ? row.is_green : row.is_red;
    const targetColor = isActive ? "none" : colorName;
    markGreenBtn.disabled = true;
    markRedBtn.disabled = true;
    try {
      const res = await fetch("/api/mark_row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          row_number: row.row_number,
          num_cols: state.headers.length,
          color: targetColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בסימון השורה");

      row.is_green = targetColor === "green";
      row.is_red = targetColor === "red";
      markGreenBtn.textContent = row.is_green ? "בטל סימון ירוק (דווח)" : "סמן שורה כדווח (ירוק)";
      markRedBtn.textContent = row.is_red ? "בטל סימון אדום (לא רלוונטי)" : "סמן שורה כלא רלוונטי (אדום)";

      showToast(
        targetColor === "none"
          ? "הסימון הוסר"
          : targetColor === "green"
          ? "השורה סומנה כדווח"
          : "השורה סומנה כלא רלוונטי"
      );
      renderResults();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      markGreenBtn.disabled = false;
      markRedBtn.disabled = false;
    }
  }

  function handleDeleteClick(row) {
    if (!deleteConfirmPending) {
      deleteConfirmPending = true;
      deleteRowBtn.textContent = "לחץ שוב לאישור המחיקה";
      showToast("לחץ שוב על 'מחיקת שורה' תוך כמה שניות כדי לאשר", true);
      setTimeout(() => {
        if (deleteConfirmPending) {
          deleteConfirmPending = false;
          if (deleteRowBtn) deleteRowBtn.textContent = "מחיקת שורה";
        }
      }, 5000);
      return;
    }
    deleteRow(row);
  }

  async function deleteRow(row) {
    deleteRowBtn.disabled = true;
    try {
      const res = await fetch("/api/delete_row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          row_number: row.row_number,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה במחיקת השורה");
      showToast("השורה נמחקה");
      closeModal();
      runSearch(state.mode);
    } catch (err) {
      showToast(err.message, true);
      deleteConfirmPending = false;
      if (deleteRowBtn) deleteRowBtn.textContent = "מחיקת שורה";
    } finally {
      if (deleteRowBtn) deleteRowBtn.disabled = false;
    }
  }

  async function saveNewRow() {
    const headers = createModalHeaders;
    const values = new Array(headers.length).fill("");

    modalBody.querySelectorAll("[data-col-index]").forEach((el) => {
      values[Number(el.dataset.colIndex)] = el.value;
    });

    const companyIdx = headers.indexOf(H_COMPANY);
    const companySelect = modalBody.querySelector("select[data-company-select]");
    if (companyIdx !== -1 && companySelect) {
      let v = companySelect.value;
      if (!v) {
        showToast("יש לבחור חברה", true);
        return;
      }
      if (v === COMPANY_OTHER_VALUE) {
        const otherInput = modalBody.querySelector("input[data-company-other-input]");
        v = otherInput ? otherInput.value.trim() : "";
        if (!v) {
          showToast("יש לכתוב את שם החברה בשדה 'אחר'", true);
          return;
        }
      }
      values[companyIdx] = v;
    }

    const transferCompanyIdx = headers.indexOf(H_TRANSFER_COMPANY);
    const transferSelect = modalBody.querySelector("select[data-transfer-company-select]");
    if (transferCompanyIdx !== -1 && transferSelect) {
      let v = transferSelect.value;
      if (v === COMPANY_OTHER_VALUE) {
        const otherInput = modalBody.querySelector("input[data-transfer-company-other-input]");
        v = otherInput ? otherInput.value.trim() : "";
      }
      values[transferCompanyIdx] = v;
    }

    const productIdx = headers.indexOf(H_PRODUCT);
    const productSelect = modalBody.querySelector("select[data-product-select]");
    if (productIdx !== -1 && productSelect) {
      let v = productSelect.value;
      if (!v) {
        showToast("יש לבחור סוג הצעה / מוצר", true);
        return;
      }
      if (v === OTHER_VALUE) {
        const otherInput = modalBody.querySelector("input[data-product-other-input]");
        v = otherInput ? otherInput.value.trim() : "";
        if (!v) {
          showToast("יש לכתוב בשדה 'אחר'", true);
          return;
        }
      }
      values[productIdx] = v;
    }

    if (!validateProductRules(headers, values)) return;

    saveRowBtn.disabled = true;
    saveRowBtn.textContent = "יוצר שורה…";
    try {
      const res = await fetch("/api/create_row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_type: state.sheetType, values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה ביצירת השורה");

      showToast("השורה נוצרה בהצלחה");
      closeModal();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      saveRowBtn.disabled = false;
      saveRowBtn.textContent = isCreating ? "יצירת שורה" : "שמירת שינויים";
    }
  }

  saveRowBtn.addEventListener("click", async () => {
    if (isCreating) return saveNewRow();
    if (!activeRow) return;
    const headers = state.headers;
    const values = new Array(headers.length).fill("");

    modalBody.querySelectorAll("[data-col-index]").forEach((el) => {
      values[Number(el.dataset.colIndex)] = el.value;
    });

    const pendingStatusLines = [];

    const statusSelect = modalBody.querySelector("select[data-status-select]");
    if (statusSelect && statusSelect.value === ADD_STATUS_VALUE) {
      showToast("סיימת להוסיף סטטוס? לחץ 'הוסף לרשימה' או בחר סטטוס אחר", true);
      return;
    }
    if (statusSelect && statusSelect.value) {
      let text = statusSelect.value;
      if (text === OTHER_VALUE) {
        const otherInput = modalBody.querySelector("input[data-status-other-input]");
        text = otherInput ? otherInput.value.trim() : "";
        if (!text) {
          showToast("יש לכתוב את תוכן העדכון בשדה 'אחר'", true);
          return;
        }
      }
      pendingStatusLines.push(`${todayStr()}-${text}`);
    }

    if (pendingStatusLines.length) {
      const statusIdx = headers.indexOf(H_STATUS);
      if (statusIdx !== -1) {
        const existing = values[statusIdx] || "";
        values[statusIdx] = (existing.trim() ? existing + "\n" : "") + pendingStatusLines.join("\n");
      }
    }

    const lastUpdateIdx = headers.indexOf(H_LAST_UPDATE);
    if (lastUpdateIdx !== -1) {
      values[lastUpdateIdx] = todayStr();
    }

    const companyIdx = headers.indexOf(H_COMPANY);
    const companySelect = modalBody.querySelector("select[data-company-select]");
    if (companyIdx !== -1 && companySelect) {
      let companyValue = companySelect.value;
      if (companyValue === COMPANY_OTHER_VALUE) {
        const companyOtherInput = modalBody.querySelector("input[data-company-other-input]");
        companyValue = companyOtherInput ? companyOtherInput.value.trim() : "";
        if (!companyValue) {
          showToast("יש לכתוב את שם החברה בשדה 'אחר'", true);
          return;
        }
      }
      values[companyIdx] = companyValue;
    }

    const transferCompanyIdx = headers.indexOf(H_TRANSFER_COMPANY);
    const transferSelect = modalBody.querySelector("select[data-transfer-company-select]");
    if (transferCompanyIdx !== -1 && transferSelect) {
      let transferValue = transferSelect.value;
      if (transferValue === COMPANY_OTHER_VALUE) {
        const transferOtherInput = modalBody.querySelector("input[data-transfer-company-other-input]");
        transferValue = transferOtherInput ? transferOtherInput.value.trim() : "";
      }
      values[transferCompanyIdx] = transferValue;
    }

    const productIdx = headers.indexOf(H_PRODUCT);
    const productSelect = modalBody.querySelector("select[data-product-select]");
    if (productIdx !== -1 && productSelect) {
      let productValue = productSelect.value;
      if (productValue === OTHER_VALUE) {
        const productOtherInput = modalBody.querySelector("input[data-product-other-input]");
        productValue = productOtherInput ? productOtherInput.value.trim() : "";
        if (!productValue) {
          showToast("יש לכתוב בשדה 'אחר' של סוג ההצעה / מוצר", true);
          return;
        }
      }
      values[productIdx] = productValue;
    }

    if (!validateProductRules(headers, values)) return;

    saveRowBtn.disabled = true;
    saveRowBtn.textContent = "שומר…";
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          row_number: activeRow.row_number,
          values,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בשמירה");

      showToast("השורה עודכנה בהצלחה");
      closeModal();
      runSearch(state.mode);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      saveRowBtn.disabled = false;
      saveRowBtn.textContent = "שמירת שינויים";
    }
  });
})();
