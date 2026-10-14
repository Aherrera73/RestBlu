import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const path = resolve(process.argv[2] || 'data/lumastay.sqlite');
const database = new DatabaseSync(path, { readOnly: true });
const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
const tables = database
  .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
const views = database
  .prepare("SELECT name FROM sqlite_schema WHERE type = 'view' ORDER BY name")
  .all()
  .map((row) => row.name);
const indexes = database
  .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
  .all()
  .map((row) => row.name);
const plan = database
  .prepare('EXPLAIN QUERY PLAN SELECT * FROM estadias WHERE cliente_id = ? ORDER BY fecha_check_in DESC')
  .all(1)
  .map((row) => row.detail);
const counts = {
  alojamientos: database.prepare('SELECT COUNT(*) AS total FROM alojamientos').get().total,
  clientes: database.prepare('SELECT COUNT(*) AS total FROM clientes').get().total,
  estadias: database.prepare('SELECT COUNT(*) AS total FROM estadias').get().total,
};

console.log(JSON.stringify({ path, integrity, tables, views, indexes, plan, counts }, null, 2));
database.close();
