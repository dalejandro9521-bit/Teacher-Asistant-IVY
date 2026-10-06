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
