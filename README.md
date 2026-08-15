# ניהול הפקות לקוחות — הוראות התקנה

אתר Flask שמתחבר לגיליון גוגל שיטס שלך (טאבים "פנסיוני" ו"פרט") ומאפשר:
- **עדכון שינויים** — הצגת שורות עבור ת.ז נתונה שעדיין לא סומנו בירוק, עם אפשרות עריכה ושמירה.
- **הצגת כל השורות** — תצוגה מלאה (כולל שורות ירוקות) עבור ת.ז נתונה.

---

## שלב 1: יצירת Service Account בגוגל

1. היכנס ל-[Google Cloud Console](https://console.cloud.google.com/).
2. צור פרויקט חדש (או בחר פרויקט קיים).
3. בתפריט החיפוש למעלה, חפש **Google Sheets API** ולחץ **Enable**.
4. בתפריט הצד: **APIs & Services > Credentials**.
5. לחץ **Create Credentials > Service Account**.
   - תן שם (למשל `sheets-app`), ולחץ **Create and Continue**, ואז **Done** (אין צורך להוסיף הרשאות פרויקט).
6. ברשימת ה-Service Accounts, לחץ על החשבון שיצרת.
7. עבור לטאב **Keys > Add Key > Create new key > JSON**.
   - יורד קובץ JSON למחשב שלך. **שמור אותו במקום בטוח** — זה המפתח שהאתר ישתמש בו כדי להתחבר לגיליון.
8. באותו עמוד, העתק את כתובת המייל של ה-Service Account (נראית כך: `sheets-app@your-project.iam.gserviceaccount.com`).

## שלב 2: שיתוף הגיליון

1. פתח את גיליון הגוגל שיטס שלך.
2. לחץ **שיתוף (Share)**.
3. הדבק את כתובת המייל של ה-Service Account (משלב 1.8), תן לה הרשאת **עורך (Editor)**, ושלח.
4. העתק את **מזהה הגיליון (Spreadsheet ID)** מתוך כתובת ה-URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```

## שלב 3: העלאה ל-GitHub (נדרש כדי לפרוס ב-Render)

1. צור repository חדש ב-GitHub והעלה אליו את כל תיקיית הפרויקט הזו.
2. וודא שקובץ ה-JSON של ה-Service Account **לא** מועלה ל-GitHub — הוא יימסר ל-Render כמשתנה סביבה (ראה שלב 4), לא כקובץ בקוד.

## שלב 4: פריסה ב-Render

1. היכנס ל-[Render](https://render.com/) וצור **New > Web Service**.
2. חבר את ה-repository שיצרת.
3. הגדרות בנייה:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app`
4. בטאב **Environment**, הוסף את משתני הסביבה הבאים:

   | שם המשתנה | ערך |
   |---|---|
   | `SPREADSHEET_ID` | המזהה שהעתקת בשלב 2.4 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | **כל תוכן** קובץ ה-JSON משלב 1.7, כמחרוזת אחת (ראה הערה למטה) |
   | `SITE_PASSWORD` | סיסמה לבחירתך להגנה על האתר (מומלץ מאוד — יש בו מידע אישי של לקוחות) |
   | `SECRET_KEY` | מחרוזת אקראית כלשהי, למשל תוצאה של `python -c "import secrets; print(secrets.token_hex(16))"` |

   **הערה לגבי `GOOGLE_SERVICE_ACCOUNT_JSON`:** פתח את קובץ ה-JSON בעורך טקסט, העתק את כל התוכן שלו (כולל הסוגריים המסולסלים), והדבק אותו כערך של המשתנה — הכול בשורה אחת, בדיוק כפי שהוא בקובץ.

5. לחץ **Create Web Service**. הפריסה תיקח כמה דקות.
6. לאחר סיום, תקבל כתובת בסגנון `https://your-app.onrender.com` — היא תעבוד גם בטלפון וגם במחשב.

---

## הפעלה מקומית (אופציונלי, לבדיקה לפני העלאה)

```bash
pip install -r requirements.txt
export SPREADSHEET_ID="..."
export GOOGLE_SERVICE_ACCOUNT_JSON='{"type": "service_account", ...}'
export SITE_PASSWORD="1234"
export SECRET_KEY="dev"
python app.py
```

האתר יעלה בכתובת `http://localhost:5000`.

---

## איך זיהוי "ירוק" עובד

האתר קורא את **צבע הרקע של התא הראשון בכל שורה** (עמודה A) ובודק אם הוא נראה כמו גוון ירוק (הערוץ הירוק דומיננטי משמעותית על פני האדום והכחול). אם תגלה שהזיהוי לא מדויק (למשל אם הירוק שאתה משתמש בו הוא גוון חלש מאוד, או שיש שורות שצבועות בטעות), אפשר לכוון את הרגישות בפונקציה `is_green` בקובץ `app.py`.

## מבנה הפרויקט

```
sheets-app/
├── app.py                 # השרת (Flask) — כל הלוגיקה והתקשורת עם גוגל שיטס
├── requirements.txt        # ספריות פייתון נדרשות
├── templates/
│   ├── index.html          # עמוד האפליקציה הראשי
│   └── login.html          # עמוד כניסה בסיסמה
└── static/
    ├── style.css            # עיצוב
    └── script.js            # לוגיקת הצד-לקוח (חיפוש, עריכה, שמירה)
```

## הרחבות עתידיות אפשריות

- הוספת טאבים/סוגי הפקה נוספים מעבר ל"פנסיוני" ו"פרט" — פשוט הוסף שורה למילון `SHEET_NAMES` ב-`app.py`.
- הצגת היסטוריית שינויים (log) של עדכונים שבוצעו דרך האתר.
- ולידציה של פורמט תעודת זהות (9 ספרות + ביקורת) בצד הלקוח.
