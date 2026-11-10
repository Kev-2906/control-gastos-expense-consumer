# control-gastos-expense-consumer

Envía a Odoo los gastos del Portal Externo de Gastos y deja una auditoría de cada petición.

## Qué hace

1. El backend (`control-gastos-backend`) recibe el clic en **Enviar**, deja el gasto en `submitted` y publica el evento `expense.submitted` en RabbitMQ.
2. Este servicio escucha la cola `backend.expense-send` y, por cada gasto:
   - revisa en Odoo que sus catálogos sigan vigentes;
   - lo crea con `hr.expense/load` y el External ID `portal_gastos.<expense_id>`, para que un reintento nunca cree un segundo gasto;
   - sube los comprobantes y llama a `action_submit`;
   - guarda el resultado en la tabla `expense_submissions` de PostgreSQL: `sent`, o `failed` con el código del error.
3. Si el error es temporal (por ejemplo, Odoo no responde), RabbitMQ lo vuelve a entregar con una espera de 5, 10, 15… hasta 60 minutos, hasta 173 veces (unos 7 días). Si es un error de datos, no se reintenta y el gasto regresa a borrador.
4. Cada petición a Odoo queda registrada en la **auditoría**, un archivo SQLite (ver más abajo).

## Requisitos

- **Docker Desktop** (Mac o Windows) o **Docker Engine** con el plugin `compose` (Linux).
- Corriendo en la misma máquina: PostgreSQL con la base del backend, el RabbitMQ del `docker-compose.yml` del backend y, en desarrollo, tu Odoo local.

## Levantarlo con Docker

### 1. Crear el `.env`

Mac y Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Llénalo con los mismos valores del `.env` del backend: base de datos, RabbitMQ, `FRONTEND_URL` y `SECRETS_ENCRYPTION_KEY`. `FRONTEND_URL` sirve para el enlace "Ver el gasto" del correo que se manda cuando el gasto llega a Odoo. Esa llave tiene que ser la misma, porque con ella el backend cifró las API Keys de Odoo y este servicio las descifra. El `.env` nunca se sube al repositorio.

`DATABASE_HOST`, `RABBITMQ_HOST` y `ODOO_AUDIT_DB_PATH` puedes dejarlos como están. En desarrollo, el `docker-compose.override.yml` reemplaza los dos primeros (ver el paso 2), y el `docker-compose.yml` fija la ruta de la auditoría dentro del volumen.

### 2. Hacer que `host.docker.internal` llegue a tu máquina

**Por qué:** dentro de un contenedor, `localhost` es el propio contenedor, no tu computadora. Para que el consumer llegue a PostgreSQL, a RabbitMQ y a tu Odoo, que corren en tu máquina, se usa el nombre `host.docker.internal`:

- **Dentro del contenedor** ese nombre ya apunta a tu máquina. Lo asegura `extra_hosts` en el `docker-compose.override.yml`, que hace falta en Linux.
- **En tu máquina** también tiene que existir. El backend corre fuera de Docker y usa la misma URL de Odoo que el consumer, porque ambos la leen de la conexión guardada en la base. Si tu sistema no lo conoce, el backend no podrá crear ni sincronizar la conexión.

Primero comprueba si ya existe:

```bash
ping host.docker.internal
```

Si responde, no hagas nada. Si dice que no encuentra el nombre, agrégalo a tu archivo `hosts`.

**Mac y Linux:**

```bash
echo "127.0.0.1 host.docker.internal" | sudo tee -a /etc/hosts
```

**Windows:** abre PowerShell **como administrador** y corre:

```powershell
Add-Content -Path "$env:windir\System32\drivers\etc\hosts" -Value "`r`n127.0.0.1 host.docker.internal"
```

El `` `r`n `` del inicio asegura que la línea no quede pegada a la última del archivo. También puedes abrir el Bloc de notas como administrador, editar `C:\Windows\System32\drivers\etc\hosts` y agregar la línea al final. En Windows, Docker Desktop suele agregar este nombre por su cuenta; si el `ping` ya respondía, no agregues otra línea.

Esto es solo para desarrollo; en producción no se usa (ver [En producción](#en-producción)).

### 3. Usar esa URL en la conexión de Odoo

En el portal, la conexión de Odoo debe tener como `baseUrl`:

```
http://host.docker.internal:8069
```

Si ya la tenías con `http://localhost:8069`, actualízala con `PUT /api/v1/organizations/:organizationId/odoo-connections/:connectionId`. Es el mismo Odoo; solo cambia el nombre con el que se llega a él.

### 4. Levantar el servicio

```bash
docker compose up -d --build
```

En desarrollo, `docker compose` junta solo dos archivos:

| Archivo | Qué tiene |
|---|---|
| `docker-compose.yml` | El servicio, el volumen de la auditoría, `restart` y el límite de memoria. Los hosts salen del `.env`. Es lo único que va a producción |
| `docker-compose.override.yml` | Solo lo de desarrollo: `DATABASE_HOST` y `RABBITMQ_HOST` = `host.docker.internal`, y `extra_hosts` para que ese nombre funcione en Linux. Docker Compose lo carga solo cuando existe |

### 5. Comprobar que arrancó

```bash
docker compose logs -f expense-consumer
```

Debe aparecer `Expense consumer started`. En la interfaz de RabbitMQ (http://localhost:15672), la cola `backend.expense-send` debe mostrar 1 consumer.

### Comandos del día a día

Son iguales en Mac, Linux y Windows:

| Para | Comando |
|---|---|
| Ver los logs | `docker compose logs -f expense-consumer` |
| Detenerlo | `docker compose stop` |
| Iniciarlo otra vez | `docker compose start` |
| Aplicar cambios del código | `docker compose up -d --build` |
| Recrear el contenedor | `docker compose up -d --force-recreate` |
| Quitar el contenedor (la auditoría se conserva) | `docker compose down` |
| Quitar el contenedor **y borrar la auditoría** | `docker compose down -v` |

## ¿Y la URL de Odoo?

No está en el `.env` ni en el compose, y no debe estar: el servicio atiende a **todas** las organizaciones y cada una tiene su propio Odoo.

```
Gasto de Acme   → conexión de Acme   → https://acme.odoo.com
Gasto de Beta   → conexión de Beta   → https://beta-sa.odoo.com
```

Por cada gasto, el servicio lee de la tabla `odoo_connections` la URL que capturó el administrador de esa organización en el portal, y llama a esa URL. Si la URL de Odoo estuviera en la configuración, el servicio solo podría hablar con un Odoo.

`host.docker.internal` tampoco es "la URL de Odoo". En el compose de desarrollo sirve para PostgreSQL y RabbitMQ. En la conexión de Odoo solo se usa cuando el Odoo corre en tu propia máquina, porque desde el contenedor `localhost` no llega a ella. En producción, el administrador captura la URL pública de su Odoo, y el backend, con `NODE_ENV=production`, solo acepta conexiones `https`.

## En producción

- **Solo con el archivo base:** `docker compose -f docker-compose.yml up -d --build`, o no subir el `docker-compose.override.yml` al servidor.
- **Los hosts reales en las variables de entorno**, según dónde estén PostgreSQL y RabbitMQ:
  - en el mismo compose que el servicio: el nombre del servicio, por ejemplo `DATABASE_HOST=postgres`;
  - en un servicio administrado: su dirección, por ejemplo `DATABASE_HOST=xxxx.rds.amazonaws.com`;
  - instalados directo en el servidor, fuera de Docker: `host.docker.internal`, agregando `extra_hosts: ['host.docker.internal:host-gateway']`.
- **Las URLs de Odoo** las captura cada administrador en el portal, con `https`.
- **Una sola instancia** del servicio, por la auditoría en SQLite (ver abajo).
- **Respaldar el volumen** `odoo-audit-data` con `.backup` (ver [Respaldar](#respaldar)).
- **Nada de `/etc/hosts`:** ese paso es solo para la laptop de desarrollo.

## La auditoría (SQLite)

### Por qué un archivo y no un contenedor de base de datos

PostgreSQL es un servidor: un programa aparte que escucha en un puerto, y por eso tiene su propio contenedor. SQLite no es un servidor, sino una librería que vive dentro de este servicio (Node 24 la trae como `node:sqlite`) y escribe directamente en un archivo. No hay nada a lo que conectarse por red, así que el archivo tiene que estar donde corre el proceso que escribe.

Docker guarda ese archivo en el volumen `odoo-audit-data`, montado en `/app/data`. Sin el volumen, el archivo viviría dentro del contenedor y se perdería cada vez que se recrea o se actualiza.

### Cómo se crea la tabla

Igual que las imágenes de PostgreSQL ejecutan los `.sql` de `/docker-entrypoint-initdb.d/`, este contenedor aplica al arrancar los scripts de [`docker/sqlite/init/`](docker/sqlite/init) al archivo del volumen. Lo hace [`docker/entrypoint.sh`](docker/entrypoint.sh), antes de iniciar el servicio.

- El esquema vive **solo** en [`docker/sqlite/init/01-odoo-audit-logs.sql`](docker/sqlite/init/01-odoo-audit-logs.sql). El código no crea tablas: si la tabla no existe, el servicio se detiene al arrancar con `no such table: odoo_audit_logs`.
- Los scripts corren en **cada** arranque, en orden alfabético, así que deben poder repetirse sin error: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.
- Para agregar una tabla nueva, crea otro archivo (`02-….sql`). Para cambiar una tabla que ya existe, no basta con editar el `CREATE TABLE`: SQLite no tiene `ADD COLUMN IF NOT EXISTS`, así que ese cambio necesita su propio manejo.

### Qué guarda

Tabla `odoo_audit_logs`, una fila por cada petición a Odoo:

| Columna | Qué es |
|---|---|
| `correlation_id` | Id único de la petición |
| `organization_id`, `connection_id`, `expense_id` | A qué organización, conexión y gasto pertenece |
| `endpoint`, `http_method` | A qué se llamó, por ejemplo `/json/2/hr.expense/load` y `POST` |
| `status_code` | Lo que respondió Odoo. `0` significa que **no hubo respuesta**: Odoo caído, corte de red o tiempo agotado |
| `request_payload`, `response_payload` | Lo que se envió y lo que se recibió. El contenido de los comprobantes no se guarda: se reemplaza por su tamaño y su hash SHA-256 |
| `duration_ms` | Cuánto tardó la petición |
| `operation_at` | Cuándo se hizo |
| `created_at` | Cuándo se guardó |

**Reglas:**

- **Solo se agregan registros.** Dos triggers impiden modificar o borrar: cualquier `UPDATE` o `DELETE` responde `odoo_audit_logs only accepts new records`.
- **Un solo escritor.** Solo una instancia del servicio debe usar el archivo. Con dos réplicas, cada una tendría su propio archivo y la auditoría quedaría partida.

### Consultar los registros

Todos los comandos son iguales en Mac, Linux y Windows. Se abren con `-readonly` para no modificar nada por accidente.

**Una consulta rápida:**

```bash
docker compose exec expense-consumer sqlite3 -readonly -column -header /app/data/odoo-audit.sqlite "select count(*) as registros from odoo_audit_logs"
```

**Abrir la consola de SQLite** para escribir varias consultas (sales con `.quit`):

```bash
docker compose exec expense-consumer sqlite3 -readonly -column -header /app/data/odoo-audit.sqlite
```

**Consultas útiles** (dentro de la consola o entre comillas en el comando anterior):

```sql
-- Las últimas 20 peticiones
select operation_at, endpoint, status_code, duration_ms
from odoo_audit_logs order by operation_at desc limit 20;

-- Todo lo que pasó con un gasto
select operation_at, endpoint, status_code, duration_ms
from odoo_audit_logs where expense_id = '<id del gasto>' order by operation_at;

-- Peticiones que fallaron (sin respuesta o con error)
select operation_at, expense_id, endpoint, status_code
from odoo_audit_logs where status_code = 0 or status_code >= 400
order by operation_at desc;

-- Cuántas peticiones hubo por día y cuántas fallaron
select substr(operation_at, 1, 10) as dia, count(*) as total,
       sum(status_code = 0 or status_code >= 400) as fallidas
from odoo_audit_logs group by dia order by dia desc;

-- Qué se envió y qué respondió Odoo en una petición
select request_payload, response_payload
from odoo_audit_logs where correlation_id = '<correlation_id>';
```

### Exportar a CSV

Mac y Linux:

```bash
docker compose exec -T expense-consumer sqlite3 -readonly -csv -header /app/data/odoo-audit.sqlite "select * from odoo_audit_logs order by operation_at" > auditoria.csv
```

Windows (PowerShell):

```powershell
docker compose exec -T expense-consumer sqlite3 -readonly -csv -header /app/data/odoo-audit.sqlite "select * from odoo_audit_logs order by operation_at" | Out-File -Encoding utf8 auditoria.csv
```

- **`-csv` va antes de `-header`.** En el orden contrario, el CSV sale sin los nombres de las columnas.
- **`-T`** evita que Docker mezcle caracteres de terminal en el archivo.
- **En Windows,** `Out-File -Encoding utf8` evita que PowerShell guarde el archivo en UTF-16.

### Respaldar

No copies el archivo directamente mientras el servicio está corriendo: en modo WAL, parte de los datos puede estar todavía en el archivo `-wal`. Usa `.backup`, que genera una copia consistente, y luego sácala del contenedor:

```bash
docker compose exec expense-consumer sqlite3 /app/data/odoo-audit.sqlite ".backup /app/data/respaldo.sqlite"
docker compose cp expense-consumer:/app/data/respaldo.sqlite ./respaldo.sqlite
docker compose exec expense-consumer rm /app/data/respaldo.sqlite
```

## Sin Docker (solo desarrollo)

```bash
pnpm install
pnpm audit:init
pnpm start
```

- **`pnpm audit:init`** aplica los mismos scripts de `docker/sqlite/init/` a `./data/odoo-audit.sqlite`. Si en tu `.env` usas otra ruta en `ODOO_AUDIT_DB_PATH`, pásala al correrlo: `ODOO_AUDIT_DB_PATH=<ruta> pnpm audit:init`.
- **Requisitos:** `sh` y `sqlite3`. Mac y Linux ya los traen. En Windows no vienen: usa Docker o corre el comando desde Git Bash con `sqlite3` instalado.
- **El `.env`:** sin Docker, `DATABASE_HOST` y `RABBITMQ_HOST` deben ser `localhost`.
- **No lo corras a la vez que el contenedor:** cada uno escribiría en su propio archivo de auditoría.

## Problemas comunes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| El servicio se detiene con `no such table: odoo_audit_logs` | El archivo de auditoría no se inicializó | Con Docker no debería pasar; revisa que el volumen esté montado en `/app/data`. Sin Docker, corre `pnpm audit:init` |
| `ECONNREFUSED` hacia `host.docker.internal:5432` o `:5672` | PostgreSQL o RabbitMQ no están corriendo en tu máquina, o escuchan en otro puerto | Levanta el `docker-compose.yml` del backend y revisa los puertos del `.env` |
| Todos los envíos quedan esperando con `ODOO_UNREACHABLE` | En desarrollo: la conexión de Odoo usa `localhost`, que dentro del contenedor es el propio contenedor | Usa `http://host.docker.internal:8069` (pasos 2 y 3) |
| En producción el servicio no llega a PostgreSQL o RabbitMQ | Se levantó con el `docker-compose.override.yml`, que apunta a `host.docker.internal` | Usa `docker compose -f docker-compose.yml up -d` y los hosts reales en las variables de entorno |
| El backend no puede crear la conexión con `host.docker.internal` | Tu máquina no conoce ese nombre | Agrégalo a tu archivo `hosts` (paso 2) |
| `docker compose up` dice que falta `.env` | No existe el `.env` del consumer | Paso 1 |
