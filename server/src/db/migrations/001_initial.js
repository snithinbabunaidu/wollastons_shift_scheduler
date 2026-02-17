exports.up = function (knex) {
  return knex.schema
    .createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username').notNullable().unique();
      t.string('password_hash').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('employees', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.enum('employment_type', ['part_time', 'coop', 'external_coop']).defaultTo('part_time');
      t.boolean('is_trainee').defaultTo(false);
      t.string('role').nullable(); // morning_manager, afternoon_manager, night_manager, ag_food_order, us_food_order
      t.integer('max_hours').defaultTo(20);
      t.boolean('active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('availability', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('CASCADE');
      t.integer('day_of_week').notNullable(); // 0=Sunday, 6=Saturday
      t.enum('shift_period', ['morning', 'afternoon', 'night']).notNullable();
      t.boolean('is_available').defaultTo(true);
      t.unique(['employee_id', 'day_of_week', 'shift_period']);
    })
    .createTable('shift_configs', (t) => {
      t.increments('id').primary();
      t.enum('shift_period', ['morning', 'afternoon', 'night']).notNullable();
      t.integer('slot_index').notNullable();
      t.string('start_time').notNullable(); // "06:00"
      t.boolean('is_default').defaultTo(true);
    })
    .createTable('schedules', (t) => {
      t.increments('id').primary();
      t.date('week_start_date').notNullable();
      t.integer('day_of_week').notNullable();
      t.enum('shift_period', ['morning', 'afternoon', 'night']).notNullable();
      t.integer('slot_index').notNullable();
      t.integer('employee_id').unsigned().nullable()
        .references('id').inTable('employees').onDelete('SET NULL');
      t.boolean('is_locked').defaultTo(false);
      t.string('start_time').nullable();
      t.unique(['week_start_date', 'day_of_week', 'shift_period', 'slot_index']);
    })
    .createTable('schedule_settings', (t) => {
      t.increments('id').primary();
      t.date('week_start_date').notNullable();
      t.integer('day_of_week').notNullable();
      t.enum('shift_period', ['morning', 'afternoon', 'night']).notNullable();
      t.integer('employee_count').notNullable().defaultTo(5);
      t.unique(['week_start_date', 'day_of_week', 'shift_period']);
    })
    .createTable('locked_shifts', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').unsigned().notNullable()
        .references('id').inTable('employees').onDelete('CASCADE');
      t.integer('day_of_week').notNullable();
      t.enum('shift_period', ['morning', 'afternoon', 'night']).notNullable();
      t.unique(['employee_id', 'day_of_week', 'shift_period']);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('locked_shifts')
    .dropTableIfExists('schedule_settings')
    .dropTableIfExists('schedules')
    .dropTableIfExists('shift_configs')
    .dropTableIfExists('availability')
    .dropTableIfExists('employees')
    .dropTableIfExists('users');
};
