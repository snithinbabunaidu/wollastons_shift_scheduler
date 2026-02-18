const db = require('../db/knex');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = ['morning', 'afternoon', 'night'];

// Match UI colors
const PERIOD_COLORS = {
  morning: '#fff8e1',   // warm yellow
  afternoon: '#e3f2fd', // light blue
  night: '#f3e5f5',     // light purple
};
const TRAINEE_COLOR = '#1565c0';
const DAY_HEADER_BG = '#f57c00';
const DAY_HEADER_TEXT = '#ffffff';
const TABLE_HEADER_BG = '#37474f';
const TABLE_HEADER_TEXT = '#ffffff';

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

async function generatePDF(weekStart) {
  const schedules = await db('schedules')
    .where({ week_start_date: weekStart })
    .leftJoin('employees', 'schedules.employee_id', 'employees.id')
    .select(
      'schedules.*',
      'employees.name as employee_name',
      'employees.is_trainee',
      'employees.role as employee_role'
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

  // Calculate hours per employee using actual times
  const employeeHours = {};
  for (const s of schedules) {
    if (s.employee_id) {
      const config = shiftConfigs.find(c => c.shift_period === s.shift_period && c.slot_index === s.slot_index);
      const startTime = s.start_time || config?.start_time;
      const endTime = s.end_time || config?.end_time;
      const hours = calcHours(startTime, endTime);
      if (!employeeHours[s.employee_id]) {
        employeeHours[s.employee_id] = { name: s.employee_name, hours: 0, is_trainee: s.is_trainee };
      }
      employeeHours[s.employee_id].hours += hours;
    }
  }

  const content = [];

  // Page 1: Sunday-Wednesday (days as rows, shifts as columns)
  content.push({ text: `Schedule: Week of ${weekStart}`, style: 'title' });
  content.push({ text: '', margin: [0, 5] });
  content.push(buildDaysAsRowsTable(scheduleData, shiftConfigs, [0, 1, 2, 3], orderDaysMap, weekStart));

  // Page 2: Thursday-Saturday
  content.push({ text: '', pageBreak: 'before' });
  content.push({ text: `Schedule: Week of ${weekStart} (continued)`, style: 'title' });
  content.push({ text: '', margin: [0, 5] });
  content.push(buildDaysAsRowsTable(scheduleData, shiftConfigs, [4, 5, 6], orderDaysMap, weekStart));

  // Page 3: Summary
  content.push({ text: '', pageBreak: 'before' });
  content.push({ text: 'Employee Hours Summary', style: 'title' });
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
      pageMargins: [30, 30, 30, 30],
      content,
      styles: {
        title: { fontSize: 16, bold: true, alignment: 'center', color: '#37474f' },
        dayHeader: { fontSize: 11, bold: true },
        periodHeader: { fontSize: 9, bold: true },
        cellText: { fontSize: 9 },
        timeText: { fontSize: 7, color: '#888888' },
        trainee: { fontSize: 9, color: TRAINEE_COLOR, italics: true },
        summaryHeader: { fontSize: 11, bold: true },
      },
      defaultStyle: { font: 'Roboto' },
    };

    const pdfDoc = PdfMake.createPdf(docDefinition);
    pdfDoc.getBuffer((buffer) => {
      resolve(buffer);
    });
  });
}

// New layout: days as rows, shifts (Morning | Afternoon | Night) as columns
function buildDaysAsRowsTable(scheduleData, shiftConfigs, days, orderDaysMap, weekStart) {
  const body = [];

  // Header row: Day | Morning | Afternoon | Night
  body.push([
    { text: 'Day', bold: true, alignment: 'center', color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, margin: [0, 4] },
    { text: 'Morning', bold: true, alignment: 'center', color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, margin: [0, 4] },
    { text: 'Afternoon', bold: true, alignment: 'center', color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, margin: [0, 4] },
    { text: 'Night', bold: true, alignment: 'center', color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, margin: [0, 4] },
  ]);

  for (const day of days) {
    // Build order day label
    const orderLabels = [];
    if (orderDaysMap.ag.includes(day)) orderLabels.push('AG Order');
    if (orderDaysMap.us.includes(day)) orderLabels.push('US Order');

    // Compute date for this day
    const dayDate = new Date(weekStart + 'T00:00:00');
    dayDate.setDate(dayDate.getDate() + day);
    const dateStr = `${String(dayDate.getMonth() + 1).padStart(2, '0')}/${String(dayDate.getDate()).padStart(2, '0')}`;

    const dayText = [];
    dayText.push({ text: `${DAY_NAMES[day]} ${dateStr}`, bold: true, fontSize: 11 });
    if (orderLabels.length > 0) {
      dayText.push({ text: `\n${orderLabels.join(', ')}`, fontSize: 7, italics: true });
    }

    const row = [
      { text: dayText, alignment: 'center', fillColor: DAY_HEADER_BG, color: DAY_HEADER_TEXT, margin: [0, 4] },
    ];

    for (const period of PERIODS) {
      const key = `${day}-${period}`;
      const entries = (scheduleData[key] || []).sort((a, b) => a.slot_index - b.slot_index);
      const configs = shiftConfigs.filter(c => c.shift_period === period);

      // Build cell content: list of "time  name" entries
      const lines = [];
      const maxSlots = Math.max(entries.length, configs.length);

      for (let slotIdx = 0; slotIdx < maxSlots; slotIdx++) {
        const entry = entries.find(e => e.slot_index === slotIdx);
        const config = configs.find(c => c.slot_index === slotIdx);

        if (entry && entry.employee_name) {
          const startTime = entry.start_time || config?.start_time;
          const endTime = entry.end_time || config?.end_time;
          const timeStr = `${formatTime(startTime)}-${formatTime(endTime)}`;
          const name = entry.employee_name;

          if (entry.is_trainee) {
            lines.push({
              text: [
                { text: `${timeStr}  `, fontSize: 7, color: '#666666' },
                { text: name, fontSize: 9, color: TRAINEE_COLOR, italics: true },
                { text: ' (T)', fontSize: 7, color: TRAINEE_COLOR, italics: true },
              ],
            });
          } else {
            lines.push({
              text: [
                { text: `${timeStr}  `, fontSize: 7, color: '#666666' },
                { text: name, fontSize: 9, color: '#212121' },
              ],
            });
          }
        } else {
          const timeStr = config ? `${formatTime(config.start_time)}-${formatTime(config.end_time)}` : '';
          lines.push({
            text: timeStr ? `${timeStr}  —` : '—',
            fontSize: 8,
            color: '#bdbdbd',
          });
        }
      }

      row.push({
        stack: lines.map(l => ({ ...l, margin: [0, 1.5] })),
        fillColor: PERIOD_COLORS[period],
        margin: [4, 3],
      });
    }

    body.push(row);
  }

  return {
    table: {
      headerRows: 1,
      widths: [80, '*', '*', '*'],
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#bdbdbd',
      vLineColor: () => '#bdbdbd',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
  };
}

function buildSummaryTable(employeeHours) {
  const body = [
    [
      { text: 'Employee', bold: true, color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, margin: [0, 4] },
      { text: 'Hours', bold: true, color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, alignment: 'center', margin: [0, 4] },
      { text: 'Type', bold: true, color: TABLE_HEADER_TEXT, fillColor: TABLE_HEADER_BG, alignment: 'center', margin: [0, 4] },
    ],
  ];

  const sorted = Object.values(employeeHours).sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < sorted.length; i++) {
    const emp = sorted[i];
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f5f5f5';
    body.push([
      {
        text: emp.is_trainee ? `${emp.name} (Trainee)` : emp.name,
        fontSize: 9,
        color: emp.is_trainee ? TRAINEE_COLOR : '#212121',
        fillColor: rowBg,
      },
      { text: emp.hours.toFixed(1), fontSize: 9, alignment: 'center', fillColor: rowBg },
      {
        text: emp.is_trainee ? 'Trainee' : 'Regular',
        fontSize: 9,
        alignment: 'center',
        color: emp.is_trainee ? TRAINEE_COLOR : '#212121',
        fillColor: rowBg,
      },
    ]);
  }

  return {
    table: { headerRows: 1, widths: ['*', 80, 80], body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#bdbdbd',
      vLineColor: () => '#bdbdbd',
    },
  };
}

module.exports = { generatePDF };
