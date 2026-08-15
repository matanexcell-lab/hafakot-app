(() => {
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
  const modalClose = document.getElementById("modal-close");
  const saveRowBtn = document.getElementById("save-row");
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let activeEditRow = null; // { row_number, values } while modal open in edit mode

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle("error", !!isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
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
      resultsList.appendChild(renderRowCard(row, headers, mode));
    });
  }

  function renderRowCard(row, headers, mode) {
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
    // preview the first few non-empty fields
    let shown = 0;
    for (let i = 0; i < headers.length && shown < 4; i++) {
      const val = row.values[i];
      if (!val) continue;
      const label = document.createElement("span");
      label.className = "row-field-label";
      label.textContent = headers[i] || `עמודה ${i + 1}`;
      const value = document.createElement("span");
      value.className = "row-field-value";
      value.textContent = val;
      fields.appendChild(label);
      fields.appendChild(value);
      shown++;
    }
    body.appendChild(fields);

    const footer = document.createElement("div");
    footer.className = "row-card-footer";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "edit-link";
    link.textContent = mode === "update" ? "עריכת שורה >" : "הצג פרטים מלאים >";
    link.addEventListener("click", () => openModal(row, mode));
    footer.appendChild(link);
    body.appendChild(footer);

    card.appendChild(body);
    return card;
  }

  function openModal(row, mode) {
    modalBody.innerHTML = "";
    const isEdit = mode === "update";
    saveRowBtn.style.display = isEdit ? "block" : "none";
    activeEditRow = isEdit ? { row_number: row.row_number, headers: state.headers } : null;

    state.headers.forEach((header, i) => {
      const field = document.createElement("div");
      field.className = "modal-field";
      const locked = i === 0; // ID column
      if (locked) field.classList.add("locked");
      const label = document.createElement("label");
      label.textContent = header || `עמודה ${i + 1}`;
      field.appendChild(label);

      if (isEdit) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = row.values[i] || "";
        input.dataset.colIndex = i;
        if (locked) input.disabled = true;
        field.appendChild(input);
      } else {
        const val = document.createElement("input");
        val.type = "text";
        val.value = row.values[i] || "";
        val.disabled = true;
        field.appendChild(val);
      }
      modalBody.appendChild(field);
    });

    modalBackdrop.hidden = false;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    activeEditRow = null;
  }

  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  saveRowBtn.addEventListener("click", async () => {
    if (!activeEditRow) return;
    const inputs = [...modalBody.querySelectorAll("input[data-col-index]")];
    const values = new Array(activeEditRow.headers.length).fill("");
    inputs.forEach((inp) => {
      values[Number(inp.dataset.colIndex)] = inp.value;
    });

    saveRowBtn.disabled = true;
    saveRowBtn.textContent = "שומר…";
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_type: state.sheetType,
          row_number: activeEditRow.row_number,
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
