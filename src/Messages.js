/**
 * Email texts: student notices, office notices, assignment reminders and the Friday report.
 * Pure functions (no Apps Script services). Every builder returns {subject, text, html}.
 */

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function textToHtml_(text) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">' +
    text.split(/\n{2,}/).map(function (p) {
      var lines = p.split('\n');
      if (lines.every(function (l) { return /^• /.test(l); })) {
        return '<ul style="margin:0 0 12px 18px;padding:0">' + lines.map(function (l) { return '<li>' + esc_(l.slice(2)) + '</li>'; }).join('') + '</ul>';
      }
      return '<p style="margin:0 0 12px">' + lines.map(esc_).join('<br>') + '</p>';
    }).join('') + '</div>';
}

/** "ENG 111 (Section 01) — Monday, October 5, 2026, 9:00 AM – 1:00 PM (in person)" pieces. */
function classLabel(cls) {
  return cls.course + (cls.section ? ' (' + cls.section + ')' : '');
}

function classTime(cls) {
  return minToLabel(cls.start) + ' – ' + minToLabel(cls.end);
}

function signature_(cfg) {
  return [cfg.taName || 'Teacher Assistant', cfg.taTitle || 'Teacher Assistant', cfg.replyTo || ''].filter(String).join('\n');
}

function medicalExcuseText_(cfg) {
  var office = cfg.officeName || 'the main office';
  return 'If you missed class for a medical reason, please send your medical excuse to me or to ' + office +
    '. Do not send it to your professor. The excuse must include:\n' +
    '• Your full name\n' +
    '• A phone number for the doctor or hospital, so our office can contact them and verify it\n' +
    '• If the appointment was for someone else who could not go on their own, the note must say that you were there as their guardian or companion\n\n' +
    'The office verifies the excuse and updates your attendance within one week.';
}

function summaryLines_(t, cfg) {
  var c = rulesConfig_(cfg);
  var lines = [
    '• Current absences: ' + t.effective + ' of ' + c.maxAbsences + ' allowed' +
      (t.tardyAbsences ? ' (' + t.absences + ' absence' + (t.absences === 1 ? '' : 's') + ' + ' + t.tardyAbsences + ' from tardies)' : ''),
    '• Absences remaining: ' + Math.max(0, t.remaining),
    '• Tardies: ' + t.tardies + ' (every ' + c.tardiesPerAbsence + ' tardies count as 1 absence)',
    '• Current attendance: ' + t.pct + '% (minimum required: ' + c.minAttendancePct + '%)'
  ];
  if (t.excused) lines.push('• Excused: ' + t.excused);
  return lines.join('\n');
}

function standingSentence_(t, cfg) {
  var c = rulesConfig_(cfg);
  if (t.state === 'failing') {
    return 'You now have more than ' + c.maxAbsences + ' absences, so your attendance is below the ' + c.minAttendancePct +
      '% required to pass this course. Please contact me or the office as soon as possible.';
  }
  if (t.state === 'at-limit') return 'You have no absences left. One more absence (or ' + (c.tardiesPerAbsence - t.tardies % c.tardiesPerAbsence) + ' more tard' + ((c.tardiesPerAbsence - t.tardies % c.tardiesPerAbsence) === 1 ? 'y' : 'ies') + ') will put you below ' + c.minAttendancePct + '%.';
  return 'You need at least ' + c.minAttendancePct + '% attendance to pass. Over the ' + c.totalSessions + '-week course, that means no more than ' + c.maxAbsences + ' absences.';
}

/**
 * Notice to a student after a class.
 * kind: 'Absent' | 'Tardy' | 'LeftEarly'
 * p: {kind, student:{name,email}, cls:{course,section,start,end,mode}, date, tally, cfg, minutesLate}
 */
function buildStudentNotice(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg), s = p.student, cls = p.cls, t = p.tally;
  var when = longDate(p.date) + ', ' + classTime(cls);
  var first = String(s.name || '').split(/\s+/)[0] || 'student';
  var what, subjectWord;
  if (p.kind === 'Tardy') {
    subjectWord = 'Tardy';
    what = 'You were marked TARDY for ' + classLabel(cls) + ' on ' + when + '.' +
      (p.minutesLate ? ' You arrived ' + p.minutesLate + ' minutes after the start of class.' : '') +
      '\n\nStudents who arrive in the first ' + c.presentUntilMin + ' minutes are present, from minute ' + (c.presentUntilMin + 1) +
      ' to ' + c.tardyUntilMin + ' they are tardy, and from minute ' + (c.tardyUntilMin + 1) + ' on they are absent. Every ' +
      c.tardiesPerAbsence + ' tardies count as 1 absence.';
  } else if (p.kind === 'LeftEarly') {
    subjectWord = 'Absence (left early)';
    what = 'You were marked ABSENT for ' + classLabel(cls) + ' on ' + when + '. You checked in, but you left before the end of class. ' +
      'Leaving before the time set by the professor changes your attendance from Present to Absent.';
  } else {
    subjectWord = 'Absence';
    what = 'You were marked ABSENT for ' + classLabel(cls) + ' on ' + when + '.';
  }
  var text = 'Dear ' + first + ',\n\n' + what + '\n\n' +
    'Your attendance in this course:\n' + summaryLines_(t, cfg) + '\n\n' +
    standingSentence_(t, cfg) + '\n\n' +
    medicalExcuseText_(cfg) + '\n\n' +
    'Remember: if you check in and then leave before class ends, you will be marked absent.\n\n' +
    'Best regards,\n' + signature_(cfg);
  return {
    subject: 'Attendance notice – ' + classLabel(cls) + ' – ' + subjectWord + ' on ' + longDate(p.date),
    text: text,
    html: textToHtml_(text)
  };
}

/**
 * Follow-up about a student's standing in a course (not about one class).
 * level: 'below80' (losing the course) | 'below100' (has absences or tardies, still passing)
 * p: {level, student:{name} (empty name → "Dear student,"), cls, tally, cfg, dates: ['yyyy-mm-dd' of absences/tardies]}
 */
function buildStandingNotice(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg), t = p.tally, cls = p.cls;
  var first = String((p.student || {}).name || '').split(/\s+/)[0] || 'student';
  var missed = (p.dates || []).length ? '\n\nClasses missed or late: ' + p.dates.map(function (d) { return longDate(d).replace(/, \d{4}$/, ''); }).join(', ') + '.' : '';
  var body, subject;
  if (p.level === 'below80') {
    subject = 'Attendance – ' + classLabel(cls) + ' – You are below ' + c.minAttendancePct + '%';
    body = 'I am writing because your attendance in ' + classLabel(cls) + ' is now ' + t.pct + '%, below the ' + c.minAttendancePct +
      '% minimum required to pass the course. You have ' + t.effective + ' counted absences and the limit is ' + c.maxAbsences + '.' + missed +
      '\n\nYour attendance in this course:\n' + summaryLines_(t, cfg) +
      '\n\nPlease contact me or ' + (cfg.officeName || 'the main office') + ' as soon as possible to talk about your options. ' +
      'If any of these absences was for a medical reason, an accepted medical excuse removes it from your count.';
  } else {
    subject = 'Attendance – ' + classLabel(cls) + ' – Your current attendance is ' + t.pct + '%';
    var left = Math.max(0, t.remaining);
    body = 'This is a reminder about your attendance in ' + classLabel(cls) + '. Your attendance is ' + t.pct + '% and you have ' +
      (left ? left + ' absence' + (left === 1 ? '' : 's') + ' left' : 'no absences left') + ' before you fall below the ' + c.minAttendancePct +
      '% you need to pass.' + missed +
      '\n\nYour attendance in this course:\n' + summaryLines_(t, cfg) + '\n\n' + standingSentence_(t, cfg);
  }
  var text = 'Dear ' + first + ',\n\n' + body + '\n\n' + medicalExcuseText_(cfg) + '\n\nBest regards,\n' + signature_(cfg);
  return { subject: subject, text: text, html: textToHtml_(text) };
}

/** To the office when a student checks in without their ID more than the allowed times. */
function buildNoIdNotice(p) {
  var cfg = p.cfg || {}, s = p.student, cls = p.cls;
  var text = 'Hello,\n\n' + s.name + (s.id ? ' (ID ' + s.id + ')' : '') + ' came to ' + classLabel(cls) + ' on ' +
    longDate(p.date) + ', ' + classTime(cls) + ' without their student ID. Attendance was recorded manually.\n\n' +
    'This is time number ' + p.count + ' this term (the limit is ' + rulesConfig_(cfg).noIdLimit + ').\n\n' +
    'Dates without ID: ' + p.dates.join(', ') + '\n\n' +
    'Thank you,\n' + signature_(cfg);
  return { subject: 'Student without ID – ' + s.name + ' – ' + classLabel(cls), text: text, html: textToHtml_(text) };
}

/** Reminder to the students of a class about an assignment. */
function buildAssignmentReminder(p) {
  var cfg = p.cfg || {}, a = p.assignment, cls = p.cls;
  var whenLeft = p.daysLeft === 0 ? 'today' : p.daysLeft === 1 ? 'tomorrow' : 'in ' + p.daysLeft + ' days';
  var text = 'Hello everyone,\n\nThis is a reminder that "' + a.title + '" for ' + classLabel(cls) + ' is due ' + whenLeft +
    ' (' + longDate(a.due) + ').' + (a.notes ? '\n\n' + a.notes : '') +
    '\n\nIf you have questions, reply to this email.\n\nBest regards,\n' + signature_(cfg);
  return { subject: 'Reminder: ' + a.title + ' – due ' + longDate(a.due), text: text, html: textToHtml_(text) };
}

/**
 * Friday report.
 * p: {classes:[cls], students:[{id,name,email,classId}], records:[{classId,studentId,date,status,excuse,excuseDate,name}],
 *     weekStart, weekEnd, today, cfg}
 */
function buildWeeklyReport(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg);
  // Totals as they stood at the end of that week (so an old week's report stays the same later).
  var totals = tally(p.records.filter(function (r) { return !r.date || r.date <= p.weekEnd; }), cfg);
  var html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">',
    '<h2 style="margin:0 0 4px">Weekly attendance report</h2>',
    '<p style="margin:0 0 16px;color:#555">Week of ' + esc_(longDate(p.weekStart)) + ' – ' + esc_(longDate(p.weekEnd)) +
    (p.week ? ' · Week ' + p.week + ' of ' + c.totalSessions : '') + '</p>'];
  var text = ['WEEKLY ATTENDANCE REPORT', 'Week of ' + longDate(p.weekStart) + ' – ' + longDate(p.weekEnd), ''];
  var th = 'style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;background:#f4f4f4"';
  var td = 'style="padding:4px 8px;border-bottom:1px solid #eee"';
  var counts = { missed: 0, risk: 0 };

  p.classes.forEach(function (cls) {
    var roster = p.students.filter(function (s) { return s.classId === cls.id; });
    var nameOf = {}, orderOf = {};
    roster.forEach(function (s) { nameOf[s.id] = (s.order ? '#' + s.order + ' ' : '') + s.name; orderOf[s.id] = s.order || 1e6; });
    var thisWeek = p.records.filter(function (r) { return r.classId === cls.id && r.date >= p.weekStart && r.date <= p.weekEnd; });
    var wc = { P: 0, T: 0, A: 0, E: 0 };
    thisWeek.forEach(function (r) { var k = /^accepted$/i.test(r.excuse || '') ? 'E' : String(r.status || '').charAt(0); if (k in wc) wc[k]++; });
    var week = p.records.filter(function (r) {
      return r.classId === cls.id && r.date >= p.weekStart && r.date <= p.weekEnd &&
        /^(absent|tardy)$/i.test(r.status) && !/^accepted$/i.test(r.excuse || '');
    });
    var risk = roster.map(function (s) {
      return { s: s, t: totals[cls.id + '|' + s.id] || emptyTally(cfg) };
    }).filter(function (x) { return x.t.state !== 'ok'; })
      .sort(function (a, b) { return b.t.effective - a.t.effective || (a.s.order || 1e6) - (b.s.order || 1e6) || a.s.name.localeCompare(b.s.name); });
    var pending = p.records.filter(function (r) { return r.classId === cls.id && /^received$/i.test(r.excuse || '') && r.date <= p.weekEnd; });
    counts.missed += week.filter(function (r) { return /^absent$/i.test(r.status); }).length;
    counts.risk += risk.filter(function (x) { return x.t.state === 'failing'; }).length;

    html.push('<h3 style="margin:20px 0 4px">' + esc_(classLabel(cls)) + '</h3>',
      '<p style="margin:0 0 8px;color:#555">' + esc_(DAY_NAMES[dayIndex(cls.day)] || cls.day) + ' ' + esc_(classTime(cls)) +
      ' · ' + esc_(cls.mode || '') + (cls.professor ? ' · Prof. ' + esc_(cls.professor) : '') + ' · ' + roster.length + ' students</p>');
    text.push('== ' + classLabel(cls) + ' — ' + (DAY_NAMES[dayIndex(cls.day)] || cls.day) + ' ' + classTime(cls) + ' ==');
    var summary = thisWeek.length ? wc.P + ' present · ' + wc.T + ' tardy · ' + wc.A + ' absent' + (wc.E ? ' · ' + wc.E + ' excused' : '')
      : 'No attendance recorded for this week';
    html.push('<p style="margin:0 0 8px"><b>This week:</b> ' + esc_(summary) + '</p>');
    text.push('This week: ' + summary);

    html.push('<p style="margin:8px 0 4px"><b>Absent or tardy this week</b></p>');
    text.push('Absent or tardy this week:');
    if (!thisWeek.length) {
      // No data is not the same as full attendance.
      html.push('<p style="margin:0;color:#a05a00">Not available: no attendance was loaded for this class this week.</p>');
      text.push('  Not available: no attendance loaded this week.');
    } else if (!week.length) { html.push('<p style="margin:0;color:#2e7d32">Nobody. Full attendance.</p>'); text.push('  Nobody.'); }
    else {
      html.push('<table style="border-collapse:collapse;font-size:13px"><tr><th ' + th + '>Student</th><th ' + th + '>Date</th><th ' + th + '>Status</th><th ' + th + '>Excuse</th></tr>');
      week.sort(function (a, b) { return a.date.localeCompare(b.date) || orderOf[a.studentId] - orderOf[b.studentId]; }).forEach(function (r) {
        var nm = nameOf[r.studentId] || r.name || r.studentId;
        html.push('<tr><td ' + td + '>' + esc_(nm) + '</td><td ' + td + '>' + esc_(r.date) + '</td><td ' + td + '>' + esc_(r.status) + (r.leftEarly ? ' (left early)' : '') + '</td><td ' + td + '>' + esc_(r.excuse || '') + '</td></tr>');
        text.push('  ' + nm + ' — ' + r.date + ' — ' + r.status + (r.excuse ? ' (excuse: ' + r.excuse + ')' : ''));
      });
      html.push('</table>');
    }

    html.push('<p style="margin:12px 0 4px"><b>Losing the course or at risk</b></p>');
    text.push('Losing the course or at risk:');
    if (!risk.length) { html.push('<p style="margin:0;color:#2e7d32">Everyone is on track.</p>'); text.push('  Everyone is on track.'); }
    else {
      html.push('<table style="border-collapse:collapse;font-size:13px"><tr><th ' + th + '>Student</th><th ' + th + '>Absences</th><th ' + th + '>Tardies</th><th ' + th + '>Counted absences</th><th ' + th + '>Left</th><th ' + th + '>Attendance</th><th ' + th + '>Status</th></tr>');
      risk.forEach(function (x) {
        var color = x.t.state === 'failing' ? '#c62828' : x.t.state === 'at-limit' ? '#e65100' : '#8d6e00';
        html.push('<tr><td ' + td + '>' + esc_((x.s.order ? '#' + x.s.order + ' ' : '') + x.s.name) + '</td><td ' + td + '>' + x.t.absences + '</td><td ' + td + '>' + x.t.tardies +
          '</td><td ' + td + '>' + x.t.effective + '</td><td ' + td + '>' + Math.max(0, x.t.remaining) + '</td><td ' + td + '>' + x.t.pct +
          '%</td><td ' + td + '><b style="color:' + color + '">' + esc_(STATE_LABEL[x.t.state]) + '</b></td></tr>');
        text.push('  ' + (x.s.order ? '#' + x.s.order + ' ' : '') + x.s.name + ' — ' + x.t.effective + ' counted absences (' + x.t.absences + ' A, ' + x.t.tardies + ' T), ' + x.t.pct + '% — ' + STATE_LABEL[x.t.state]);
      });
      html.push('</table>');
    }

    if (pending.length) {
      html.push('<p style="margin:12px 0 4px"><b>Medical excuses waiting for the office</b></p><ul style="margin:0 0 0 18px;padding:0">');
      text.push('Medical excuses waiting for the office:');
      pending.forEach(function (r) {
        var nm = nameOf[r.studentId] || r.name || r.studentId;
        var late = r.excuseDate && p.today && dayNum(p.today) - dayNum(r.excuseDate) > c.excuseReviewDays;
        html.push('<li>' + esc_(nm) + ' — class of ' + esc_(r.date) + (r.excuseDate ? ', received ' + esc_(r.excuseDate) : '') +
          (late ? ' <b style="color:#c62828">(more than ' + c.excuseReviewDays + ' days)</b>' : '') + '</li>');
        text.push('  ' + nm + ' — class of ' + r.date + (r.excuseDate ? ', received ' + r.excuseDate : '') + (late ? ' (OVERDUE)' : ''));
      });
      html.push('</ul>');
    }
    text.push('');
  });
  html.push('</div>');
  return {
    subject: 'Weekly attendance report – ' + longDate(p.weekStart).replace(/^\w+, /, '') + ' – ' + counts.missed + ' absences, ' + counts.risk + ' losing the course',
    text: text.join('\n'),
    html: html.join('')
  };
}

/* ---------- student emails (Gmail inbox) ---------- */

var MAIL_CATEGORIES = ['medical_excuse', 'absence_notice', 'attendance_question', 'grades_or_assignments', 'zoom_or_tech', 'thanks_or_fyi', 'other'];

var MAIL_CATEGORY_LABEL = {
  medical_excuse: 'Medical excuse', absence_notice: 'Will miss / missed class', attendance_question: 'Attendance question',
  grades_or_assignments: 'Grades / assignments', zoom_or_tech: 'Zoom / tech', thanks_or_fyi: 'Thanks / FYI', other: 'Other'
};

/** What Claude returns for one student email thread (structured output). */
var MAIL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['category', 'needs_reply', 'urgency', 'summary', 'excuse', 'reply'],
  properties: {
    category: { type: 'string', enum: MAIL_CATEGORIES },
    needs_reply: { type: 'boolean', description: 'false only for thanks/FYI messages that need no answer' },
    urgency: { type: 'string', enum: ['high', 'normal', 'low'] },
    summary: { type: 'string', description: 'One short sentence: what the student wants' },
    excuse: {
      type: 'object', additionalProperties: false,
      required: ['is_excuse', 'class_date', 'has_doctor_phone', 'for_someone_else', 'missing'],
      properties: {
        is_excuse: { type: 'boolean', description: 'The student sends (or says they attach) a medical excuse' },
        class_date: { type: 'string', description: 'YYYY-MM-DD of the class the excuse is for, or "" if not clear' },
        has_doctor_phone: { type: 'boolean' },
        for_someone_else: { type: 'boolean', description: 'The appointment was for another person (guardian/companion)' },
        missing: { type: 'array', items: { type: 'string' }, description: 'What the excuse still needs, per the rules' }
      }
    },
    reply: { type: 'string', description: 'The full reply, ready to paste, signed by the TA' }
  }
};

/** Strip quoted older messages ("On ... wrote:", "> ...") and signatures noise from a plain-text email body. */
function cleanMailBody(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^On .{5,200}wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: .+/.test(l) && out.length) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Without AI: a rough category from the words used. */
function mailCategoryGuess(text, attachments) {
  var t = String(text || '').toLowerCase();
  if (/(doctor|medical|hospital|clinic|urgent care|sick|illness|appointment|excuse|note from|surgery|emergency room|covid|fever)/.test(t)) {
    return { category: 'medical_excuse', isExcuse: /(excuse|note|attach|doctor'?s? (note|letter))/.test(t) || (attachments || []).length > 0 };
  }
  if (/(won'?t be able|will not be able|can'?t (make|attend|come)|miss(ed)? (the )?class|absent|absence|late)/.test(t)) return { category: 'absence_notice', isExcuse: false };
  if (/(attendance|marked|present|tardy)/.test(t)) return { category: 'attendance_question', isExcuse: false };
  if (/(grade|assignment|homework|essay|paper|quiz|exam|due|syllabus)/.test(t)) return { category: 'grades_or_assignments', isExcuse: false };
  if (/(zoom|link|password|meeting id|audio|camera|connection)/.test(t)) return { category: 'zoom_or_tech', isExcuse: false };
  if (/^(\s*(thank(s| you)|ok|okay|got it|great|perfect)\b)/.test(t) && t.length < 200) return { category: 'thanks_or_fyi', isExcuse: false };
  return { category: 'other', isExcuse: false };
}

/** The rules Claude must follow when writing to a student. */
function mailSystemPrompt(cfg) {
  var c = rulesConfig_(cfg);
  return 'You help ' + (cfg.taName || 'the Teacher Assistant') + ', a Teacher Assistant at a college, answer emails from students. ' +
    'You read the thread and the student\'s attendance record, sort the email, and write a reply the TA can paste as is.\n\n' +
    'Attendance rules of every course:\n' +
    '- The course has ' + c.totalSessions + ' weekly classes; each absence is ' + Math.round(100 / c.totalSessions) + '% of attendance. ' +
    'Students need at least ' + c.minAttendancePct + '%, so at most ' + c.maxAbsences + ' absences.\n' +
    '- Minutes 0-' + c.presentUntilMin + ' after the start: Present. Minutes ' + (c.presentUntilMin + 1) + '-' + c.tardyUntilMin +
    ': Tardy. Later: Absent. Every ' + c.tardiesPerAbsence + ' tardies count as 1 absence. Checking in and leaving before the end counts as Absent.\n' +
    '- ' + medicalExcuseText_(cfg).replace(/\n+/g, ' ') + '\n\n' +
    'How to reply:\n' +
    '- Warm, brief and professional. Use the student\'s first name. Reply in the language the student wrote in.\n' +
    '- Use only the facts given (dates, statuses, counts). Never invent dates, grades or decisions.\n' +
    '- The TA does not excuse absences or change grades: the office verifies medical excuses within a week. ' +
    'If an excuse arrived, thank them, say it was received and goes to the office for verification, and list anything it still needs ' +
    '(full name, doctor or hospital phone number, guardian/companion note when it was for someone else).\n' +
    '- Questions about grades or course content go to the professor; questions about attendance are answered by the TA.\n' +
    '- If the student says they will miss class, remind them how many absences they have left.\n' +
    '- End with this signature, exactly:\n' + signature_(cfg);
}

/**
 * The user message for one thread.
 * p: {student:{name}, classes:[{label, records:[{date,status,excuse}], tally}], messages:[{from, mine, date, body, attachments}],
 *     today, instruction}
 */
function mailUserPrompt(p) {
  var cfg = p.cfg || {}, c = rulesConfig_(cfg);
  var lines = ['Today is ' + p.today + '.', '', 'Student: ' + p.student.name];
  (p.classes || []).forEach(function (k) {
    var t = k.tally;
    lines.push('', 'Class: ' + k.label + ' (' + k.when + ')');
    lines.push('Attendance so far: ' + (k.records.length ? k.records.map(function (r) {
      return r.date + ' ' + (r.status || 'no status') + (r.excuse ? ' (excuse ' + r.excuse + ')' : '');
    }).join('; ') : 'no classes recorded yet'));
    lines.push('Counted absences: ' + t.effective + ' of ' + c.maxAbsences + ' (' + t.absences + ' absences, ' + t.tardies +
      ' tardies) · absences left: ' + Math.max(0, t.remaining) + ' · attendance ' + t.pct + '%');
  });
  if (!(p.classes || []).length) lines.push('(This sender is not on any class roster.)');
  lines.push('', 'Email thread, oldest first:');
  p.messages.forEach(function (m) {
    lines.push('', '--- ' + (m.mine ? 'TA' : 'Student') + ' · ' + m.date + (m.attachments.length ? ' · attachments: ' + m.attachments.join(', ') : '') + ' ---');
    lines.push(m.body.slice(0, 4000));
  });
  if (p.instruction) lines.push('', 'The TA asks for the reply: ' + p.instruction);
  return lines.join('\n');
}

/** Without AI: a simple reply to adapt. */
function mailTemplateReply(p) {
  var cfg = p.cfg || {}, first = String(p.student.name || '').split(/\s+/)[0] || 'there', c = rulesConfig_(cfg);
  var body;
  if (p.category === 'medical_excuse') {
    body = 'Thank you for sending your medical excuse. I received it and I will pass it to ' + (cfg.officeName || 'the main office') +
      ', which verifies it and updates your attendance within one week.\n\nPlease make sure it includes your full name and a phone number ' +
      'for the doctor or hospital. If the appointment was for someone else, the note must say that you were there as their guardian or companion.';
  } else if (p.category === 'absence_notice' && p.classes && p.classes[0]) {
    var t = p.classes[0].tally;
    body = 'Thank you for letting me know. Right now you have ' + t.effective + ' of ' + c.maxAbsences + ' absences in ' + p.classes[0].label +
      ', so you have ' + Math.max(0, t.remaining) + ' left. Remember you need at least ' + c.minAttendancePct + '% attendance to pass.\n\n' + medicalExcuseText_(cfg);
  } else {
    body = 'Thank you for your email. ';
  }
  return 'Hi ' + first + ',\n\n' + body + '\n\nBest regards,\n' + signature_(cfg);
}
