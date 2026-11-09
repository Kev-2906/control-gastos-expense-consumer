PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS odoo_audit_logs (
  correlation_id   TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  connection_id    TEXT NOT NULL,
  expense_id       TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  http_method      TEXT NOT NULL,
  status_code      INTEGER NOT NULL,
  request_payload  TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  duration_ms      INTEGER NOT NULL,
  operation_at     TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS IDX_odoo_audit_logs_organization_created
  ON odoo_audit_logs (organization_id, created_at);

CREATE TRIGGER IF NOT EXISTS odoo_audit_logs_no_update
  BEFORE UPDATE ON odoo_audit_logs
  BEGIN SELECT RAISE(ABORT, 'odoo_audit_logs only accepts new records'); END;

CREATE TRIGGER IF NOT EXISTS odoo_audit_logs_no_delete
  BEFORE DELETE ON odoo_audit_logs
  BEGIN SELECT RAISE(ABORT, 'odoo_audit_logs only accepts new records'); END;
