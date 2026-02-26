exports.up = async function (knex) {
  await knex.schema.createTable('registration_tokens', (t) => {
    t.increments('id').primary();
    t.string('token').notNullable().unique();
    t.boolean('active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('expires_at').nullable();
  });

  await knex.schema.alterTable('employees', (t) => {
    t.string('edit_token').nullable().unique();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('registration_tokens');

  const hasColumn = await knex.schema.hasColumn('employees', 'edit_token');
  if (hasColumn) {
    await knex.schema.alterTable('employees', (t) => {
      t.dropColumn('edit_token');
    });
  }
};
