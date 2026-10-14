import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  createSqlServerDatabase, describeSqlServer, sqlServerConfigFromEnv,
} from '../src/database/sqlserver-database.mjs';

// Copia la base SQLite del gestor a SQL Server. El gestor lo hace solo la
// primera vez; este script sirve para repetirlo y reemplaza lo que haya en
// SQL Server. Uso: node scripts/migrate-sqlite-to-sqlserver.mjs --confirm=COPIAR_A_SQLSERVER

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_CONFIG = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'RestBlu', '.env.local')
  : join(BACKEND, '.env.local');
dotenv.config({ path: PRIVATE_CONFIG, quiet: true });

const sqlitePath = resolve(process.env.RESTBLU_DB_PATH || join(BACKEND, 'data', 'lumastay.sqlite'));
if (!existsSync(sqlitePath)) throw new Error(`No se encontró la base SQLite en ${sqlitePath}.`);
const config = sqlServerConfigFromEnv();

if (!process.argv.includes('--confirm=COPIAR_A_SQLSERVER')) {
  console.log(JSON.stringify({
    mode: 'preview',
    from: sqlitePath,
    to: describeSqlServer(config),
    run: 'node scripts/migrate-sqlite-to-sqlserver.mjs --confirm=COPIAR_A_SQLSERVER',
  }, null, 2));
  process.exit(0);
}

const database = await createSqlServerDatabase({
  config,
  schemaPath: join(BACKEND, 'src', 'database', 'schema-sqlserver.sql'),
});
try {
  const copied = await database.importFromSqlite({
    sqlitePath,
    sqliteSchemaPath: join(BACKEND, 'src', 'database', 'schema.sql'),
  });
  console.log(JSON.stringify({ mode: 'completed', from: sqlitePath, to: database.path, copied, tables: await database.tableCounts() }, null, 2));
} finally {
  await database.close();
}
