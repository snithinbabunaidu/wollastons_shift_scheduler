const db = require('../db/knex');
const path = require('path');
const fs = require('fs');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PERIODS = ['morning', 'afternoon', 'night'];
const PERIOD_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };

// Dark theme colors matching the app
const COLORS = {
  darkBg: '#0F0F1A',
  cardBg: '#1A1A2E',
  headerBg: '#6C63FF',        // primary purple
  headerText: '#FFFFFF',
  dayHeaderBg: '#2A2A4A',     // dark purple-gray
  dayHeaderText: '#E8E8F0',
  morningBg: '#1E1E38',       // subtle warm tint
  afternoonBg: '#1A1A32',     // subtle cool tint
  nightBg: '#16162C',         // darkest tint
  cellText: '#E8E8F0',        // light text
  timeText: '#9B9BB4',        // muted text
  traineeColor: '#2ED573',    // green for trainees
  managerColor: '#FF6B6B',    // red for managers
  borderColor: '#3A3A5C',     // subtle border
  accentPurple: '#8B83FF',
  accentCyan: '#45B7D1',
  summaryAltBg: '#22223A',
  emptySlot: '#6B6B80',
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
  content.push({ text: '', margin: [0, 8] });
  for (let day = 0; day <= 3; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 3) content.push({ text: '', margin: [0, 6] });
  }

  // ===== PAGE 2: Thursday - Saturday =====
  content.push({ text: '', pageBreak: 'before' });
  content.push(buildHeader(logoBase64, weekStart, true));
  content.push({ text: '', margin: [0, 8] });
  for (let day = 4; day <= 6; day++) {
    content.push(buildDayTable(day, weekStart, scheduleData, shiftConfigs, orderDaysMap));
    if (day < 6) content.push({ text: '', margin: [0, 6] });
  }

  // ===== PAGE 3: Hours Summary =====
  content.push({ text: '', pageBreak: 'before' });
  content.push(buildHeader(logoBase64, weekStart, false, true));
  content.push({ text: '', margin: [0, 10] });
  content.push(buildSummaryTable(employeeHours));

  return new Promise((resolve) => {
    const PdfMake = require('pdfmake/build/pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts');
    if (PdfMake.vfs === undefined) {
      PdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts.vfs;
    }

    const docDefinition = {
      pageSize: 'LETTER',
      pageOrientation: 'landscape',
      pageMargins: [25, 20, 25, 20],
      background: function () {
        return { canvas: [{ type: 'rect', x: 0, y: 0, w: 792, h: 612, color: COLORS.darkBg }] };
      },
      content,
      styles: {
        title: { fontSize: 16, bold: true, alignment: 'center', color: COLORS.headerText },
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
      width: 90,
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
        color: COLORS.headerText,
        alignment: logoBase64 ? 'left' : 'center',
      },
      {
        text: titleText,
        fontSize: 10,
        color: COLORS.accentPurple,
        alignment: logoBase64 ? 'left' : 'center',
        margin: [0, 2, 0, 0],
      },
    ],
    margin: [10, 5, 0, 0],
  });

  return {
    columns: headerColumns,
    margin: [0, 0, 0, 0],
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

  // Day header row spanning all columns
  body.push([
    {
      text: [
        { text: `${DAY_NAMES[day]} - ${dateStr}`, bold: true, fontSize: 11, color: COLORS.headerText },
        { text: orderStr, fontSize: 8, color: '#FFA502', italics: true },
      ],
      colSpan: 7,
      fillColor: COLORS.headerBg,
      alignment: 'center',
      margin: [0, 4],
    },
    {}, {}, {}, {}, {}, {},
  ]);

  // Column headers: Time | Name | Time | Name | Time | Name | Mgr
  body.push([
    { text: 'Time', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Morning', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Time', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Afternoon', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Time', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Night', bold: true, fontSize: 7, color: COLORS.accentCyan, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
    { text: 'Mgr', bold: true, fontSize: 7, color: COLORS.managerColor, fillColor: COLORS.dayHeaderBg, alignment: 'center', margin: [0, 3] },
  ]);

  // Data rows
  // Collect manager names for this day
  const dayManagers = new Set();

  for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
    const row = [];
    const rowBg = rowIdx % 2 === 0 ? COLORS.morningBg : COLORS.nightBg;

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
        const isAnyMgr = isAnyManager(roles);

        if (isMgr || isAnyMgr) {
          dayManagers.add(entry.employee_name);
        }

        // Time cell
        row.push({
          text: timeStr,
          fontSize: 7,
          color: COLORS.timeText,
          fillColor: rowBg,
          alignment: 'center',
          margin: [0, 2],
        });

        // Name cell - color based on role
        let nameColor = COLORS.cellText;
        let nameText = entry.employee_name;
        let isBold = false;
        let isItalic = false;

        if (entry.is_trainee) {
          nameColor = COLORS.traineeColor;
          nameText = `${entry.employee_name} (T)`;
          isItalic = true;
        } else if (isMgr) {
          nameColor = COLORS.managerColor;
          isBold = true;
        }

        row.push({
          text: nameText,
          fontSize: 8,
          color: nameColor,
          bold: isBold,
          italics: isItalic,
          fillColor: rowBg,
          margin: [2, 2],
        });
      } else {
        // Empty slot
        const timeStr = config ? `${formatTime(config.start_time)}-${formatTime(config.end_time)}` : '';
        row.push({
          text: timeStr || '',
          fontSize: 7,
          color: COLORS.emptySlot,
          fillColor: rowBg,
          alignment: 'center',
          margin: [0, 2],
        });
        row.push({
          text: '—',
          fontSize: 8,
          color: COLORS.emptySlot,
          fillColor: rowBg,
          margin: [2, 2],
        });
      }
    }

    // Mgr column - only show on first row
    if (rowIdx === 0) {
      row.push({
        text: dayManagers.size > 0 ? '' : '',
        fontSize: 7,
        color: COLORS.managerColor,
        fillColor: rowBg,
        alignment: 'center',
        margin: [0, 2],
        rowSpan: maxRows,
      });
    } else {
      row.push({});
    }

    body.push(row);
  }

  // After building rows, fill in the Mgr cell content with actual managers found
  // We need to collect all managers first, then update the cell
  // Rebuild: collect managers from all entries for this day
  const allDayManagers = [];
  for (const period of PERIODS) {
    const key = `${day}-${period}`;
    const entries = (scheduleData[key] || []);
    for (const entry of entries) {
      if (entry.employee_name) {
        const roles = parseRoles(entry.employee_role);
        if (isAnyManager(roles)) {
          if (!allDayManagers.includes(entry.employee_name)) {
            allDayManagers.push(entry.employee_name);
          }
        }
      }
    }
  }

  // Update the Mgr cell in the first data row (index 2 = after header + column headers)
  if (body.length > 2) {
    const mgrCell = body[2][6]; // First data row, last column
    if (mgrCell && typeof mgrCell === 'object') {
      mgrCell.text = allDayManagers.length > 0
        ? allDayManagers.map(n => n.split(' ')[0]).join('\n')
        : '—';
    }
  }

  return {
    table: {
      headerRows: 2,
      widths: [55, '*', 55, '*', 55, '*', 40],
      body,
    },
    layout: {
      hLineWidth: (i, node) => (i <= 2 ? 1 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: () => COLORS.borderColor,
      vLineColor: () => COLORS.borderColor,
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 1,
      paddingBottom: () => 1,
    },
  };
}

function buildSummaryTable(employeeHours) {
  const body = [
    [
      { text: 'Employee', bold: true, fontSize: 10, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'left' },
      { text: 'Type', bold: true, fontSize: 10, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
      { text: 'Roles', bold: true, fontSize: 10, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
      { text: 'Hours', bold: true, fontSize: 10, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], alignment: 'center' },
    ],
  ];

  const sorted = Object.values(employeeHours).sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < sorted.length; i++) {
    const emp = sorted[i];
    const rowBg = i % 2 === 0 ? COLORS.cardBg : COLORS.summaryAltBg;
    const isMgr = isAnyManager(emp.roles || []);

    // Format roles
    const roleLabels = (emp.roles || []).map(r => {
      switch (r) {
        case 'morning_manager': return 'AM Mgr';
        case 'afternoon_manager': return 'PM Mgr';
        case 'night_manager': return 'Night Mgr';
        case 'ag_food_order': return 'AG Order';
        case 'us_food_order': return 'US Order';
        default: return r;
      }
    });

    // Format employment type
    let empTypeLabel = 'Part-Time';
    if (emp.employment_type === 'coop') empTypeLabel = 'Co-op/OPT';
    else if (emp.employment_type === 'external_coop') empTypeLabel = 'Ext. Co-op';

    // Name color
    let nameColor = COLORS.cellText;
    let nameExtra = '';
    if (emp.is_trainee) {
      nameColor = COLORS.traineeColor;
      nameExtra = ' (T)';
    } else if (isMgr) {
      nameColor = COLORS.managerColor;
    }

    body.push([
      {
        text: emp.name + nameExtra,
        fontSize: 10,
        color: nameColor,
        bold: isMgr,
        italics: emp.is_trainee,
        fillColor: rowBg,
        margin: [4, 4],
      },
      {
        text: empTypeLabel,
        fontSize: 9,
        color: COLORS.timeText,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 4],
      },
      {
        text: roleLabels.join(', ') || '—',
        fontSize: 8,
        color: roleLabels.length > 0 ? COLORS.accentPurple : COLORS.emptySlot,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 4],
      },
      {
        text: emp.hours.toFixed(1) + 'h',
        fontSize: 10,
        bold: true,
        color: COLORS.accentCyan,
        fillColor: rowBg,
        alignment: 'center',
        margin: [4, 4],
      },
    ]);
  }

  // Total row
  const totalHours = sorted.reduce((sum, emp) => sum + emp.hours, 0);
  body.push([
    { text: `Total (${sorted.length} employees)`, bold: true, fontSize: 10, color: COLORS.headerText, fillColor: COLORS.headerBg, margin: [4, 6], colSpan: 3 },
    {}, {},
    { text: totalHours.toFixed(1) + 'h', bold: true, fontSize: 11, color: COLORS.headerText, fillColor: COLORS.headerBg, alignment: 'center', margin: [4, 6] },
  ]);

  return {
    table: {
      headerRows: 1,
      widths: ['*', 80, 120, 60],
      body,
    },
    layout: {
      hLineWidth: (i) => (i <= 1 ? 1.5 : 0.5),
      vLineWidth: () => 0.5,
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
