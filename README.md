# Base de la auditoría

El consumer guarda cada petición que hace a Odoo en la tabla `odoo_audit_logs`, que vive en su propia base de PostgreSQL, separada de la base del backend. Aquí se explica cómo crearla desde cero.

## Qué se crea

| Qué | Nombre | Para qué |
|---|---|---|
| Base | `gastos_audit` | Solo la auditoría |
| Rol dueño | `gastos_audit_owner` | Es dueño de la base y de la tabla. Corre `pnpm audit:migrate` y es con el que se consulta |
| Rol del servicio | `gastos_audit_app` | Con el que corre el consumer. **Solo puede insertar** |

Los nombres pueden ser otros; lo que importa es que coincidan con el `.env`.

**Lo que puede hacer cada rol:**

| | `INSERT` | `SELECT` | `UPDATE` / `DELETE` / `TRUNCATE` |
|---|---|---|---|
| `gastos_audit_app` | Sí | No | No |
| `gastos_audit_owner` | Sí | Sí | No: unos triggers lo rechazan con `odoo_audit_logs only accepts new records` |

## Requisitos

- **PostgreSQL 14 o más nuevo.** Puede ser el mismo servidor donde está la base del backend.
- **`psql`** y un **usuario administrador** de PostgreSQL:
  - **Mac con Homebrew:** tu propio usuario. Entra con `psql -d postgres`.
  - **Windows:** el usuario `postgres` que pediste al instalar. Entra con `psql -U postgres -d postgres`. Si PowerShell no encuentra `psql`, está en `C:\Program Files\PostgreSQL\<versión>\bin`; agrégalo al `PATH` o usa la ruta completa.
  - **Linux:** `sudo -u postgres psql`.

## 1. Crear los roles y la base

Elige dos contraseñas largas, una para cada rol. Entra a `psql` con el administrador (ver Requisitos) y pega esto con tus contraseñas:

```sql
CREATE ROLE gastos_audit_owner LOGIN PASSWORD 'contraseña-del-dueño';
CREATE ROLE gastos_audit_app LOGIN PASSWORD 'contraseña-de-la-app';
CREATE DATABASE gastos_audit OWNER gastos_audit_owner;
```

Sal con `\q`.

Hacerlo dentro de `psql`, y no con `psql -c "..."`, evita problemas con las comillas en PowerShell.

**Si `CREATE DATABASE` responde `must be able to SET ROLE "gastos_audit_owner"`,** tu administrador no es superusuario. Pasa, por ejemplo, con el usuario maestro de RDS. Corre esto antes y vuelve a intentar:

```sql
GRANT gastos_audit_owner TO CURRENT_USER;
```

## 2. Llenar el `.env` del consumer

| Variable | Valor |
|---|---|
| `AUDIT_DATABASE_HOST` | `localhost`, o el servidor de PostgreSQL |
| `AUDIT_DATABASE_PORT` | `5432` |
| `AUDIT_DATABASE_NAME` | `gastos_audit` |
| `AUDIT_DATABASE_USERNAME` | `gastos_audit_app` |
| `AUDIT_DATABASE_PASSWORD` | La contraseña de `gastos_audit_app` |
| `AUDIT_MIGRATION_DATABASE_USERNAME` | `gastos_audit_owner` |
| `AUDIT_MIGRATION_DATABASE_PASSWORD` | La contraseña de `gastos_audit_owner` |

- **Las dos de `AUDIT_MIGRATION_*` solo las usa `pnpm audit:migrate`.** El consumer no las necesita para correr; en producción no las dejes en su `.env` (ver En producción).
- **Sin las `AUDIT_DATABASE_*` el consumer no arranca:** al iniciar dice qué variable falta.

## 3. Crear la tabla y los permisos

Desde la carpeta del consumer:

```bash
pnpm install
pnpm audit:migrate
```

Debe responder:

```
Applied 01-odoo-audit-logs.sql
Granted INSERT on odoo_audit_logs to gastos_audit_app
```

`pnpm audit:migrate`:

1. Se conecta con el rol dueño.
2. Aplica en orden alfabético todos los `.sql` de esta carpeta, en una sola transacción: si uno falla, no queda nada a medias.
3. Le da a `AUDIT_DATABASE_USERNAME` permiso de `INSERT`, y nada más.

Se puede correr las veces que quieras: los scripts están escritos para repetirse sin error.

**Cuándo correrlo:** la primera vez, y cada vez que alguien agregue o cambie un `.sql` de esta carpeta.

## 4. Comprobar

Entra como el dueño:

```bash
psql -h localhost -U gastos_audit_owner -d gastos_audit
```

Revisa los permisos de la tabla:

```sql
\dp odoo_audit_logs
```

En la columna de privilegios debe aparecer `gastos_audit_app=a/gastos_audit_owner`. La `a` es `INSERT`, y no debe tener ninguna otra letra.

Después levanta el consumer con `pnpm start`, envía un gasto desde el portal y cuenta los registros:

```sql
select count(*) from odoo_audit_logs;
```

Un gasto deja unas 9 a 11 filas, una por cada petición a Odoo.

## Cambiar una contraseña

Con el administrador o con el mismo rol:

```sql
ALTER ROLE gastos_audit_app PASSWORD 'contraseña-nueva';
```

Actualiza el `.env` y reinicia el consumer.

## Agregar un cambio a la tabla

- **No edites `01-odoo-audit-logs.sql`** para cambiar una tabla que ya existe: en una base que ya la tiene, el `CREATE TABLE IF NOT EXISTS` no hace nada.
- **Crea otro archivo**, por ejemplo `02-agregar-columna.sql`, que se pueda repetir sin error:

  ```sql
  ALTER TABLE odoo_audit_logs ADD COLUMN IF NOT EXISTS nueva_columna text;
  ```

- **Corre `pnpm audit:migrate`.**

## En producción

- **Su propia instancia de PostgreSQL**, por ejemplo otro RDS, con copias automáticas. Así no comparte disco, carga ni respaldos con la base del backend.
- **Los mismos pasos 1 a 3.** En RDS, el usuario maestro no es superusuario: usa el `GRANT ... TO CURRENT_USER` del paso 1.
- **Las credenciales del dueño no viven en el servidor del consumer.** Pásalas solo al correr la migración:
  - con el código fuente: `pnpm audit:migrate`;
  - con el código compilado: `node dist/scripts/audit-migrate.js`, desde la carpeta del consumer para que encuentre `database/audit/`.
- **Respaldo manual**, además de las copias automáticas:

  ```bash
  pg_dump -h <servidor> -U gastos_audit_owner -d gastos_audit -Fc -f auditoria.dump
  ```

## Problemas comunes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `pnpm audit:migrate` dice `password authentication failed` | La contraseña de `AUDIT_MIGRATION_DATABASE_PASSWORD` no es la del rol | Corrígela en el `.env`, o cámbiala con `ALTER ROLE` |
| `database "gastos_audit" does not exist` | Falta el paso 1, o `AUDIT_DATABASE_NAME` tiene otro nombre | Paso 1 |
| `must be able to SET ROLE "gastos_audit_owner"` | Tu administrador no es superusuario | El `GRANT ... TO CURRENT_USER` del paso 1 |
| Los envíos quedan esperando con `AUDIT_UNAVAILABLE` y el motivo dice `permission denied for table odoo_audit_logs` | No se corrió `pnpm audit:migrate`, o se corrió con otro `AUDIT_DATABASE_USERNAME` | Paso 3, con el `.env` correcto |
| Los envíos quedan esperando con `AUDIT_UNAVAILABLE` y el motivo dice `relation "odoo_audit_logs" does not exist` | No se creó la tabla | Paso 3 |
| Los envíos quedan esperando con `AUDIT_UNAVAILABLE` y el motivo dice `ECONNREFUSED` o `timeout` | PostgreSQL no está corriendo o el host o el puerto están mal | Revisa `AUDIT_DATABASE_HOST` y `AUDIT_DATABASE_PORT` |
| PowerShell dice que no encuentra `psql` | La carpeta `bin` de PostgreSQL no está en el `PATH` | Ver Requisitos |
