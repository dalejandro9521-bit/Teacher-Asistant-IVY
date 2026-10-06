# Teacher Assistant IVY — instructions for Claude

Attendance automation for Diego, a Teacher Assistant (dgomez230@ivy.edu). Talk to Diego in Spanish; the product
(sheet headers, menu, emails to students) is in English.

## The rules (do not change without Diego)
- 10-week course, one session per class per week; each absence = 10%; minimum 80% → max 2 absences.
- Minutes 0–15 Present, 16–30 Tardy, 31+ Absent. 3 tardies = 1 absence.
- Checking in and leaving before the end → Absent.
- More than 2 check-ins without ID → notify the office.
- One email per absence/tardy: class, date and time, current and remaining absences, 80% minimum, medical excuse
  rules (to the TA or office, never the professor; student name + doctor/hospital phone; guardian/companion note;
  verified within a week). Reply-To is the TA's academic email.
- Friday report per class: who missed this week and who is losing the course.

## Classes
C1 Mon 9:00–1:00 in person · C2 Mon 1:30–2:30 in person · C3 Mon 6–7 pm Zoom · C4 Thu 9–10 Zoom.
In person attendance is scanned in Populi (barcode); Zoom attendance comes from the participants report.

## Layout
- `src/Rules.js`, `src/Parsers.js`, `src/Messages.js`: pure functions, no Apps Script services (tested in Node).
- `src/Code.js`: Apps Script glue (Sheets tables read with `getDisplayValues`, all sheets plain text, Drive inbox, Gmail, triggers).
- All `src/*.js` share one global scope in Apps Script: use `var`/function declarations at top level, no `require`/`export`.
- `tests/gas-mock.js` runs the real `src/` files in a VM with fake SpreadsheetApp/DriveApp/GmailApp/ScriptApp.

## Before delivering
`npm test` must pass. Add a test in `tests/flow.test.js` for any new behavior of Code.js.
Never commit student data (CSV/XLSX exports).
