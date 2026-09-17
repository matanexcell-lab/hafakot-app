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
  const H_PRODUCT = "סוג ההצעה / מוצר";
  const H_STATUS = "סטטוס הפקה";
  const H_LAST_UPDATE = "תאריך עדכון אחרון";
  const H_TRANSFER_EXPECTED = "ניוד צפוי";
  const H_NOTES = "הערות";

  const STATUS_OPTIONS = {
    pension: [
      "ניוד בוצע אישור בבאפי",
      "ניוד בוצע לפי דוח יומי",
      "ניוד בוצע לפי אתר",
    ],
    detail: ["הופק"],
  };
  const COMPANY_OPTIONS_BY_TYPE = {
    pension: ["הראל", "ילין לפידות", "מיטב", "מגדל", "כלל", "הפניקס", "אלטשולר שחם", "אנליסט", "הכשרה"],
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
        "הצעה לביטוח חיים משועבד",
        "הצעה לביטוח מחלות קשות",
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
  const searchLabel = document.getElementById("search-label");
  const searchByGroup = document.getElementById("search-by-group");
  const sheetTypeGroup = document.getElementById("sheet-type-group");
  const btnUpdate = document.getElementById("btn-update");
  const btnView = document.getElementById("btn-view");
  const resultsPanel = document.getElementById("results-panel");
  const resultsTitle = document.getElementById("results-title");
  const resultsCount = document.getElementById("results-count");
  const resultsList = document.getElementById("results-list");
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

  const HEBREW_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];

  function formatMonthKey(key) {
    const [year, month] = key.split("-").map(Number);
    return `${HEBREW_MONTHS[month - 1]} ${year}`;
  }

  const REPORT_PRODUCT_GROUP_VALUE = "__group_non_pension__";
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
    const idx = headers.indexOf(headerName);
    if (idx === -1) return "";
    return (row.values[idx] || "").trim();
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

  searchByGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...searchByGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.searchBy = btn.dataset.value;
    const cfg = SEARCH_LABELS[state.searchBy];
    searchLabel.textContent = cfg.label;
    if (state.searchBy === "company") {
      tzInput.hidden = true;
      companySearchSelect.hidden = false;
      companySearchSelect.value = "";
    }