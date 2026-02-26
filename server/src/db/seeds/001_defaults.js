const bcrypt = require('bcrypt');

exports.seed = async function (knex) {
  // Clear existing data
  await knex('locked_shifts').del();
  await knex('schedule_settings').del();
  await knex('schedules').del();
  await knex('shift_configs').del();
  await knex('availability').del();
  await knex('employees').del();
  await knex('users').del();

  // Default admin user (password: wollys@123)
  const hash = await bcrypt.hash('wollys@123', 10);
  await knex('users').insert({ username: 'wollys_admin', password_hash: hash });

  // Default shift configurations
  const shiftConfigs = [
    // Morning slots (5)
    { shift_period: 'morning', slot_index: 0, start_time: '06:00', end_time: '13:00' },
    { shift_period: 'morning', slot_index: 1, start_time: '06:00', end_time: '13:00' },
    { shift_period: 'morning', slot_index: 2, start_time: '07:00', end_time: '14:00' },
    { shift_period: 'morning', slot_index: 3, start_time: '09:00', end_time: '15:00' },
    { shift_period: 'morning', slot_index: 4, start_time: '10:00', end_time: '17:00' },
    // Afternoon slots (4)
    { shift_period: 'afternoon', slot_index: 0, start_time: '11:00', end_time: '18:00' },
    { shift_period: 'afternoon', slot_index: 1, start_time: '13:00', end_time: '19:00' },
    { shift_period: 'afternoon', slot_index: 2, start_time: '14:00', end_time: '20:00' },
    { shift_period: 'afternoon', slot_index: 3, start_time: '15:00', end_time: '20:00' },
    // Night slots (5)
    { shift_period: 'night', slot_index: 0, start_time: '18:00', end_time: '01:00' },
    { shift_period: 'night', slot_index: 1, start_time: '18:00', end_time: '01:00' },
    { shift_period: 'night', slot_index: 2, start_time: '19:00', end_time: '01:00' },
    { shift_period: 'night', slot_index: 3, start_time: '20:00', end_time: '01:00' },
    { shift_period: 'night', slot_index: 4, start_time: '20:00', end_time: '01:00' },
  ];
  await knex('shift_configs').insert(shiftConfigs);
};
