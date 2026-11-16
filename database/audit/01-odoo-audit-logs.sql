CREATE TABLE IF NOT EXISTS odoo_audit_logs (
  correlation_id   uuid PRIMARY KEY,
  organization_id  uuid NOT NULL,
  connection_id    uuid NOT NULL,
  expense_id       uuid NOT NULL,
  endpoint         text NOT NULL,
  http_method      text NOT NULL,
  status_code      integer NOT NULL,
  request_payload  text NOT NULL,
  response_payload text NOT NULL,
  duration_ms      integer NOT NULL,
  operation_at     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odoo_audit_logs_organization_created
  ON odoo_audit_logs (organization_id, created_at);

CREATE OR REPLACE FUNCTION odoo_audit_logs_reject_changes() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'odoo_audit_logs only accepts new records';
END;
$$;

CREATE OR REPLACE TRIGGER odoo_audit_logs_no_changes
  BEFORE UPDATE OR DELETE ON odoo_audit_logs
  FOR EACH ROW EXECUTE FUNCTION odoo_audit_logs_reject_changes();

CREATE OR REPLACE TRIGGER odoo_audit_logs_no_truncate
  BEFORE TRUNCATE ON odoo_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION odoo_audit_logs_reject_changes();

REVOKE ALL ON odoo_audit_logs FROM PUBLIC;
