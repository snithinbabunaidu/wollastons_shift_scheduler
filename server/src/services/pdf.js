const db = require('../db/knex');
const path = require('path');
const fs = require('fs');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = ['morning', 'afternoon', 'night'];

const COLORS = {
  headerBg: '#4A42C8',
  headerText: '#FFFFFF',
  // Period-specific colors for name text
  morningName: '#D4690E',       // warm orange for morning names
  afternoonName: '#1565C0',     // blue for afternoon names
  nightName: '#6A1B9A',         // purple for night names
  // Period header backgrounds
  morningHeaderBg: '#FFF3E0',
  morningHeaderText: '#BF360C',
  afternoonHeaderBg: '#E3F2FD',
  afternoonHeaderText: '#0D47A1',
  nightHeaderBg: '#EDE7F6',
  nightHeaderText: '#4A148C',
  // General
  cellText: '#1A1A2E',
  timeText: '#37374F',
  traineeTag: '#8888AA',
  borderColor: '#BCBCD4',
  altRowBg: '#F7F5FF',
  whiteBg: '#FFFFFF',
  emptySlot: '#A0A0BE',
  accentPurple: '#4A42C8',
  orderTagColor: '#E8A800',
  summaryAltBg: '#F3F0FF',
  totalRowBg: '#E0DBFF',
  totalRowText: '#2E1A8A',
  // Hours summary bar colors
  barGreen: '#22C55E',
  barAmber: '#F59E0B',
  barRed: '#EF4444',
};

function formatTime(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 7;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

function parseRoles(roleJson) {
  if (!roleJson) return [];
  if (Array.isArray(roleJson)) return roleJson;
  try { return JSON.parse(roleJson); } catch { return roleJson ? [roleJson] : []; }
}

function hasManagerRole(roles, period) {
  return roles.some(r => r === `${period}_manager`);
}

function getLogoBase64() {
  try {
    const logoPath = path.join(__dirname, 'wollys-logo.png');
    if (fs.existsSync(logoPath)) {
      const data = fs.readFileSync(logoPath);
      return 'data:image/png;base64,' + data.toString('base64');
    }
  } catch (e) {
    console.error('Could not load logo:', e.message);
  }
  return null;
}

// Get the name color based on which period the employee is assigned to
function getNameColor(period) {
  switch (period) {
    case 'morning': return COLORS.morningName;
    case 'afternoon': return COLORS.afternoonName;
    case 'night': return COLORS.nightName;
    default: return COLORS.cellText;
  }
}

async function generatePDF(weekStart) {
  const schedules = await db('schedules')
    .where({ week_start_date: weekStart })
    .leftJoin('employees', 'schedules.employee_id', 'employees.id')
    .select(
      'schedules.*',
      'employees.name as employee_name',
      'employees.is_trainee',
      'employees.role as employee_role',
      'employees.employment_type',
      'employees.max_hours'
    )
    .orderBy(['schedules.day_of_week', 'schedules.shift_period', 'schedules.slot_index']);

  const shiftConfigs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);
  const allEmployees = await db('employees').where({ active: true });

  let orderDaysRows = [];
  try { orderDaysRows = await db('order_days'); } catch (e) { }
  const orderDaysMap = { ag: [], us: [] };
  for (const row of orderDaysRows) {
    orderDaysMap[row.order_type].push(row.day_of_week);
  }

  // Build schedule data
  const scheduleData = {};
  for (const s of schedules) {
    const key = `${s.day_of_week}-${s.shift_period}`;
    if (!scheduleData[key]) scheduleData[key] = [];
    scheduleData[key].push(s);
  }

  // Calculate hours per employee
  const employeeHours = {};
  for (const s of schedules) {
    if (s.employee_id) {
      const hours = calcHours(s.start_time, s.end_time);
      const roles = parseRoles(s.employee_role);
      if (!employeeHours[s.employee_id]) {
        employeeHours[s.employee_id] = {
          name: s.employee_name, hours: 0, is_trainee: s.is_trainee,
          roles, employment_type: s.employment_type, max_hours: s.max_hours,
        };
      }
      employeeHours[s.employee_id].hours += hours;
    }
  }

  const logoBase64 = getLogoBase64();
  const content = [];

  // ===== PAGE 1: Sunday - Wednesday =====
  content.push(buildHeader(logoBase64, weekStart));
  content.push({ text: '', margin: [0, 4] });
  for (let day = 0; day <= 3; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 3) content.push({ text: '', margin: [0, 3] });
  }

  // ===== PAGE 2: Thursday - Saturday =====
  content.push({ text: '', pageBreak: 'before' });
  content.push(buildHeader(logoBase64, weekStart, true));
  content.push({ text: '', margin: [0, 4] });
  for (let day = 4; day <= 6; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 6) content.push({ text: '', margin: [0, 3] });
  }

  // ===== PAGES 3-4: Hours Summary (split into 2 pages) =====
  const summaryPages = buildSummaryPages(employeeHours, allEmployees, logoBase64, weekStart);
  for (const page of summaryPages) {
    content.push(page);
  }

  return new Promise((resolve) => {
    const PdfMake = require('pdfmake/build/pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts');
    if (PdfMake.vfs === undefined) {
      PdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts.vfs;
    }

    const docDefinition = {
      pageSize: 'LETTER',
      pageOrientation: 'portrait',
      pageMargins: [25, 18, 25, 18],
      content,
      styles: {
        title: { fontSize: 16, bold: true, alignment: 'center', color: COLORS.cellText },
        subtitle: { fontSize: 10, alignment: 'center', color: COLORS.accentPurple },
      },
      defaultStyle: { font: 'Roboto', color: COLORS.cellText },
    };

    const pdfDoc = PdfMake.createPdf(docDefinition);
    pdfDoc.getBuffer((buffer) => { resolve(buffer); });
  });
}

function buildHeader(logoBase64, weekStart, isContinued, isSummary, pageNum) {
  const headerColumns = [];

  if (logoBase64) {
    headerColumns.push({ image: logoBase64, width: 60, alignment: 'left' });
  }

  let titleText = isSummary ? 'Employee Hours Summary' : `Week of ${weekStart}`;
  if (isContinued) titleText = `Week of ${weekStart} (continued)`;
  if (isSummary && pageNum) titleText += ` (Page ${pageNum})`;

  headerColumns.push({
    stack: [
      {
        text: isSummary ? 'Hours Summary' : 'Weekly Schedule',
        fontSize: 17, bold: true, color: COLORS.cellText,
        alignment: logoBase64 ? 'left' : 'center',
      },
      {
        text: titleText,
        fontSize: 10, bold: true, color: COLORS.accentPurple,
        alignment: logoBase64 ? 'left' : 'center',
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [6, 5, 0, 0],
  });

  return {
    stack: [
      { columns: headerColumns },
      { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 560, y2: 3, lineWidth: 2.5, lineColor: COLORS.accentPurple }] },
    ],
  };
}

function buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap) {
  const dayDate = new Date(weekStart + 'T00:00:00');
  dayDate.setDate(dayDate.getDate() + day);
  const dateStr = `${String(dayDate.getMonth() + 1).padStart(2, '0')}/${String(dayDate.getDate()).padStart(2, '0')}`;

  const orderLabels = [];
  if (orderDaysMap.ag.includes(day)) orderLabels.push('AG');
  if (orderDaysMap.us.includes(day)) orderLabels.push('US');
  const orderStr = orderLabels.length > 0 ? `  [${orderLabels.join(', ')} Order]` : '';

  const periodSlots = {};
  let maxRows = 0;
  for (const period of PERIODS) {
    const key = `${day}-${period}`;
    const entries = (scheduleData[key] || []).sort((a, b) => a.slot_index - b.slot_index);
    const configs = shiftConfigs.filter(c => c.shift_period === period);
    const slotCount = Math.max(entries.length, configs.length, 1);
    periodSlots[period] = { entries, configs, slotCount };
    if (slotCount > maxRows) maxRows = slotCount;
  }

  const body = [];

  // Day header (9 columns: [start, name, end] × 3 periods)
  body.push([{
    text: [
      { text: `${DAY_NAMES[day]}`, bold: true, fontSize: 12, color: COLORS.headerText },
      { text: `  ${dateStr}`, bold: true, fontSize: 10, color: '#C8C4FF' },
      { text: orderStr, fontSize: 8.5, color: COLORS.orderTagColor, bold: true },
    ],
    colSpan: 9, fillColor: COLORS.headerBg, alignment: 'center', margin: [0, 3],
  }, {}, {}, {}, {}, {}, {}, {}, {}]);

  // Period column headers — each spans 3 columns
  body.push([
    { text: 'MORNING', bold: true, fontSize: 8.5, color: COLORS.morningHeaderText, fillColor: COLORS.morningHeaderBg, alignment: 'center', margin: [0, 2], colSpan: 3 },
    {}, {},
    { text: 'AFTERNOON', bold: true, fontSize: 8.5, color: COLORS.afternoonHeaderText, fillColor: COLORS.afternoonHeaderBg, alignment: 'center', margin: [0, 2], colSpan: 3 },
    {}, {},
    { text: 'NIGHT', bold: true, fontSize: 8.5, color: COLORS.nightHeaderText, fillColor: COLORS.nightHeaderBg, alignment: 'center', margin: [0, 2], colSpan: 3 },
    {}, {},
  ]);

  // Data rows — skip rows where no employee is assigned in any period
  let visibleRowIdx = 0;
  for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
    const hasAssigned = PERIODS.some(period => {
      const entry = periodSlots[period].entries.find(e => e.slot_index === rowIdx);
      return entry && entry.employee_name;
    });
    if (!hasAssigned) continue;

    const row = [];
    const rowBg = visibleRowIdx % 2 === 0 ? COLORS.whiteBg : COLORS.altRowBg;
    visibleRowIdx++;

    for (const period of PERIODS) {
      const { entries, configs } = periodSlots[period];
      const entry = entries.find(e => e.slot_index === rowIdx);
      const config = configs.find(c => c.slot_index === rowIdx);
      const periodColor = getNameColor(period);

      if (entry && entry.employee_name) {
        const startTime = entry.start_time || config?.start_time;
        const endTime = entry.end_time || config?.end_time;

        // Start time — same period color
        row.push({
          text: formatTime(startTime), fontSize: 8, bold: true, color: periodColor,
          fillColor: rowBg, alignment: 'center', margin: [0, 2],
        });

        // Name — big and readable
        if (entry.is_trainee) {
          row.push({
            text: [
              { text: entry.employee_name, fontSize: 11, bold: true, color: periodColor },
              { text: ' (T)', fontSize: 7, color: COLORS.traineeTag, italics: true },
            ],
            fillColor: rowBg, alignment: 'center', margin: [0, 2],
          });
        } else {
          row.push({
            text: entry.employee_name, fontSize: 11, bold: true, color: periodColor,
            fillColor: rowBg, alignment: 'center', margin: [0, 2],
          });
        }

        // End time — same period color
        row.push({
          text: formatTime(endTime), fontSize: 8, bold: true, color: periodColor,
          fillColor: rowBg, alignment: 'center', margin: [0, 2],
        });
      } else {
        // Empty cell — 3 blank columns
        row.push({ text: '', fillColor: rowBg, margin: [0, 2] });
        row.push({ text: '', fillColor: rowBg, margin: [0, 2] });
        row.push({ text: '', fillColor: rowBg, margin: [0, 2] });
      }
    }
    body.push(row);
  }

  return {
    table: { headerRows: 2, widths: [30, '*', 30, 30, '*', 30, 30, '*', 30], body },
    layout: {
      hLineWidth: (i) => (i <= 2 ? 0.8 : 0.4),
      vLineWidth: (i) => (i === 3 || i === 6) ? 1.2 : 0.3,
      hLineColor: () => COLORS.borderColor,
      vLineColor: (i) => (i === 3 || i === 6) ? COLORS.accentPurple : COLORS.borderColor,
      paddingLeft: () => 1,
      paddingRight: () => 1,
      paddingTop: () => 1,
      paddingBottom: () => 1,
    },
  };
}

function buildSummaryPages(employeeHours, allEmployees, logoBase64, weekStart) {
  // Build merged employee list
  const allEmpMap = {};
  for (const emp of allEmployees) {
    const roles = parseRoles(emp.role);
    allEmpMap[emp.id] = {
      name: emp.name, hours: 0, is_trainee: emp.is_trainee,
      roles, employment_type: emp.employment_type, max_hours: emp.max_hours,
    };
  }
  for (const [id, data] of Object.entries(employeeHours)) {
    if (allEmpMap[id]) {
      allEmpMap[id].hours = data.hours;
      if (data.max_hours) allEmpMap[id].max_hours = data.max_hours;
    } else {
      allEmpMap[id] = data;
    }
  }

  const sorted = Object.values(allEmpMap).sort((a, b) => {
    if (b.hours !== a.hours) return b.hours - a.hours;
    return a.name.localeCompare(b.name);
  });

  const totalHours = sorted.reduce((sum, e) => sum + e.hours, 0);
  const scheduledCount = sorted.filter(e => e.hours > 0).length;

  // Split into two pages — first 14 on page 3, rest on page 4
  const splitIdx = Math.ceil(sorted.length / 2);
  const page1Emps = sorted.slice(0, splitIdx);
  const page2Emps = sorted.slice(splitIdx);

  const pages = [];

  // Page 3: First half of employees
  pages.push({ text: '', pageBreak: 'before' });
  pages.push(buildHeader(logoBase64, weekStart, false, true, 1));
  pages.push({ text: '', margin: [0, 6] });
  pages.push(buildSummaryTable(page1Emps, 0));

  // Page 4: Second half + total row
  pages.push({ text: '', pageBreak: 'before' });
  pages.push(buildHeader(logoBase64, weekStart, false, true, 2));
  pages.push({ text: '', margin: [0, 6] });
  pages.push(buildSummaryTable(page2Emps, splitIdx, totalHours, scheduledCount, sorted.length));

  return pages;
}

function buildSummaryTable(employees, startIdx, totalHours, scheduledCount, totalCount) {
  const body = [[
    { text: '#', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [3, 5], alignment: 'center' },
    { text: 'Employee', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [3, 5], alignment: 'left' },
    { text: 'Type', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [3, 5], alignment: 'center' },
    { text: 'Hours', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [3, 5], alignment: 'center' },
  ]];

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const idx = startIdx + i;
    const rowBg = i % 2 === 0 ? COLORS.whiteBg : COLORS.summaryAltBg;

    let empTypeLabel = 'Part-Time';
    if (emp.employment_type === 'coop') empTypeLabel = 'Co-op/OPT';
    else if (emp.employment_type === 'external_coop') empTypeLabel = 'Ext. Co-op';

    let nameCell;
    if (emp.is_trainee) {
      nameCell = {
        text: [
          { text: emp.name, fontSize: 12, bold: true, color: COLORS.cellText },
          { text: ' (T)', fontSize: 8, color: COLORS.traineeTag, italics: true },
        ],
        fillColor: rowBg, margin: [3, 6],
      };
    } else {
      nameCell = {
        text: emp.name, fontSize: 12, bold: true, color: COLORS.cellText,
        fillColor: rowBg, margin: [3, 6],
      };
    }

    body.push([
      { text: String(idx + 1), fontSize: 10, bold: true, color: COLORS.timeText, fillColor: rowBg, alignment: 'center', margin: [3, 6] },
      nameCell,
      { text: empTypeLabel, fontSize: 10, color: COLORS.timeText, fillColor: rowBg, alignment: 'center', margin: [3, 6] },
      { text: emp.hours > 0 ? emp.hours.toFixed(1) + 'h' : '0h', fontSize: 12, bold: true, color: COLORS.cellText, fillColor: rowBg, alignment: 'center', margin: [3, 6] },
    ]);
  }

  // Total row only on the last page
  if (totalHours !== undefined) {
    body.push([
      { text: '', fillColor: COLORS.totalRowBg, margin: [3, 7] },
      { text: `Total (${scheduledCount}/${totalCount} scheduled)`, bold: true, fontSize: 12, color: COLORS.totalRowText, fillColor: COLORS.totalRowBg, margin: [3, 7], colSpan: 2 },
      {},
      { text: totalHours.toFixed(1) + 'h', bold: true, fontSize: 13, color: COLORS.totalRowText, fillColor: COLORS.totalRowBg, alignment: 'center', margin: [3, 7] },
    ]);
  }

  return {
    table: { headerRows: 1, widths: [30, '*', 75, 65], body },
    layout: {
      hLineWidth: (i) => (i <= 1 ? 1.0 : 0.4),
      vLineWidth: () => 0.4,
      hLineColor: () => COLORS.borderColor,
      vLineColor: () => COLORS.borderColor,
      paddingLeft: () => 2,
      paddingRight: () => 2,
      paddingTop: () => 1,
      paddingBottom: () => 1,
    },
  };
}

module.exports = { generatePDF };
