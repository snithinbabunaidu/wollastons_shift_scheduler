exports.up = function (knex) {
  return knex.schema.table('employees', (t) => {
    t.string('gender').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.table('employees', (t) => {
    t.dropColumn('gender');
  });
};
