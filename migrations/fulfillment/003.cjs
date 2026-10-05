exports.up = (pgm) =>
  pgm.sql(`ALTER TABLE jobs ADD COLUMN submission_reference text
    CHECK (submission_reference ~ '^[a-f0-9]{64}$');`);
exports.down = (pgm) => pgm.sql('ALTER TABLE jobs DROP COLUMN submission_reference');
