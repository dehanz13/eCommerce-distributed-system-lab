exports.up = (pgm) =>
  pgm.sql(`-- Statement-level revision changes commit or roll back with every catalog write.
-- Versioned cache keys make late fills of an older revision harmless.
CREATE TABLE catalog_revision (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision bigint NOT NULL DEFAULT 0);
INSERT INTO catalog_revision(singleton) VALUES(true);
CREATE FUNCTION advance_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE catalog_revision SET revision=revision+1 WHERE singleton=true;
 RETURN NULL;
END;
$$;
CREATE TRIGGER products_catalog_revision AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH STATEMENT EXECUTE FUNCTION advance_catalog_revision();
`);
exports.down = (pgm) =>
  pgm.sql(
    'DROP TRIGGER products_catalog_revision ON products; DROP FUNCTION advance_catalog_revision(); DROP TABLE catalog_revision;',
  );
