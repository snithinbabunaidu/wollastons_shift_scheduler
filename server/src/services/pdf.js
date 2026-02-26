const db = require('../db/knex');
const path = require('path');
const fs = require('fs');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = ['morning', 'afternoon', 'night'];

// Light theme colors - vibrant and professional
const COLORS = {
  headerBg: '#5B52E0',        // deeper primary purple
  headerText: '#FFFFFF',
  morningHeaderBg: '#FFF3E0',  // warm orange tint
  morningHeaderText: '#BF360C', // bolder deep orange
  afternoonHeaderBg: '#E3F2FD', // light blue
  afternoonHeaderText: '#0D47A1', // bolder deep blue
  nightHeaderBg: '#EDE7F6',    // light violet
  nightHeaderText: '#4A148C',  // bolder deep purple
  colHeaderBg: '#F5F3FF',     // light purple tint
  colHeaderText: '#6C63FF',   // purple text
  cellText: '#111127',        // near-black for maximum readability
  timeText: '#2D2D50',        // much darker time text
  traineeTag: '#7A7A99',      // muted gray for (T) tag
  managerTag: '#6C63FF',      // subtle purple for manager indicator
  borderColor: '#C5C5DE',     // visible border
  altRowBg: '#F5F3FF',        // light purple alternating bg
  whiteBg: '#FFFFFF',
  emptySlot: '#9E9EBE',       // muted for empty
  accentPurple: '#5B52E0',
  orderTagColor: '#D97706',   // amber for order tags
  summaryAltBg: '#F0EDFF',
  totalRowBg: '#E8E3FF',      // light violet for totals
  totalRowText: '#3B1198',    // deep purple
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

function isAnyManager(roles) {
  return roles.some(r => r.endsWith('_manager'));
}

// Load logo as base64 for embedding in PDF
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

async function generatePDF(weekStart) {
  const schedules = await db('schedules')
    .where({ week_start_date: weekStart })
    .leftJoin('employees', 'schedules.employee_id', 'employees.id')
    .select(
      'schedules.*',
      'employees.name as employee_name',
      'employees.is_trainee',
      'employees.role as employee_role',
      'employees.employment_type'
    )
    .orderBy(['schedules.day_of_week', 'schedules.shift_period', 'schedules.slot_index']);

  const shiftConfigs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);

  // Load all active employees (for showing everyone in summary)
  const allEmployees = await db('employees').where({ active: true });

  // Load order days
  let orderDaysRows = [];
  try {
    orderDaysRows = await db('order_days');
  } catch (e) {
    // Table may not exist yet
  }
  const orderDaysMap = { ag: [], us: [] };
  for (const row of orderDaysRows) {
    orderDaysMap[row.order_type].push(row.day_of_week);
  }

  // Build schedule data structure
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
      const config = shiftConfigs.find(c => c.shift_period === s.shift_period && c.slot_index === s.slot_index);
      const startTime = s.start_time || config?.start_time;
      const endTime = s.end_time || config?.end_time;
      const hours = calcHours(startTime, endTime);
      const roles = parseRoles(s.employee_role);
      if (!employeeHours[s.employee_id]) {
        employeeHours[s.employee_id] = {
          name: s.employee_name,
          hours: 0,
          is_trainee: s.is_trainee,
          roles,
          employment_type: s.employment_type,
        };
      }
      employeeHours[s.employee_id].hours += hours;
    }
  }

  const logoBase64 = getLogoBase64();
  const content = [];

  // ===== PAGE 1: Sunday - Wednesday =====
  content.push(buildHeader(logoBase64, weekStart));
  content.push({ text: '', margin: [0, 6] });
  for (let day = 0; day <= 3; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 3) content.push({ text: '', margin: [0, 5] });
  }

  // ===== PAGE 2: Thursday - Saturday =====
  content.push({ text: '', pageBreak: 'before' });
  content.push(buildHeader(logoBase64, weekStart, true));
  content.push({ text: '', margin: [0, 6] });
  for (let day = 4; day <= 6; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 6) content.push({ text: '', margin: [0, 5] });
  }

  // ===== PAGE 3: Hours Summary =====
  content.push({ text: '', pageBreak: 'before' });
  content.push(buildHeader(logoBase64, weekStart, false, true));
  content.push({ text: '', margin: [0, 8] });
  content.push(buildSummaryTable(employeeHours, allEmployees));

  return new Promise((resolve) => {
    const PdfMake = require('pdfmake/build/pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts');
    if (PdfMake.vfs === undefined) {
      PdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts.vfs;
    }

    const docDefinition = {
      pageSize: 'LETTER',
      pageOrientation: 'portrait',
      pageMargins: [25, 20, 25, 20],
      content,
      styles: {
        title: { fontSize: 16, bold: true, alignment: 'center', color: COLORS.cellText },
        subtitle: { fontSize: 10, alignment: 'center', color: COLORS.accentPurple },
      },
      defaultStyle: { font: 'Roboto', color: COLORS.cellText },
    };

    const pdfDoc = PdfMake.createPdf(docDefinition);
    pdfDoc.getBuffer((buffer) => {
      resolve(buffer);
    });
  });
}

function buildHeader(logoBase64, weekStart, isContinued, isSummary) {
  const headerColumns = [];

  if (logoBase64) {
    headerColumns.push({
      image: logoBase64,
      width: 70,
      alignment: 'left',
    });
  }

  let titleText = `Week of ${weekStart}`;
  if (isContinued) titleText += ' (continued)';
  if (isSummary) titleText = 'Employee Hours Summary';

  headerColumns.push({
    stack: [
      {
        text: isSummary ? 'Hours Summary' : 'Weekly Schedule',
        fontSize: 18,
        bold: true,
        color: COLORS.cellText,
        alignment: logoBase64 ? 'left' : 'center',
      },
      {
        text: titleText,
        fontSize: 11,
        bold: true,
        color: COLORS.accentPurple,
        alignment: logoBase64 ? 'left' : 'center',
        margin: [0, 2, 0, 0],
      },
    ],
    margin: [8, 6, 0, 0],
  });

  return {
    stack: [
      { columns: headerColumns },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 4, x2: 560, y2: 4, lineWidth: 2.5, lineColor: COLORS.accentPurple },
        ],
      },
    ],
  };
}

function buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap) {
  // Compute date
  const dayDate = new Date(weekStart + 'T00:00:00');
  dayDate.setDate(dayDate.getDate() + day);
  const dateStr = `${String(dayDate.getMonth() + 1).padStart(2, '0')}/${String(dayDate.getDate()).padStart(2, '0')}`;

  // Order day labels
  const orderLabels = [];
  if (orderDaysMap.ag.includes(day)) orderLabels.push('AG');
  if (orderDaysMap.us.includes(day)) orderLabels.push('US');
  const orderStr = orderLabels.length > 0 ? `  [${orderLabels.join(', ')} Order]` : '';

  // Find max slots across all periods for this day
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

  // Day header row spanning all 6 columns
  body.push([
    {
      text: [
        { text: `${DAY_NAMES[day]}`, bold: true, fontSize: 13, color: COLORS.headerText },
        { text: `  ${dateStr}`, bold: true, fontSize: 11, color: '#D4D0FF' },
        { text: orderStr, fontSize: 9, color: '#FFD700', bold: true },
      ],
      colSpan: 6,
      fillColor: COLORS.headerBg,
      alignment: 'center',
      margin: [0, 4],
    },
    {}, {}, {}, {}, {},
  ]);

  // Column headers with color-coded period names: Time | Morning | Time | Afternoon | Time | Night
  body.push([
    { text: 'Time', bold: true, fontSize: 8.5, color: COLORS.morningHeaderText, fillColor: COLORS.morningHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'MORNING', bold: true, fontSize: 8.5, color: COLORS.morningHeaderText, fillColor: COLORS.morningHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Time', bold: true, fontSize: 8.5, color: COLORS.afternoonHeaderText, fillColor: COLORS.afternoonHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'AFTERNOON', bold: true, fontSize: 8.5, color: COLORS.afternoonHeaderText, fillColor: COLORS.afternoonHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Time', bold: true, fontSize: 8.5, color: COLORS.nightHeaderText, fillColor: COLORS.nightHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'NIGHT', bold: true, fontSize: 8.5, color: COLORS.nightHeaderText, fillColor: COLORS.nightHeaderBg, alignment: 'center', margin: [0, 3] },
  ]);

  // Data rows
  for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
    const row = [];
    const rowBg = rowIdx % 2 === 0 ? COLORS.whiteBg : COLORS.altRowBg;

    for (const period of PERIODS) {
      const { entries, configs } = periodSlots[period];
      const entry = entries.find(e => e.slot_index === rowIdx);
      const config = configs.find(c => c.slot_index === rowIdx);

      if (entry && entry.employee_name) {
        const startTime = entry.start_time || config?.start_time;
        const endTime = entry.end_time || config?.end_time;
        const timeStr = `${formatTime(startTime)}-${formatTime(endTime)}`;
        const roles = parseRoles(entry.employee_role);
        const isMgr = hasManagerRole(roles, period);

        // Time cell - big and bold
        row.push({
          text: timeStr,
          fontSize: 9.5,
          bold: true,
          color: COLORS.timeText,
          fillColor: rowBg,
          alignment: 'center',
          margin: [0, 3],
        });

        // Name cell — bold names, subtle (T) tag for trainees
        if (entry.is_trainee) {
          row.push({
            text: [
              { text: entry.employee_name, fontSize: 10, bold: true, color: COLORS.cellText },
              { text: ' (T)', fontSize: 7.5, color: COLORS.traineeTag, italics: true },
            ],
            fillColor: rowBg,
            margin: [3, 3],
          });
        } else {
          row.push({
            text: entry.employee_name,
            fontSize: 10,
            bold: true,
            color: COLORS.cellText,
            fillColor: rowBg,
            margin: [3, 3],
          });
        }
      } else {
        // Empty slot
        const timeStr = config ? `${formatTime(config.start_time)}-${formatTime(config.end_time)}` : '';
        row.push({
          text: timeStr || '',
          fontSize: 9,
          bold: true,
          color: COLORS.emptySlot,
          fillColor: rowBg,
          alignment: 'center',
          margin: [0, 3],
        });
        row.push({
          text: '—',
          fontSize: 9,
          color: COLORS.emptySlot,
          fillColor: rowBg,
          alignment: 'center',
          margin: [3, 3],
        });
      }
    }

    body.push(row);
  }

  return {
    table: {
      headerRows: 2,
      widths: [58, '*', 58, '*', 58, '*'],
      body,
    },
    layout: {
      hLineWidth: (i) => (i <= 2 ? 1.0 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: () => COLORS.borderColor,
      vLineColor: () => COLORS.borderColor,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  };
}

function buildSummaryTable(employeeHours, allEmployees) {
  const body = [
    [
      { text: '#', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
      { text: 'Employee', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'left' },
      { text: 'Type', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
      { text: 'Hours', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
    ],
  ];

  // Merge scheduled employees with all employees to show everyone
  const allEmpMap = {};
  for (const emp of allEmployees) {
    const roles = parseRoles(emp.role);
    allEmpMap[emp.id] = {
      name: emp.name,
      hours: 0,
      is_trainee: emp.is_trainee,
      roles,
      employment_type: emp.employment_type,
    };
  }
  // Overlay scheduled hours
  for (const [id, data] of Object.entries(employeeHours)) {
    if (allEmpMap[id]) {
      allEmpMap[id].hours = data.hours;
    } else {
      allEmpMap[id] = data;
    }
  }

  // Sort by hours DESCENDING (highest first), then by name for ties
  const sorted = Object.values(allEmpMap).sort((a, b) => {
    if (b.hours !== a.hours) return b.hours - a.hours;
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < sorted.length; i++) {
    const emp = sorted[i];
    const rowBg = i % 2 === 0 ? COLORS.whiteBg : COLORS.summaryAltBg;

    // Format employment type
    let empTypeLabel = 'Part-Time';
    if (emp.employment_type === 'coop') empTypeLabel = 'Co-op/OPT';
    else if (emp.employment_type === 'external_coop') empTypeLabel = 'Ext. Co-op';

    // Name with subtle trainee tag — bold names
    let nameCell;
    if (emp.is_trainee) {
      nameCell = {
        text: [
          { text: emp.name, fontSize: 11, bold: true, color: COLORS.cellText },
          { text: ' (T)', fontSize: 8.5, color: COLORS.traineeTag, italics: true },
        ],
        fillColor: rowBg,
        margin: [4, 5],
      };
    } else {
      nameCell = {
        text: emp.name,
        fontSize: 11,
        bold: true,
        color: COLORS.cellText,
        fillColor: rowBg,
        margin: [4, 5],
      };
    }

    // Hours - show 0h for unscheduled employees in muted color
    const hoursColor = emp.hours > 0 ? COLORS.accentPurple : COLORS.emptySlot;

    body.push([
      {
        text: String(i + 1),
        fontSize: 10,
        bold: true,
        color: COLORS.timeText,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 5],
      },
      nameCell,
      {
        text: empTypeLabel,
        fontSize: 9.5,
        color: COLORS.timeText,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 5],
      },
      {
        text: emp.hours > 0 ? emp.hours.toFixed(1) + 'h' : '0h',
        fontSize: 12,
        bold: true,
        color: hoursColor,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 5],
      },
    ]);
  }

  // Total row
  const totalHours = sorted.reduce((sum, emp) => sum + emp.hours, 0);
  const scheduledCount = sorted.filter(e => e.hours > 0).length;
  body.push([
    { text: '', fillColor: COLORS.totalRowBg, margin: [4, 7] },
    { text: `Total (${scheduledCount}/${sorted.length} scheduled)`, bold: true, fontSize: 12, color: COLORS.totalRowText, fillColor: COLORS.totalRowBg, margin: [4, 7], colSpan: 2 },
    {},
    { text: totalHours.toFixed(1) + 'h', bold: true, fontSize: 13, color: COLORS.totalRowText, fillColor: COLORS.totalRowBg, alignment: 'center', margin: [4, 7] },
  ]);

  return {
    table: {
      headerRows: 1,
      widths: [30, '*', 75, 60],
      body,
    },
    layout: {
      hLineWidth: (i) => (i <= 1 ? 1.2 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: () => COLORS.borderColor,
      vLineColor: () => COLORS.borderColor,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  };
}

module.exports = { generatePDF };
