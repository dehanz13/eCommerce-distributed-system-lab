// These constraints also protect the learning guarantees during manual database inspection.
exports.up = (pgm) =>
  pgm.sql(`
ALTER TABLE jobs ADD CONSTRAINT job_attempt_budget CHECK(attempt_number BETWEEN 0 AND 3);
ALTER TABLE jobs ADD CONSTRAINT job_preset CHECK(preset IN ('success','slow','retry','fail'));
ALTER TABLE attempts ADD CONSTRAINT attempt_budget CHECK(attempt_number BETWEEN 1 AND 3);
CREATE UNIQUE INDEX one_active_attempt ON attempts((true)) WHERE status='processing';
`);
exports.down = (pgm) =>
  pgm.sql(
    `DROP INDEX one_active_attempt; ALTER TABLE attempts DROP CONSTRAINT attempt_budget; ALTER TABLE jobs DROP CONSTRAINT job_preset, DROP CONSTRAINT job_attempt_budget;`,
  );
