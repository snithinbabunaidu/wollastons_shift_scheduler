exports.up = function (knex) {
  return knex.schema.createTable('order_days', (t) => {
    t.increments('id').primary();
    t.enum('order_type', ['ag', 'us']).notNullable();
    t.integer('day_of_week').notNullable(); // 0=Sunday, 6=Saturday
    t.unique(['order_type', 'day_of_week']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('order_days');
};
