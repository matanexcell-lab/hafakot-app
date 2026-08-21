(() => {
  const H_ID = "ת.ז";
  const H_CLIENT_NAME = "שם לקוח";
  const H_COMPANY = "חברה";
  const H_TRANSFER_COMPANY = "חברה מעבירה";
  const H_PRODUCT = "סוג ההצעה / מוצר";
  const H_STATUS = "סטטוס הפקה";
  const H_LAST_UPDATE = "תאריך עדכון אחרון";

  const STATUS_OPTIONS = {
    pension: [
      "ניוד בוצע אישור בבאפי",
      "ניוד בוצע לפי דוח יומי",
      "ניוד בוצע לפי אתר",
    ],
    detail: ["הופק"],
  };
  const OTHER_VALUE = "__other__";

  const state = {
    sheetType: "pension",
    searchBy: "tz",
    mode: null,
    headers: [],
    rows: [],
  };

  const tzInput = document.getElementById("tz-input");
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
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let activeRow = null; // the row currently open in the modal
  let markGreenBtn = null;
  let markRedBtn = null;

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

  searchByGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...searchByGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.searchBy = btn.dataset.value;
    if (state.searchBy === "company") {
      searchLabel.textContent = "שם חברה";
      tzInput.placeholder = "לדוגמה: הראל";
      tzInput.inputMode = "text";
      tzInput.removeAttribute("maxlength");
    } else {
      searchLabel.textContent = "תעודת זהות לקוח";
      tzInput.placeholder = "לדוגמה: 123456789";
      tzInput.inputMode = "numeric";
      tzInput.maxLength = 9;
    }
    tzInput.value = "";
  });

  sheetTypeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn) return;
    [...sheetTypeGroup.children].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.sheetType = btn.dataset.value;
  });

  btnUpdate.addEventListener("click", () => runSearch("update"));
  btnView.addEventListener("click", () => runSearch("view"));

  function setLoading(isLoading) {
    loading.hidden = !isLoading;
    if (isLoading) {
      resultsPanel.hidden = true;
      emptyState.hidden = true;
    }
  }

  async function runSearch(mode) {
    const query = tzInput.value.trim();
    if (!query) {
      showToast(state.searchBy === "company" ? "יש להזין שם חברה" : "יש להזין תעודת זהות", true);
      tzInput.focus();
      return;
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
    const { headers, rows, mode } = state;

    if (!rows.length) {
      resultsPanel.hidden = true;
      emptyText.textContent =
        mode === "update"
          ? "לא נמצאו שורות הממתינות לעדכון עבור תעודת הזהות הזו"
          : "לא נמצאו שורות עבור תעודת הזהות הזו";
      emptyState.hidden = false;
      return;
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
    const company = getVal(headers, row, H_COMPANY);
    const product = getVal(headers, row, H_PRODUCT);
    const transferCompany = getVal(headers, row, H_TRANSFER_COMPANY);

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

    if (state.searchBy === "company" && clientName) addField(H_CLIENT_NAME, clientName);
    if (company) addField(H_COMPANY, company);
    if (product) addField(H_PRODUCT, product);
    if (transferCompany) addField(H_TRANSFER_COMPANY, transferCompany);

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

    // reset mark buttons
    if (markGreenBtn) { markGreenBtn.remove(); markGreenBtn = null; }
    if (markRedBtn) { markRedBtn.remove(); markRedBtn = null; }

    markGreenBtn = document.createElement("button");
    markGreenBtn.type = "button";
    markGreenBtn.className = "action-btn";
    markGreenBtn.style.marginBottom = "8px";
    markGreenBtn.textContent = row.is_green ? "בטל סימון ירוק (דווח)" : "סמן שורה כדווח (ירוק)";
    markGreenBtn.addEventListener("click", () => toggleColor(row, "green"));
    modalFooter.insertBefore(markGreenBtn, saveRowBtn);

    markRedBtn = document.createElement("button");
    markRedBtn.type = "button";
    markRedBtn.className = "action-btn";
    markRedBtn.style.marginBottom = "8px";
    markRedBtn.textContent = row.is_red ? "בטל סימון אדום (לא רלוונטי)" : "סמן שורה כלא רלוונטי (אדום)";
    markRedBtn.addEventListener("click", () => toggleColor(row, "red"));
    modalFooter.insertBefore(markRedBtn, saveRowBtn);

    const headers = state.headers;
    const statusIdx = headers.indexOf(H_STATUS);

    headers.forEach((header, i) => {
      if (i === statusIdx) {
        renderStatusField(header, row, i);
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

    const options = STATUS_OPTIONS[state.sheetType] || [];
    let optionsHtml = `<option value="">בחר עדכון…</option>`;
    options.forEach((opt) => {
      optionsHtml += `<option value="${opt}">${opt}</option>`;
    });
    optionsHtml += `<option value="${OTHER_VALUE}">אחר…</option>`;
    select.innerHTML = optionsHtml;
    field.appendChild(select);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "כתוב כאן את העדכון";
    otherInput.dataset.statusOtherInput = "1";
    otherInput.style.marginTop = "8px";
    otherInput.hidden = true;
    field.appendChild(otherInput);

    select.addEventListener("change", () => {
      otherInput.hidden = select.value !== OTHER_VALUE;
      if (otherInput.hidden) otherInput.value = "";
    });

    modalBody.appendChild(field);
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    activeRow = null;
    if (markGreenBtn) { markGreenBtn.remove(); markGreenBtn = null; }
    if (markRedBtn) { markRedBtn.remove(); markRedBtn = null; }
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

      await stampLastUpdate(row);

      showToast(
        targetColor === "none"
          ? "הסימון הוסר"
          : targetColor === "green"
          ? "השורה סומנה כדווח"
          : "השורה סומנה כלא רלוונטי"
      );
      renderResults(); // refresh the badge/ribbon behind the modal, without closing it
    } catch (err) {
      showToast(err.message, true);
    } finally {
      markGreenBtn.disabled = false;
      markRedBtn.disabled = false;
    }
  }

  async function stampLastUpdate(row) {
    const idx = state.headers.indexOf(H_LAST_UPDATE);
    if (idx === -1) return;
    const newValues = [...row.values];
    newValues[idx] = todayStr();
    const res = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheet_type: state.sheetType,
        row_number: row.row_number,
        values: newValues,
      }),
    });
    if (res.ok) row.values = newValues;
  }

  saveRowBtn.addEventListener("click", async () => {
    if (!activeRow) return;
    const headers = state.headers;
    const values = new Array(headers.length).fill("");

    // normal fields (inputs and the editable status textarea)
    modalBody.querySelectorAll("[data-col-index]").forEach((el) => {
      values[Number(el.dataset.colIndex)] = el.value;
    });

    const pendingStatusLines = [];

    const statusSelect = modalBody.querySelector("select[data-status-select]");
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