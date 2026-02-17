const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Get all shift configs
router.get('/', async (req, res) => {
  try {
    const configs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);
    res.json(configs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Replace all shift configs
router.put('/', async (req, res) => {
  try {
    const { configs } = req.body; // Array of { shift_period, slot_index, start_time, end_time }
    await db('shift_configs').del();
    if (configs && configs.length > 0) {
      await db('shift_configs').insert(
        configs.map(c => ({
          shift_period: c.shift_period,
          slot_index: c.slot_index,
          start_time: c.start_time,
          end_time: c.end_time,
          is_default: false,
        }))
      );
    }
    const updated = await db('shift_configs').orderBy(['shift_period', 'slot_index']);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset to defaults
router.post('/reset', async (req, res) => {
  try {
    await db('shift_configs').del();
    const defaults = [
      { shift_period: 'morning', slot_index: 0, start_time: '06:00', end_time: '13:00', is_default: true },
      { shift_period: 'morning', slot_index: 1, start_time: '06:00', end_time: '13:00', is_default: true },
      { shift_period: 'morning', slot_index: 2, start_time: '07:00', end_time: '14:00', is_default: true },
      { shift_period: 'morning', slot_index: 3, start_time: '09:00', end_time: '15:00', is_default: true },
      { shift_period: 'morning', slot_index: 4, start_time: '10:00', end_time: '17:00', is_default: true },
      { shift_period: 'afternoon', slot_index: 0, start_time: '11:00', end_time: '18:00', is_default: true },
      { shift_period: 'afternoon', slot_index: 1, start_time: '13:00', end_time: '19:00', is_default: true },
      { shift_period: 'afternoon', slot_index: 2, start_time: '14:00', end_time: '20:00', is_default: true },
      { shift_period: 'afternoon', slot_index: 3, start_time: '15:00', end_time: '20:00', is_default: true },
      { shift_period: 'night', slot_index: 0, start_time: '18:00', end_time: '01:00', is_default: true },
      { shift_period: 'night', slot_index: 1, start_time: '18:00', end_time: '01:00', is_default: true },
      { shift_period: 'night', slot_index: 2, start_time: '19:00', end_time: '01:00', is_default: true },
      { shift_period: 'night', slot_index: 3, start_time: '20:00', end_time: '01:00', is_default: true },
      { shift_period: 'night', slot_index: 4, start_time: '20:00', end_time: '01:00', is_default: true },
    ];
    await db('shift_configs').insert(defaults);
    res.json(defaults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
