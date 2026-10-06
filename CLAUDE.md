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

## Emails go out from Populi
Default `Email mode = POPULI`: notices become rows in the "Follow-ups" sheet (roster # in Populi order, names, subject,
message, the 6 visibility roles). Students with the same class/date/kind/numbers share one row ("Dear student,").
No Populi API (Diego cannot get a key). Students' order = Populi roster order (`Order` column), never alphabetical.

## Reading Zoom screenshots for Diego (weekly)
Diego sends screenshots of the Zoom participant list (6:15, 6:31, before leaving) + class + date. Then:
1. Read every name; drop Diego (TA) and the professor. Compare the count with Zoom's total minus 2.
2. Match names to that class's roster (Students sheet / Grid, Populi order). List names you can't match; don't guess.
3. In the 6:15 shot → Present; only from 6:31 → Tardy; in neither → leave out (the import marks them Absent);
   in an earlier shot but not the last one → Absent with note "left before the end".
4. Write `Zoom screenshots YYYY-MM-DD [C#].csv` with header `Student,Date,Status,Notes` (names exactly as on the
   roster) and put it in the Drive "TA Inbox" folder (Google Drive connector) or hand it to Diego. Never commit it.
5. Show Diego the result in Populi order (# · name · P/T/A) so he can tick the participation boxes.

## Layout
- `src/Rules.js`, `src/Parsers.js`, `src/Messages.js`: pure functions, no Apps Script services (tested in Node).
- `src/Code.js`: Apps Script glue (Sheets tables read with `getDisplayValues`, all sheets plain text, Drive inbox, Gmail, triggers).
- All `src/*.js` share one global scope in Apps Script: use `var`/function declarations at top level, no `require`/`export`.
- `tests/gas-mock.js` runs the real `src/` files in a VM with fake SpreadsheetApp/DriveApp/GmailApp/ScriptApp.

## Before delivering
`npm test` must pass. Add a test in `tests/flow.test.js` for any new behavior of Code.js.
Never commit student data (CSV/XLSX exports).
