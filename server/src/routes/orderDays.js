const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Get order days configuration
router.get('/', async (req, res) => {
  try {
    const rows = await db('order_days');
    const result = { ag: [], us: [] };
    for (const row of rows) {
      result[row.order_type].push(row.day_of_week);
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update order days configuration
router.put('/', async (req, res) => {
  try {
    const { ag, us } = req.body; // ag: [0,2,4], us: [1,3]

    await db('order_days').del();

    const rows = [];
    if (ag) {
      for (const day of ag) {
        rows.push({ order_type: 'ag', day_of_week: day });
      }
    }
    if (us) {
      for (const day of us) {
        rows.push({ order_type: 'us', day_of_week: day });
      }
    }

    if (rows.length > 0) {
      await db('order_days').insert(rows);
    }

    res.json({ ag: ag || [], us: us || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
