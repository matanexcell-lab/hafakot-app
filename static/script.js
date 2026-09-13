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