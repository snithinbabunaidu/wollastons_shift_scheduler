const express = require('express');
const crypto = require('crypto');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseRoles(roleJson) {
  if (!roleJson) return [];
  if (Array.isArray(roleJson)) return roleJson;
  try { return JSON.parse(roleJson); } catch { return roleJson ? [roleJson] : []; }
}

function normalizeEmployee(emp) {
  const { role, ...rest } = emp;
  return { ...rest, roles: parseRoles(role) };
}

// ============================================
// Admin endpoints (JWT-protected)
// ============================================

// Get current active invite token
router.get('/token', authenticate, async (req, res) => {
  try {
    const token = await db('registration_tokens')
      .where({ active: true })
      .orderBy('created_at', 'desc')
      .first();

    if (!token) return res.json({ token: null });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      token: token.token,
      url: `${baseUrl}/register?token=${token.token}`,
      created_at: token.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate new invite token (deactivates old ones)
router.post('/generate-token', authenticate, async (req, res) => {
  try {
    // Deactivate all existing tokens
    await db('registration_tokens').where({ active: true }).update({ active: false });

    // Create new token
    const token = generateToken();
    await db('registration_tokens').insert({ token, active: true });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      token,
      url: `${baseUrl}/register?token=${token}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deactivate current invite token
router.delete('/token', authenticate, async (req, res) => {
  try {
    await db('registration_tokens').where({ active: true }).update({ active: false });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// Public endpoints (token-validated)
// ============================================

// Validate an invite token
router.get('/validate/:token', async (req, res) => {
  try {
    const token = await db('registration_tokens')
      .where({ token: req.params.token, active: true })
      .first();

    if (!token) {
      return res.json({ valid: false, reason: 'Invalid or expired registration link' });
    }

    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return res.json({ valid: false, reason: 'Registration link has expired' });
    }

    res.json({ valid: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Self-register as new employee
router.post('/register', async (req, res) => {
  try {
    const { invite_token, name, employment_type, gender, is_trainee, unavailable_blocks } = req.body;

    // Validate invite token
    const token = await db('registration_tokens')
      .where({ token: invite_token, active: true })
      .first();

    if (!token) {
      return res.status(403).json({ error: 'Invalid or expired registration link' });
    }

    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Registration link has expired' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Calculate max hours based on employment type
    const empType = employment_type || 'part_time';
    const maxHrs = empType === 'coop' ? 40 : empType === 'external_coop' ? 20 : 20;

    // Generate edit token for this employee
    const editToken = generateToken();

    // Insert employee
    const [inserted] = await db('employees').insert({
      name: name.trim(),
      employment_type: empType,
      is_trainee: is_trainee || false,
      role: '[]',
      max_hours: maxHrs,
      gender: gender || null,
      edit_token: editToken,
    }).returning('id');
    const id = typeof inserted === 'object' ? inserted.id : inserted;

    // Initialize availability (all available by default, external co-ops weekends only)
    const avail = [];
    for (let day = 0; day < 7; day++) {
      for (const period of ['morning', 'afternoon', 'night']) {
        const isAvailable = empType === 'external_coop' ? (day === 0 || day === 6) : true;
        avail.push({ employee_id: id, day_of_week: day, shift_period: period, is_available: isAvailable });
      }
    }
    await db('availability').insert(avail);

    // Insert unavailable time blocks if provided
    if (unavailable_blocks && Array.isArray(unavailable_blocks) && unavailable_blocks.length > 0) {
      const blocks = unavailable_blocks.map(b => ({
        employee_id: id,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        label: b.label || null,
        week_start_date: null, // recurring (class schedule)
      }));
      await db('unavailable_times').insert(blocks);
    }

    const employee = await db('employees').where({ id }).first();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.status(201).json({
      employee: normalizeEmployee(employee),
      edit_url: `${baseUrl}/my-schedule?token=${editToken}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get employee data by edit token
router.get('/employee/:editToken', async (req, res) => {
  try {
    const employee = await db('employees')
      .where({ edit_token: req.params.editToken, active: true })
      .first();

    if (!employee) {
      return res.status(404).json({ error: 'Invalid link or employee not found' });
    }

    // Get class schedule (recurring unavailable times)
    const unavailableBlocks = await db('unavailable_times')
      .where({ employee_id: employee.id, week_start_date: null })
      .orderBy(['day_of_week', 'start_time']);

    res.json({
      employee: normalizeEmployee(employee),
      unavailable_blocks: unavailableBlocks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update employee info by edit token
router.put('/employee/:editToken', async (req, res) => {
  try {
    const employee = await db('employees')
      .where({ edit_token: req.params.editToken, active: true })
      .first();

    if (!employee) {
      return res.status(404).json({ error: 'Invalid link or employee not found' });
    }

    const { name, employment_type, gender, is_trainee } = req.body;

    // Auto-calculate max hours from employment type
    const empType = employment_type || employee.employment_type;
    const maxHrs = empType === 'coop' ? 40 : empType === 'external_coop' ? 20 : 20;

    await db('employees').where({ id: employee.id }).update({
      name: name || employee.name,
      employment_type: empType,
      gender: gender !== undefined ? (gender || null) : employee.gender,
      is_trainee: is_trainee !== undefined ? is_trainee : employee.is_trainee,
      max_hours: maxHrs,
    });

    // Update availability if employment type changed
    if (employment_type && employment_type !== employee.employment_type) {
      for (let day = 0; day < 7; day++) {
        for (const period of ['morning', 'afternoon', 'night']) {
          const isAvailable = empType === 'external_coop' ? (day === 0 || day === 6) : true;
          await db('availability')
            .where({ employee_id: employee.id, day_of_week: day, shift_period: period })
            .update({ is_available: isAvailable });
        }
      }
    }

    const updated = await db('employees').where({ id: employee.id }).first();
    res.json({ employee: normalizeEmployee(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update class schedule by edit token
router.put('/employee/:editToken/unavailable-times', async (req, res) => {
  try {
    const employee = await db('employees')
      .where({ edit_token: req.params.editToken, active: true })
      .first();

    if (!employee) {
      return res.status(404).json({ error: 'Invalid link or employee not found' });
    }

    const { blocks } = req.body;

    // Delete existing recurring blocks
    await db('unavailable_times')
      .where({ employee_id: employee.id, week_start_date: null })
      .del();

    // Insert new blocks
    if (blocks && Array.isArray(blocks) && blocks.length > 0) {
      const rows = blocks.map(b => ({
        employee_id: employee.id,
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        label: b.label || null,
        week_start_date: null,
      }));
      await db('unavailable_times').insert(rows);
    }

    const updatedBlocks = await db('unavailable_times')
      .where({ employee_id: employee.id, week_start_date: null })
      .orderBy(['day_of_week', 'start_time']);

    res.json({ unavailable_blocks: updatedBlocks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
