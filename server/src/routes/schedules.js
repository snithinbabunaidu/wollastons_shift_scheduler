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

function parseRoles(roleJson) {
  if (!roleJson) return [];
  if (Array.isArray(roleJson)) return roleJson;
  try { return JSON.parse(roleJson); } catch { return roleJson ? [roleJson] : []; }
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
    const overflowHours = Math.min(Math.max(Number(req.body.overflow_hours) || 0, 0), 4);
    const result = await autoGenerate(weekStart, { overflowHours });
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

    // Get ALL shift configs for hour calculation
    const allShiftConfigs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);

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
    const oldUnavailSet = new Set();
    for (const a of oldAvailRows) {
      if (!a.is_available) oldUnavailSet.add(a.employee_id);
    }

    // Load locked schedule entries for this day/period to check conflicts
    const lockedEntries = await db('schedules')
      .where({ week_start_date: weekStart, day_of_week: day, shift_period: shiftPeriod, is_locked: true })
      .whereNotNull('employee_id');
    const lockedEmpIds = new Set(lockedEntries.map(e => e.employee_id));

    // Check if employee already has an assignment on this day (one-shift-per-day)
    const dayAssignments = await db('schedules')
      .where({ week_start_date: weekStart, day_of_week: day })
      .whereNotNull('employee_id');
    const assignedOnDay = new Set(dayAssignments.map(a => a.employee_id));

    // Check night shift previous day (for morning rest rule)
    let prevDayNightWorkers = new Set();
    if (shiftPeriod === 'morning' && day > 0) {
      const prevNight = await db('schedules')
        .where({ week_start_date: weekStart, day_of_week: day - 1, shift_period: 'night' })
        .whereNotNull('employee_id');
      prevDayNightWorkers = new Set(prevNight.map(a => a.employee_id));
    }

    // Filter employees by all constraints
    const available = allEmployees.filter(emp => {
      const roles = parseRoles(emp.role);

      // Employment type restrictions
      // External co-ops: target weekends, but allowed on weekdays if night shift preference
      if (emp.employment_type === 'external_coop') {
        if (day !== 0 && day !== 6) return false;
        // External co-ops: only night shifts (unless explicitly no night-only restriction)
        if (shiftPeriod !== 'night') return false;
      }

      // Trainee restrictions: cannot work 6 AM morning shifts
      if (emp.is_trainee && shiftPeriod === 'morning') {
        const has6AM = shiftConfigs.some(c => c.start_time === '06:00');
        // If ALL slots are 6AM, trainee can't work this period at all for early slots
        // But they can still work later morning slots - check per-slot availability
      }

      // Manager restrictions: managers restricted to their period
      const hasAnyManagerRole = roles.some(r => r.endsWith('_manager'));
      if (hasAnyManagerRole) {
        const canWorkPeriod = roles.some(r => {
          if (!r.endsWith('_manager')) return false;
          return r.replace('_manager', '') === shiftPeriod;
        });
        if (!canWorkPeriod) return false;
      }

      // Night-to-morning rest rule: if worked night previous day, morning must be 10AM+
      if (shiftPeriod === 'morning' && prevDayNightWorkers.has(emp.id)) {
        const hasLateSlot = shiftConfigs.some(c => c.start_time >= '10:00');
        if (!hasLateSlot) return false;
      }

      // Check time-based unavailability
      const empBlocks = unavailMap[emp.id];
      if (empBlocks && empBlocks.length > 0) {
        const hasAvailableSlot = shiftConfigs.some(config => {
          return !empBlocks.some(block =>
            timesOverlap(config.start_time, config.end_time, block.start_time, block.end_time)
          );
        });
        if (!hasAvailableSlot) return false;
      } else {
        // Fall back to old availability
        if (oldUnavailSet.has(emp.id)) return false;
      }

      return true;
    });

    // Calculate current hours for each employee this week
    const weekSchedules = await db('schedules')
      .where({ week_start_date: weekStart })
      .whereNotNull('employee_id');

    const hourMap = {};
    for (const s of weekSchedules) {
      if (!hourMap[s.employee_id]) hourMap[s.employee_id] = 0;
      const config = allShiftConfigs.find(c => c.shift_period === s.shift_period && c.slot_index === s.slot_index);
      const startTime = s.start_time || config?.start_time;
      const endTime = s.end_time || config?.end_time;
      hourMap[s.employee_id] += calcHours(startTime, endTime);
    }

    const result = available.map(emp => {
      const roles = parseRoles(emp.role);
      const { role, ...rest } = emp;
      const currentHours = hourMap[emp.id] || 0;
      const hoursRemaining = emp.max_hours - currentHours;
      const isAssignedToday = assignedOnDay.has(emp.id);
      const isLockedHere = lockedEmpIds.has(emp.id);
      return {
        ...rest,
        roles,
        current_hours: currentHours,
        hours_remaining: hoursRemaining,
        is_assigned_today: isAssignedToday,
        is_locked_here: isLockedHere,
      };
    }).filter(emp => emp.hours_remaining > 0); // Show all with remaining hours (was > 4, too restrictive)

    // Sort: available first (not assigned today), then assigned
    result.sort((a, b) => {
      if (a.is_locked_here && !b.is_locked_here) return -1;
      if (!a.is_locked_here && b.is_locked_here) return 1;
      if (!a.is_assigned_today && b.is_assigned_today) return -1;
      if (a.is_assigned_today && !b.is_assigned_today) return 1;
      return b.hours_remaining - a.hours_remaining;
    });

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
