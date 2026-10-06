// Joins src/*.js into one file to paste into Apps Script (Code.gs). Run: npm run bundle
const fs = require('fs');
const path = require('path');

const ORDER = ['Rules.js', 'Parsers.js', 'Messages.js', 'Code.js'];

function bundle() {
  const src = path.join(__dirname, '..', 'src');
  return '/**\n * TA Attendance — paste this whole file into Apps Script as Code.gs.\n' +
    ' * Generated from src/ by `npm run bundle`. Do not edit here.\n */\n\n' +
    ORDER.map(f => '/* ===== ' + f + ' ===== */\n\n' + fs.readFileSync(path.join(src, f), 'utf8').trim() + '\n').join('\n');
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'dist', 'TA-Attendance.gs'), bundle());
  console.log('dist/TA-Attendance.gs written');
}

module.exports = { bundle };
