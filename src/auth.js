import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, ahora } from './db.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const DIAS_SESION = 7;
export const COOKIE = 'entradas_sid';

export function hashClave(clave) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(clave, salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { hash, salt };
}

function claveValida(clave, hashHex, salt) {
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(clave, salt, SCRYPT.keylen, SCRYPT);
  // Longitudes distintas harian lanzar a timingSafeEqual.
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

export function crearUsuario(usuario, clave) {
  const { hash, salt } = hashClave(clave);
  db.prepare(
    'INSERT INTO usuarios (usuario, clave_hash, clave_salt, creado_en) VALUES (?, ?, ?, ?)'
  ).run(usuario, hash, salt, ahora());
}

export function cambiarClave(usuario, clave) {
  const { hash, salt } = hashClave(clave);
  const r = db
    .prepare('UPDATE usuarios SET clave_hash = ?, clave_salt = ? WHERE usuario = ?')
    .run(hash, salt, usuario);
  if (r.changes) db.prepare('DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE usuario = ?)').run(usuario);
  return r.changes > 0;
}

export function verificar(usuario, clave) {
  const fila = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
  if (!fila) {
    // Gasta el mismo tiempo que un usuario real para no filtrar cuales existen.
    scryptSync(clave, 'salt-inexistente', SCRYPT.keylen, SCRYPT);
    return null;
  }
  return claveValida(clave, fila.clave_hash, fila.clave_salt) ? fila : null;
}

export function abrirSesion(usuarioId) {
  const id = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 864e5).toISOString();
  db.prepare('INSERT INTO sesiones (id, usuario_id, creada_en, expira_en) VALUES (?, ?, ?, ?)')
    .run(id, usuarioId, ahora(), expira);
  return { id, expira };
}

export function cerrarSesion(id) {
  if (id) db.prepare('DELETE FROM sesiones WHERE id = ?').run(id);
}

export function limpiarSesiones() {
  db.prepare('DELETE FROM sesiones WHERE expira_en < ?').run(ahora());
}

/** Middleware: adjunta req.usuario si la cookie de sesion es valida. */
export function cargarSesion(req, _res, next) {
  const sid = req.cookies?.[COOKIE];
  if (sid) {
    const fila = db
      .prepare(
        `SELECT u.id, u.usuario, s.id AS sid FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.id = ? AND s.expira_en > ?`
      )
      .get(sid, ahora());
    if (fila) req.usuario = fila;
  }
  next();
}

/** Middleware: exige sesion. Responde JSON en /api y redirige en las paginas. */
export function exigirSesion(req, res, next) {
  if (req.usuario) return next();
  // originalUrl y no path: dentro del router montado, path ya viene sin el prefijo /api.
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Sesión expirada' });
  return res.redirect('/entrar');
}

const intentos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 8;

/** Limita intentos de login por IP para frenar fuerza bruta. */
export function limitarIntentos(ip) {
  const t = Date.now();
  const previo = intentos.get(ip);
  if (!previo || t - previo.desde > VENTANA_MS) {
    intentos.set(ip, { desde: t, n: 1 });
    return { ok: true };
  }
  previo.n += 1;
  if (previo.n > MAX_INTENTOS) {
    const faltan = Math.ceil((VENTANA_MS - (t - previo.desde)) / 60000);
    return { ok: false, minutos: Math.max(faltan, 1) };
  }
  return { ok: true };
}

export function reiniciarIntentos(ip) {
  intentos.delete(ip);
}
