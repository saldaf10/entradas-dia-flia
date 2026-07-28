import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fila, ejecutar, ahora } from './db.js';

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

export async function crearUsuario(usuario, clave) {
  const { hash, salt } = hashClave(clave);
  await ejecutar(
    'INSERT INTO usuarios (usuario, clave_hash, clave_salt, creado_en) VALUES (?, ?, ?, ?)',
    [usuario, hash, salt, ahora()]
  );
}

export async function cambiarClave(usuario, clave) {
  const { hash, salt } = hashClave(clave);
  const r = await ejecutar(
    'UPDATE usuarios SET clave_hash = ?, clave_salt = ? WHERE usuario = ?',
    [hash, salt, usuario]
  );
  if (r.cambios) {
    await ejecutar(
      'DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE usuario = ?)',
      [usuario]
    );
  }
  return r.cambios > 0;
}

export async function verificar(usuario, clave) {
  const f = await fila('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
  if (!f) {
    // Gasta el mismo tiempo que un usuario real para no filtrar cuales existen.
    scryptSync(clave, 'salt-inexistente', SCRYPT.keylen, SCRYPT);
    return null;
  }
  return claveValida(clave, f.clave_hash, f.clave_salt) ? f : null;
}

export async function abrirSesion(usuarioId) {
  const id = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESION * 864e5).toISOString();
  await ejecutar('INSERT INTO sesiones (id, usuario_id, creada_en, expira_en) VALUES (?, ?, ?, ?)',
    [id, usuarioId, ahora(), expira]);
  return { id, expira };
}

export async function cerrarSesion(id) {
  if (id) await ejecutar('DELETE FROM sesiones WHERE id = ?', [id]);
}

export async function limpiarSesiones() {
  await ejecutar('DELETE FROM sesiones WHERE expira_en < ?', [ahora()]);
}

/** Middleware: adjunta req.usuario si la cookie de sesion es valida. */
export async function cargarSesion(req, _res, next) {
  try {
    const sid = req.cookies?.[COOKIE];
    if (sid) {
      const f = await fila(
        `SELECT u.id, u.usuario, s.id AS sid FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.id = ? AND s.expira_en > ?`,
        [sid, ahora()]
      );
      if (f) req.usuario = f;
    }
    next();
  } catch (err) {
    next(err);
  }
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
