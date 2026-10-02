exports.up = (pgm) =>
  pgm.sql(`
CREATE TABLE settings(id integer PRIMARY KEY CHECK(id=1),preset text NOT NULL CHECK(preset IN ('success','slow','retry','fail')),paused boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO settings VALUES(1,'success',false,now());
CREATE TABLE jobs(id uuid PRIMARY KEY,order_id uuid UNIQUE NOT NULL,preset text NOT NULL,status text NOT NULL CHECK(status IN ('queued','processing','retry_wait','completed','failed')),attempt_number integer NOT NULL DEFAULT 0,correlation_id uuid NOT NULL,causation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),next_attempt_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,failed_at timestamptz);
CREATE TABLE attempts(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES jobs(id),attempt_number integer NOT NULL,status text NOT NULL CHECK(status IN ('processing','completed','failed')),started_at timestamptz NOT NULL DEFAULT now(),due_at timestamptz NOT NULL,finished_at timestamptz,failure_code text,UNIQUE(job_id,attempt_number));
CREATE TABLE outbox(id uuid PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE INDEX pending_outbox ON outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE inbox(id uuid PRIMARY KEY,consumed_at timestamptz NOT NULL DEFAULT now());
`);
exports.down = (pgm) => pgm.sql('DROP TABLE inbox,outbox,attempts,jobs,settings CASCADE');
