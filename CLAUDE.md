# Teacher Assistant IVY — instructions for Claude

Attendance automation for Diego, a Teacher Assistant (dgomez230@ivy.edu). Talk to Diego in Spanish; the product
(sheet headers, menu, emails to students) is in English.

## The rules (do not change without Diego)
- 10-week course, one session per class per week; each absence = 10%; minimum 80% → max 2 absences.
- Minutes 0–15 Present, 16–30 Tardy, 31+ Absent. 3 tardies = 1 absence.
- Online (Zoom) classes, HA 105 and SB 100, have NO Tardy (Diego, 2026-10-09): minutes 0–30 Present, 31+ Absent
  (`cfgForClass` → `noTardy`; `applyEntries_` and `applyManualFlags_` turn any Tardy in a Zoom class into Present).
- Checking in and leaving before the end → Absent.
- More than 2 check-ins without ID → notify the office.
- One email per absence/tardy: class, date and time, current and remaining absences, 80% minimum, medical excuse
  rules (to the TA or office, never the professor; student name + doctor/hospital phone; guardian/companion note;
  verified within a week). Reply-To is the TA's academic email.
- Friday report per class: who missed this week and who is losing the course.
- Zoom (Diego stays 1 hour): screenshots at 15 min, 31 min (both → Present online) and before leaving (the "Absent" folder).
  Seen at 15 → Present even if missing at 31, if the last shot confirms. Seen earlier but not in the last shot →
  Absent with a note. Only in the last shot, or never → Absent. Populi online only has present/absent (P and T = ticked).
- Chat: students type their name when they join; the message time (from the real start) says Present (by minute 30) or after 30 (Absent).
  Chat never proves someone is still connected at the end (it stays on screen).
- Real start per class and date: "Sessions → Actual start" or "start 7pm" in the folder name. All cut-offs move.
- Names: exact or clearly similar (second name, Z/S, typos) → automatic; two possible students or weak → "Review"
  sheet; Diego answers with the # (Populi order), the name or "ignore"; the Zoom name is saved as an alias and the class
  re-runs from the saved OCR text (ocr.json). Notices for that class wait while questions are open.

## Classes
C1 HA 103 Mon 9:00–1:00 (Room 300) · C2 OT 215 Mon 1:30–5:30 (Room 304) · C3 HA 105 Mon 6–10 pm Zoom ·
C4 SB 100 Thu 9:00–1:00 Zoom. 2026 Fall Quarter: week 1 = Oct 5–9, week 10 = Dec 7–11. Campus: Vienna, VA (Eastern).
Diego's TA hours: Mon 9:00 AM–2:30 PM, Mon 6–7 PM (first hour of HA 105), Thu 9:00 AM–1:00 PM.
In person attendance is scanned in Populi (barcode); Diego uploads a screenshot of Populi already marked. Zoom attendance: screenshots of the participant list read by
Google Drive OCR in Apps Script (`handleScreenshotFolder_`, free), optionally Claude vision (`aiReadShot_`, when the
API key is set and "Read screenshots with AI" = Yes), or a Zoom participants report.

## Emails go out from Populi
Default `Email mode = POPULI`: notices become rows in the "Follow-ups" sheet (roster # in Populi order, names, subject,
message, the 6 visibility roles). Students with the same class/date/kind/numbers share one row ("Dear student,").
No Populi API (Diego cannot get a key). Students' order = Populi roster order (`Order` column), never alphabetical.

## Reading Zoom screenshots for Diego (only as a fallback — the OCR does this for free)
Prefer telling Diego to drop the week folder ("HA 105 - Week 01 - 10.05.26" / "1. Present" "2. Tardy" "3. Absent")
in TA Inbox. If he still sends screenshots here, ask for the participant list cropped to the names (fewer tokens). Then:
1. Read every name; drop Diego (TA) and the professor. Compare the count with Zoom's total minus 2.
2. Match names to that class's roster (Students sheet / Grid, Populi order). List names you can't match; don't guess.
3. In the 6:15 or 6:31 shot → Present (online classes have no Tardy); in neither → leave out (the import marks them Absent);
   in an earlier shot but not the last one → Absent with note "left before the end".
4. Write `Zoom screenshots YYYY-MM-DD [C#].csv` with header `Student,Date,Status,Notes` (names exactly as on the
   roster) and put it in the Drive "TA Inbox" folder (Google Drive connector) or hand it to Diego. Never commit it.
5. Show Diego the result in Populi order (# · name · P/T/A) so he can tick the participation boxes.

## Layout
- `src/Rules.js`, `src/Parsers.js`, `src/Messages.js`: pure functions, no Apps Script services (tested in Node).
- `src/Code.js`: Apps Script glue (Sheets tables read with `getDisplayValues`, all sheets plain text, Drive inbox, Gmail, triggers).
- All `src/*.js` share one global scope in Apps Script: use `var`/function declarations at top level, no `require`/`export`.
- `src/Dashboard.html`: the panel (TA Attendance → Open dashboard), talks to the `api*` functions in Code.js via
  google.script.run (only functions without a trailing `_` are callable). `npm run preview` renders it with made-up data.
- Dashboard extras: `tasks_()` builds the Home to-do list (missing attendance by schedule, questions, follow-ups, excuses
  over 7 days, Populi boxes for Zoom); `apiSetRecord` is the one way the panel edits a student's record (status, left early,
  no ID, excuse Received/Accepted/Rejected, office → Present) and always marks it `Manual`.
- Speed: `apiOverview`/`apiClass` are cached (CacheService, generation bumped by every `save_`/`appendRow_`/onEdit);
  dashboard actions use `runLight_` (no inbox, no Grid/Summary rewrite). The page shows cached data first (`fresh()`),
  prefetches classes, and edits are optimistic.
- Screenshots can be dropped in the dashboard (`apiUploadShot` → OCR → `ocr.json` in the class folder under
  TA Inbox/Processed, then `apiAnalyzeSession`); `apiClearShots` removes one moment.
- Student names: `apiSetStudentNames` (student page → Edit name / Zoom names) renames (old name kept as a Zoom name),
  sets Zoom names for the same Populi ID in every class, logs to Roster changes and re-reads those classes' screenshots.
- `table_()` adds missing columns from `SHEETS` on its own (and creates a missing sheet), so updates don't need "Set up" again.
- AI: `aiJson_` calls the Claude Messages API with UrlFetchApp (no SDK in Apps Script): structured output (`output_config.format`),
  model from Config (`claude-opus-5-5`), key in script properties `ANTHROPIC_API_KEY` (menu "Set Claude API key"), never in the sheet.
  Screenshots: `aiShotPrompt`/`AI_SHOT_SCHEMA`/`aiObservations` in Parsers.js; results saved per image in `ocr.json` (`ai`, `files`),
  OCR stays as the fallback. Any AI error falls back silently to OCR / templates.
- Student emails: `scanMail_` (in `runAll_`) reads Gmail `in:inbox newer_than:Nd`, keeps one row per thread in "Mail", sorts and drafts with
  `MAIL_SCHEMA`/`mailSystemPrompt`/`mailUserPrompt` (Messages.js), marks excuses `Received` (`markExcuseFromMail_`), labels TA/Needs reply
  and TA/Medical excuse. Never sends to students: replies are Gmail drafts or copy/paste.
- Speed (2026-10-09): `apiAll` serves a ready snapshot (script cache + `TA Inbox/Processed/dashboard-snapshot.json`), valid while the
  generation (`gen` script property, bumped by every write) is unchanged and for 20 min; `tick` and `claudeCheck` rebuild it.
  Screenshot uploads: `apiPrepareShots` once, then `apiUploadShot(..., subId)` without the lock, and `apiAnalyzeSession(..., shots)`
  registers the batch (one ocr.json write, one claude-job.json). `claudeCheck` (every 5 min) applies Claude's results; the waiting
  folders are listed in the `claudeWaiting` script property.
- Speed: `apiAll` returns every screen's data from one `load_()`; the dashboard seeds its caches from it, skips re-asking for 60 s,
  and after any write (non-READS call) marks everything stale and reloads `apiAll` in the background.
- `tests/gas-mock.js` runs the real `src/` files in a VM with fake SpreadsheetApp/DriveApp/GmailApp/ScriptApp.

## Before delivering
`npm test` must pass. After changing src/, run `npm run bundle` (dist/TA-Attendance.gs is what Diego pastes). Add a test in `tests/flow.test.js` for any new behavior of Code.js.
Never commit student data (CSV/XLSX exports).
