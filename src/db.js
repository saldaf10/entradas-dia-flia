import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = process.env.DB_FILE
  ? resolve(process.env.DB_FILE)
  : resolve(process.cwd(), 'data/entradas.db');

mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY,
    usuario       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    clave_hash    TEXT NOT NULL,
    clave_salt    TEXT NOT NULL,
    creado_en     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id            TEXT PRIMARY KEY,
    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en     TEXT NOT NULL,
    expira_en     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eventos (
    id            INTEGER PRIMARY KEY,
    nombre        TEXT NOT NULL,
    fecha         TEXT,
    lugar         TEXT,
    archivado     INTEGER NOT NULL DEFAULT 0,
    creado_en     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boletas (
    id            INTEGER PRIMARY KEY,
    evento_id     INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    codigo        TEXT NOT NULL UNIQUE,
    numero        INTEGER NOT NULL,
    categoria     TEXT NOT NULL DEFAULT 'General',
    estado        TEXT NOT NULL DEFAULT 'disponible',
    nota          TEXT,
    creada_en     TEXT NOT NULL,
    usada_en      TEXT,
    anulada_en    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_boletas_evento ON boletas(evento_id);
  CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira_en);

  CREATE TABLE IF NOT EXISTS escaneos (
    id            INTEGER PRIMARY KEY,
    boleta_id     INTEGER REFERENCES boletas(id) ON DELETE SET NULL,
    codigo        TEXT NOT NULL,
    resultado     TEXT NOT NULL,
    usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    en            TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_escaneos_en ON escaneos(en DESC);
`);

export const ahora = () => new Date().toISOString();
