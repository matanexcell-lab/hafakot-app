(() => {
  const H_ID = "ת.ז";
  const H_COMPANY = "חברה";
  const H_TRANSFER_COMPANY = "חברה מעבירה";
  const H_PRODUCT = "סוג ההצעה / מוצר";
  const H_STATUS = "סטטוס הפקה";
  const H_TRANSFER_ACTUAL = "ניוד בפועל";

  const TRANSFER_REASON_LABELS = {
    daily: "ניוד בוצע לפי דוח יומי",
    site: "ניוד בוצע לפי אתר",
    site_confirm: "ניוד בוצע לפי אתר אישור בבפי",
  };

  const state = {
    sheetType: "pension",
    mode: null,
    headers: [],
    rows: [],
  };

  const tzInput = document.getElementById("tz-input");
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
    const tz = tzInput.value.trim();
    if (!tz) {
      showToast("יש להזין תעודת זהות", true);
      tzInput.focus();
      return;
    }
    state.mode = mode;
    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet_type: state.sheetType, tz, mode }),
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
    card.className = "row-card" + (row.is_green ? " is-green" : "");

    const ribbon = document.createElement("div");
    ribbon.className = "ribbon";
    card.appendChild(ribbon);

    const body = document.createElement("div");
    body.className = "row-card-body";

    const top = document.createElement("div");
    top.className = "row-card-top";
    top.innerHTML = `
      <span class="row-number">שורה ${row.row_number}</span>
      <span class="status-badge">${row.is_green ? "דווח" : "ממתין"}</span>
    `;
    body.appendChild(top);

    const fields = document.createElement("div");
    fields.className = "row-fields";

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

    // reset mark-green button
    if (markGreenBtn) {
      markGreenBtn.remove();
      markGreenBtn = null;
    }
    markGreenBtn = document.createElement("button");
    markGreenBtn.type = "button";
    markGreenBtn.className = "action-btn";
    markGreenBtn.style.marginBottom = "8px";
    markGreenBtn.textContent = row.is_green ? "בטל סימון ירוק (דווח)" : "סמן שורה כדווח (ירוק)";
    markGreenBtn.addEventListener("click", () => toggleGreen(row));
    modalFooter.insertBefore(markGreenBtn, saveRowBtn);

    const headers = state.headers;
    const statusIdx = headers.indexOf(H_STATUS);
    const transferIdx = headers.indexOf(H_TRANSFER_ACTUAL);

    headers.forEach((header, i) => {
      if (i === statusIdx) {
        renderStatusField(header, row, i);
        return;
      }
      if (i === transferIdx) {
        renderTransferField(header, row, i, statusIdx);
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

    const newInput = document.createElement("input");
    newInput.type = "text";
    newInput.placeholder = "לדוגמה: נשלחו מסמכים";
    newInput.dataset.statusUpdateInput = "1";
    newInput.dataset.origValue = row.values[i] || "";
    field.appendChild(newInput);

    modalBody.appendChild(field);
  }

  function renderTransferField(header, row, i, statusIdx) {
    const field = document.createElement("div");
    field.className = "modal-field";
    const label = document.createElement("label");
    label.textContent = header;
    field.appendChild(label);

    const origValue = row.values[i] || "";
    const input = document.createElement("input");
    input.type = "text";
    input.value = origValue;
    input.dataset.colIndex = i;
    field.appendChild(input);

    const selectWrap = document.createElement("div");
    selectWrap.style.marginTop = "8px";
    selectWrap.hidden = true;

    const selectLabel = document.createElement("label");
    selectLabel.textContent = "לפי מה ידוע שהניוד בוצע?";
    selectWrap.appendChild(selectLabel);

    const select = document.createElement("select");
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.borderRadius = "8px";
    select.style.border = "1.5px solid var(--line)";
    select.style.background = "var(--paper)";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";
    select.dataset.transferReasonSelect = "1";
    select.innerHTML = `
      <option value="">בחר אפשרות…</option>
      <option value="daily">לפי דוח יומי</option>
      <option value="site">לפי אתר</option>
      <option value="site_confirm">לפי אתר עם אישור בבפי</option>
    `;
    selectWrap.appendChild(select);
    field.appendChild(selectWrap);

    input.addEventListener("input", () => {
      const changed = input.value.trim() !== "" && input.value.trim() !== origValue.trim();
      selectWrap.hidden = !changed;
      if (!changed) select.value = "";
    });

    modalBody.appendChild(field);
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    activeRow = null;
    if (markGreenBtn) {
      markGreenBtn.remove();
      markGreenBtn = null;
    }
  }

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  async function toggleGreen(row) {
    markGreenBtn.disabled = true;
    try {
      const res = await fetch("/api/mark_row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          row_number: row.row_number,
          num_cols: state.headers.length,
          green: !row.is_green,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה בסימון השורה");
      showToast(row.is_green ? "הסימון הירוק הוסר" : "השורה סומנה כדווח");
      closeModal();
      runSearch(state.mode);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (markGreenBtn) markGreenBtn.disabled = false;
    }
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

    // transfer-actual logic
    const transferSelect = modalBody.querySelector("select[data-transfer-reason-select]");
    if (transferSelect && !transferSelect.closest("div").hidden) {
      const reasonKey = transferSelect.value;
      if (!reasonKey) {
        showToast("יש לבחור לפי מה ידוע שהניוד בוצע", true);
        return;
      }
      pendingStatusLines.push(`${todayStr()}-${TRANSFER_REASON_LABELS[reasonKey]}`);
    }

    // manual status update
    const statusInput = modalBody.querySelector("input[data-status-update-input]");
    if (statusInput && statusInput.value.trim()) {
      pendingStatusLines.push(`${todayStr()}-${statusInput.value.trim()}`);
    }

    if (pendingStatusLines.length) {
      const statusIdx = headers.indexOf(H_STATUS);
      if (statusIdx !== -1) {
        const existing = values[statusIdx] || "";
        values[statusIdx] = (existing.trim() ? existing + "\n" : "") + pendingStatusLines.join("\n");
      }
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
