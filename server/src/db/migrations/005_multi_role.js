exports.up = async function (knex) {
  // Convert existing single-role strings to JSON arrays
  const employees = await knex('employees').whereNotNull('role');
  for (const emp of employees) {
    if (emp.role && !emp.role.startsWith('[')) {
      await knex('employees')
        .where({ id: emp.id })
        .update({ role: JSON.stringify([emp.role]) });
    }
  }
  // Set NULLs to empty array for consistency
  await knex('employees').whereNull('role').update({ role: '[]' });
};

exports.down = async function (knex) {
  // Revert: unwrap first element back to single string
  const employees = await knex('employees');
  for (const emp of employees) {
    try {
      const roles = JSON.parse(emp.role || '[]');
      await knex('employees')
        .where({ id: emp.id })
        .update({ role: roles[0] || null });
    } catch (e) {
      // Already a plain string, leave it
    }
  }
};
