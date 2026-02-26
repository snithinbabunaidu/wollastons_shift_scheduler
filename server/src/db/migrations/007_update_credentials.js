const bcrypt = require('bcrypt');

exports.up = async function (knex) {
  // Update admin credentials: username -> wollys_admin, password -> wollys@123
  const hash = await bcrypt.hash('wollys@123', 10);

  // Update existing admin user or insert new one
  const existingAdmin = await knex('users').where({ username: 'admin' }).first();
  if (existingAdmin) {
    await knex('users').where({ username: 'admin' }).update({
      username: 'wollys_admin',
      password_hash: hash,
    });
  } else {
    // Check if wollys_admin already exists
    const existingWollys = await knex('users').where({ username: 'wollys_admin' }).first();
    if (!existingWollys) {
      await knex('users').insert({
        username: 'wollys_admin',
        password_hash: hash,
      });
    } else {
      // Just update the password
      await knex('users').where({ username: 'wollys_admin' }).update({
        password_hash: hash,
      });
    }
  }

  // Update external co-op max hours from 14 to 20
  await knex('employees')
    .where({ employment_type: 'external_coop', max_hours: 14 })
    .update({ max_hours: 20 });
};

exports.down = async function (knex) {
  const hash = await bcrypt.hash('admin123', 10);
  const existingWollys = await knex('users').where({ username: 'wollys_admin' }).first();
  if (existingWollys) {
    await knex('users').where({ username: 'wollys_admin' }).update({
      username: 'admin',
      password_hash: hash,
    });
  }

  // Revert external co-op max hours back to 14
  await knex('employees')
    .where({ employment_type: 'external_coop', max_hours: 20 })
    .update({ max_hours: 14 });
};
