exports.up = function (knex) {
  return knex.schema.createTable('unavailable_times', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable()
      .references('id').inTable('employees').onDelete('CASCADE');
    t.integer('day_of_week').notNullable(); // 0=Sunday, 6=Saturday
    t.string('start_time').notNullable(); // "10:00" format
    t.string('end_time').notNullable(); // "14:00" format
    t.string('label').nullable(); // e.g., "Chemistry 101"
    t.date('week_start_date').nullable(); // null = recurring (class schedule), set = one-time override
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('unavailable_times');
};
