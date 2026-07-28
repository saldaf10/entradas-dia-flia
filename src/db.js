import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Una sola forma de hablar con la base, igual en local que en produccion.
 *
 *  - Sin variables de entorno: archivo local (data/entradas.db).
 *  - Con TURSO_URL + TURSO_TOKEN: base remota, que es lo que necesita Vercel
 *    porque alli el disco es efimero y se borra en cada despliegue.
 */
function abrir() {
  const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
  if (url) {
    return createClient({
      url,
      authToken: process.env.TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN,
    });
  }

  const archivo = resolve(process.env.DB_FILE || 'data/entradas.db');
  mkdirSync(dirname(archivo), { recursive: true });
  return createClient({ url: `file:${archivo}` });
}

export const db = abrir();
export const esRemota = Boolean(process.env.TURSO_URL || process.env.TURSO_DATABASE_URL);

export const ahora = () => new Date().toISOString();

export async function filas(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}

export async function fila(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0];
}

export async function ejecutar(sql, args = []) {
  const r = await db.execute({ sql, args });
  return { cambios: Number(r.rowsAffected), id: r.lastInsertRowid ? Number(r.lastInsertRowid) : null };
}

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
     id         INTEGER PRIMARY KEY,
     usuario    TEXT NOT NULL UNIQUE COLLATE NOCASE,
     clave_hash TEXT NOT NULL,
     clave_salt TEXT NOT NULL,
     creado_en  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sesiones (
     id         TEXT PRIMARY KEY,
     usuario_id INTEGER NOT NULL,
     creada_en  TEXT NOT NULL,
     expira_en  TEXT NOT NULL
   )`,
  // Fila unica con los datos que se imprimen en la boleta.
  `CREATE TABLE IF NOT EXISTS config (
     id     INTEGER PRIMARY KEY CHECK (id = 1),
     nombre TEXT NOT NULL,
     fecha  TEXT,
     lugar  TEXT
   )`,
  `INSERT OR IGNORE INTO config (id, nombre) VALUES (1, 'Día de la Familia')`,
  `CREATE TABLE IF NOT EXISTS boletas (
     id         INTEGER PRIMARY KEY,
     codigo     TEXT NOT NULL UNIQUE,
     numero     INTEGER NOT NULL,
     categoria  TEXT NOT NULL DEFAULT 'General',
     estado     TEXT NOT NULL DEFAULT 'disponible',
     nota       TEXT,
     creada_en  TEXT NOT NULL,
     usada_en   TEXT,
     anulada_en TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_boletas_estado ON boletas(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_boletas_numero ON boletas(numero)`,
  `CREATE TABLE IF NOT EXISTS escaneos (
     id         INTEGER PRIMARY KEY,
     boleta_id  INTEGER,
     codigo     TEXT NOT NULL,
     resultado  TEXT NOT NULL,
     usuario_id INTEGER,
     en         TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_escaneos_en ON escaneos(en DESC)`,
];

let preparando = null;

/**
 * Crea el esquema una sola vez por proceso. En Vercel cada arranque en frio
 * vuelve a pasar por aqui, por eso todo es IF NOT EXISTS y se cachea la promesa.
 */
export function listo() {
  preparando ??= (async () => {
    for (const sentencia of ESQUEMA) await db.execute(sentencia);
  })();
  return preparando;
}
