const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function parseRoles(roleJson) {
  if (!roleJson) return [];
  if (Array.isArray(roleJson)) return roleJson;
  try { return JSON.parse(roleJson); } catch { return roleJson ? [roleJson] : []; }
}

function serializeRoles(roles) {
  if (!roles || roles.length === 0) return '[]';
  return JSON.stringify(roles);
}

function normalizeEmployee(emp) {
  const { role, ...rest } = emp;
  return { ...rest, roles: parseRoles(role) };
}

// Get all employees
router.get('/', async (req, res) => {
  try {
    const employees = await db('employees').where({ active: true }).orderBy('name');
    res.json(employees.map(normalizeEmployee));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all weekly overrides for all employees for a given week
// NOTE: This route MUST be before /:id to avoid "weekly-overrides" matching as an id
router.get('/weekly-overrides/:weekStart', async (req, res) => {
  try {
    const blocks = await db('unavailable_times')
      .where({ week_start_date: req.params.weekStart })
      .leftJoin('employees', 'unavailable_times.employee_id', 'employees.id')
      .select('unavailable_times.*', 'employees.name as employee_name')
      .orderBy(['employee_id', 'day_of_week', 'start_time']);
    res.json(blocks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single employee with availability
router.get('/:id', async (req, res) => {
  try {
    const employee = await db('employees').where({ id: req.params.id }).first();
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const availability = await db('availability').where({ employee_id: req.params.id });
    const lockedShifts = await db('locked_shifts').where({ employee_id: req.params.id });

    res.json({ ...normalizeEmployee(employee), availability, locked_shifts: lockedShifts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create employee
router.post('/', async (req, res) => {
  try {
    const { name, employment_type, is_trainee, roles, max_hours } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const maxHrs = employment_type === 'coop' ? 40 :
                   employment_type === 'external_coop' ? 14 : 20;

    const [id] = await db('employees').insert({
      name,
      employment_type: employment_type || 'part_time',
      is_trainee: is_trainee || false,
      role: serializeRoles(roles),
      max_hours: max_hours || maxHrs,
    });

    // Initialize availability (all available by default)
    const avail = [];
    for (let day = 0; day < 7; day++) {
      for (const period of ['morning', 'afternoon', 'night']) {
        // External co-ops only available weekends
        const isAvailable = employment_type === 'external_coop' ? (day === 0 || day === 6) : true;
        avail.push({ employee_id: id, day_of_week: day, shift_period: period, is_available: isAvailable });
      }
    }
    await db('availability').insert(avail);

    const employee = await db('employees').where({ id }).first();
    res.status(201).json(normalizeEmployee(employee));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update employee
router.put('/:id', async (req, res) => {
  try {
    const { name, employment_type, is_trainee, roles, max_hours } = req.body;
    await db('employees').where({ id: req.params.id }).update({
      name,
      employment_type,
      is_trainee,
      role: serializeRoles(roles),
      max_hours,
    });
    const employee = await db('employees').where({ id: req.params.id }).first();
    res.json(normalizeEmployee(employee));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete employee (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await db('employees').where({ id: req.params.id }).update({ active: false });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get employee availability
router.get('/:id/availability', async (req, res) => {
  try {
    const availability = await db('availability').where({ employee_id: req.params.id });
    res.json(availability);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update employee availability
router.put('/:id/availability', async (req, res) => {
  try {
    const { availability } = req.body; // Array of { day_of_week, shift_period, is_available }
    for (const a of availability) {
      await db('availability')
        .where({ employee_id: req.params.id, day_of_week: a.day_of_week, shift_period: a.shift_period })
        .update({ is_available: a.is_available });
    }
    const updated = await db('availability').where({ employee_id: req.params.id });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unavailable times for employee (base class schedule)
router.get('/:id/unavailable-times', async (req, res) => {
  try {
    const blocks = await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: null })
      .orderBy(['day_of_week', 'start_time']);
    res.json(blocks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set unavailable times for employee (base class schedule)
router.put('/:id/unavailable-times', async (req, res) => {
  try {
    const { blocks } = req.body; // Array of { day_of_week, start_time, end_time, label }
    await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: null })
      .del();
    if (blocks && blocks.length > 0) {
      await db('unavailable_times').insert(
        blocks.map(b => ({
          employee_id: parseInt(req.params.id),
          day_of_week: b.day_of_week,
          start_time: b.start_time,
          end_time: b.end_time,
          label: b.label || null,
          week_start_date: null,
        }))
      );
    }
    const updated = await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: null })
      .orderBy(['day_of_week', 'start_time']);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get weekly unavailable overrides for an employee
router.get('/:id/unavailable-times/:weekStart', async (req, res) => {
  try {
    const blocks = await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: req.params.weekStart })
      .orderBy(['day_of_week', 'start_time']);
    res.json(blocks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set weekly unavailable overrides for an employee
router.put('/:id/unavailable-times/:weekStart', async (req, res) => {
  try {
    const { blocks } = req.body;
    await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: req.params.weekStart })
      .del();
    if (blocks && blocks.length > 0) {
      await db('unavailable_times').insert(
        blocks.map(b => ({
          employee_id: parseInt(req.params.id),
          day_of_week: b.day_of_week,
          start_time: b.start_time,
          end_time: b.end_time,
          label: b.label || null,
          week_start_date: req.params.weekStart,
        }))
      );
    }
    const updated = await db('unavailable_times')
      .where({ employee_id: req.params.id, week_start_date: req.params.weekStart })
      .orderBy(['day_of_week', 'start_time']);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get locked shifts for employee
router.get('/:id/locked-shifts', async (req, res) => {
  try {
    const locked = await db('locked_shifts').where({ employee_id: req.params.id });
    res.json(locked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Set locked shifts for employee
router.put('/:id/locked-shifts', async (req, res) => {
  try {
    const { locked_shifts } = req.body; // Array of { day_of_week, shift_period }
    await db('locked_shifts').where({ employee_id: req.params.id }).del();
    if (locked_shifts && locked_shifts.length > 0) {
      const inserts = locked_shifts.map(ls => ({
        employee_id: parseInt(req.params.id),
        day_of_week: ls.day_of_week,
        shift_period: ls.shift_period,
      }));
      await db('locked_shifts').insert(inserts);
    }
    const updated = await db('locked_shifts').where({ employee_id: req.params.id });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
