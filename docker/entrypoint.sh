#!/bin/sh
set -eu

: "${ODOO_AUDIT_DB_PATH:=./data/odoo-audit.sqlite}"
: "${AUDIT_INIT_DIR:=/docker-entrypoint-initdb.d}"

mkdir -p "$(dirname "$ODOO_AUDIT_DB_PATH")"
for script in "$AUDIT_INIT_DIR"/*.sql; do
  [ -e "$script" ] || continue
  sqlite3 "$ODOO_AUDIT_DB_PATH" < "$script" > /dev/null
done

exec "$@"
