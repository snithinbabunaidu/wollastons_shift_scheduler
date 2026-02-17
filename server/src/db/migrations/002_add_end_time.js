exports.up = function (knex) {
  return knex.schema
    .alterTable('shift_configs', (t) => {
      t.string('end_time').nullable(); // e.g. "13:00"
    })
    .alterTable('schedules', (t) => {
      t.string('end_time').nullable();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('shift_configs', (t) => {
      t.dropColumn('end_time');
    })
    .alterTable('schedules', (t) => {
      t.dropColumn('end_time');
    });
};
