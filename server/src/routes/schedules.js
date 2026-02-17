const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');
const { autoGenerate, timesOverlap } = require('../services/scheduler');
const { generatePDF } = require('../services/pdf');

const router = express.Router();
router.use(authenticate);

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 7;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // overnight shift
  return (endMin - startMin) / 60;
}

// Get schedule for a week
router.get('/:weekStart', async (req, res) => {
  try {
    const { weekStart } = req.params;
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
      .orderBy(['day_of_week', 'shift_period', 'slot_index']);

    const settings = await db('schedule_settings').where({ week_start_date: weekStart });
    const shiftConfigs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);

    const normalizedSchedules = schedules.map(s => {
      let employee_roles = [];
      if (s.employee_role) {
        try { employee_roles = JSON.parse(s.employee_role); } catch { employee_roles = s.employee_role ? [s.employee_role] : []; }
      }
      const { employee_role, ...rest } = s;
      return { ...rest, employee_roles };
    });
    res.json({ schedules: normalizedSchedules, settings, shift_configs: shiftConfigs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save/update schedule
router.put('/:weekStart', async (req, res) => {
  try {
    const { weekStart } = req.params;
    const { assignments } = req.body;
    // assignments: Array of { day_of_week, shift_period, slot_index, employee_id, is_locked, start_time }

    for (const a of assignments) {
      const existing = await db('schedules').where({
        week_start_date: weekStart,
        day_of_week: a.day_of_week,
        shift_period: a.shift_period,
        slot_index: a.slot_index,
      }).first();

      if (existing) {
        await db('schedules').where({ id: existing.id }).update({
          employee_id: a.employee_id,
          is_locked: a.is_locked || false,
          start_time: a.start_time,
          end_time: a.end_time,
        });
      } else {
        await db('schedules').insert({
          week_start_date: weekStart,
          day_of_week: a.day_of_week,
          shift_period: a.shift_period,
          slot_index: a.slot_index,
          employee_id: a.employee_id,
          is_locked: a.is_locked || false,
          start_time: a.start_time,
          end_time: a.end_time,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update schedule settings (employee counts per shift)
router.put('/:weekStart/settings', async (req, res) => {
  try {
    const { weekStart } = req.params;
    const { settings } = req.body; // Array of { day_of_week, shift_period, employee_count }

    for (const s of settings) {
      const existing = await db('schedule_settings').where({
        week_start_date: weekStart,
        day_of_week: s.day_of_week,
        shift_period: s.shift_period,
      }).first();

      if (existing) {
        await db('schedule_settings').where({ id: existing.id }).update({
          employee_count: s.employee_count,
        });
      } else {
        await db('schedule_settings').insert({
          week_start_date: weekStart,
          day_of_week: s.day_of_week,
          shift_period: s.shift_period,
          employee_count: s.employee_count,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Auto-generate schedule
router.post('/:weekStart/auto-generate', async (req, res) => {
  try {
    const { weekStart } = req.params;
    const result = await autoGenerate(weekStart);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Auto-generation failed' });
  }
});

// Get available employees for a specific slot
router.get('/:weekStart/available/:dayOfWeek/:shiftPeriod', async (req, res) => {
  try {
    const { weekStart, dayOfWeek, shiftPeriod } = req.params;
    const day = parseInt(dayOfWeek);

    // Get all active employees
    const allEmployees = await db('employees').where({ active: true }).orderBy('name');

    // Get shift configs for this period to know the time ranges
    const shiftConfigs = await db('shift_configs')
      .where({ shift_period: shiftPeriod })
      .orderBy('slot_index');

    // Get the overall time range for this period (earliest start, latest end)
    const periodStart = shiftConfigs[0]?.start_time || '06:00';
    const periodEnd = shiftConfigs[shiftConfigs.length - 1]?.end_time || '13:00';

    // Load unavailable times for all employees (base + this week's overrides)
    let unavailableTimes = [];
    try {
      unavailableTimes = await db('unavailable_times')
        .where(function () {
          this.whereNull('week_start_date').orWhere({ week_start_date: weekStart });
        })
        .andWhere({ day_of_week: day });
    } catch (e) {
      // Table may not exist yet
    }

    // Build unavailable map by employee
    const unavailMap = {};
    for (const u of unavailableTimes) {
      if (!unavailMap[u.employee_id]) unavailMap[u.employee_id] = [];
      unavailMap[u.employee_id].push(u);
    }

    // Also load old availability as fallback
    let oldAvailRows = [];
    try {
      oldAvailRows = await db('availability')
        .where({ day_of_week: day, shift_period: shiftPeriod });
    } catch (e) {
      // ignore
    }
    const oldAvailSet = new Set();
    const oldUnavailSet = new Set();
    for (const a of oldAvailRows) {
      if (a.is_available) oldAvailSet.add(a.employee_id);
      else oldUnavailSet.add(a.employee_id);
    }

    // Filter employees by time-based availability
    const available = allEmployees.filter(emp => {
      const empBlocks = unavailMap[emp.id];

      // If employee has time-based blocks, check overlap with period range
      if (empBlocks && empBlocks.length > 0) {
        // Check if ANY shift config slot in this period is free from overlap
        const hasAvailableSlot = shiftConfigs.some(config => {
          return !empBlocks.some(block =>
            timesOverlap(config.start_time, config.end_time, block.start_time, block.end_time)
          );
        });
        return hasAvailableSlot;
      }

      // Fall back to old availability
      if (oldUnavailSet.has(emp.id)) return false;
      return true;
    });

    // Calculate current hours for each employee this week
    const weekSchedules = await db('schedules')
      .where({ week_start_date: weekStart })
      .whereNotNull('employee_id');

    const hourMap = {};
    for (const s of weekSchedules) {
      if (!hourMap[s.employee_id]) hourMap[s.employee_id] = 0;
      const config = shiftConfigs.find(c => c.shift_period === s.shift_period && c.slot_index === s.slot_index);
      const startTime = s.start_time || config?.start_time;
      const endTime = s.end_time || config?.end_time;
      hourMap[s.employee_id] += calcHours(startTime, endTime);
    }

    const result = available.map(emp => {
      let roles = [];
      try { roles = JSON.parse(emp.role || '[]'); } catch { roles = emp.role ? [emp.role] : []; }
      const { role, ...rest } = emp;
      return {
        ...rest,
        roles,
        current_hours: hourMap[emp.id] || 0,
        hours_remaining: emp.max_hours - (hourMap[emp.id] || 0),
      };
    }).filter(emp => emp.hours_remaining > 4);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Export PDF
router.get('/:weekStart/pdf', async (req, res) => {
  try {
    const { weekStart } = req.params;
    const pdfBuffer = await generatePDF(weekStart);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=schedule-${weekStart}.pdf`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

module.exports = router;
