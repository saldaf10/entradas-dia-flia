import express from 'express';
import archiver from 'archiver';
import { db, filas, fila, ejecutar, ahora } from './db.js';
import { nuevoCodigo, normalizar, esCodigoValido, formatear } from './codigos.js';
import { pngBoleta } from './imagen.js';
import {
  COOKIE, verificar, abrirSesion, cerrarSesion,
  exigirSesion, limitarIntentos, reiniciarIntentos,
} from './auth.js';

export const api = express.Router();

const MAX_POR_LOTE = 500;
/**
 * Tope por ZIP. Vercel corta las respuestas en 4.5 MB salvo que vayan en
 * streaming; el ZIP va en streaming, pero 75 boletas (~4 MB) entran holgadas
 * aunque la plataforma decidiera almacenarlo en bufer.
 */
export const MAX_POR_ZIP = 75;
const enProduccion = process.env.NODE_ENV === 'production';

function texto(valor, max = 120) {
  return String(valor ?? '').trim().slice(0, max);
}

function nombreArchivo(base) {
  return base
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'boleta';
}

const leerConfig = () => fila('SELECT * FROM config WHERE id = 1');

const resumen = () =>
  fila(`SELECT
          COUNT(*) AS total,
          SUM(estado = 'disponible') AS disponibles,
          SUM(estado = 'usada')      AS usadas,
          SUM(estado = 'anulada')    AS anuladas
        FROM boletas`);

// ---------------------------------------------------------------- sesion

api.post('/entrar', async (req, res, next) => {
  try {
    const ip = req.ip || 'desconocida';
    const limite = limitarIntentos(ip);
    if (!limite.ok) {
      return res.status(429).json({
        error: `Demasiados intentos. Vuelve a probar en ${limite.minutos} minuto(s).`,
      });
    }

    const usuario = texto(req.body?.usuario, 60);
    const clave = String(req.body?.clave ?? '');
    if (!usuario || !clave) return res.status(400).json({ error: 'Faltan datos' });

    const f = await verificar(usuario, clave);
    if (!f) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    reiniciarIntentos(ip);
    const sesion = await abrirSesion(f.id);
    res.cookie(COOKIE, sesion.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: enProduccion,
      expires: new Date(sesion.expira),
      path: '/',
    });
    res.json({ usuario: f.usuario });
  } catch (err) { next(err); }
});

api.post('/salir', async (req, res, next) => {
  try {
    await cerrarSesion(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

api.get('/yo', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin sesión' });
  res.json({ usuario: req.usuario.usuario });
});

// A partir de aqui todo exige sesion.
api.use(exigirSesion);

// ---------------------------------------------------------------- evento

api.get('/config', async (_req, res, next) => {
  try {
    res.json({ config: await leerConfig(), resumen: await resumen(), max_zip: MAX_POR_ZIP });
  } catch (err) { next(err); }
});

api.patch('/config', async (req, res, next) => {
  try {
    const actual = await leerConfig();
    const nombre = req.body?.nombre === undefined ? actual.nombre : texto(req.body.nombre, 90);
    if (!nombre) return res.status(400).json({ error: 'El evento necesita un nombre' });

    await ejecutar('UPDATE config SET nombre = ?, fecha = ?, lugar = ? WHERE id = 1', [
      nombre,
      req.body?.fecha === undefined ? actual.fecha : texto(req.body.fecha, 60) || null,
      req.body?.lugar === undefined ? actual.lugar : texto(req.body.lugar, 90) || null,
    ]);
    res.json({ config: await leerConfig() });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- boletas

api.post('/boletas', async (req, res, next) => {
  try {
    const cantidad = Number(req.body?.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_POR_LOTE) {
      return res.status(400).json({ error: `La cantidad debe ir entre 1 y ${MAX_POR_LOTE}` });
    }
    const { n: ultimo } = await fila('SELECT COALESCE(MAX(numero), 0) AS n FROM boletas');
    const desde = Number(ultimo) + 1;
    const t = ahora();

    // Codigos unicos dentro del lote; el UNIQUE de la tabla cubre el resto.
    const usados = new Set();
    const sentencias = [];
    for (let i = 0; i < cantidad; i += 1) {
      let codigo = nuevoCodigo();
      while (usados.has(codigo)) codigo = nuevoCodigo();
      usados.add(codigo);
      sentencias.push({
        sql: 'INSERT INTO boletas (codigo, numero, creada_en) VALUES (?, ?, ?)',
        args: [codigo, desde + i, t],
      });
    }

    // batch es atomico: o entran las N boletas o no entra ninguna.
    await db.batch(sentencias, 'write');

    res.status(201).json({
      creadas: cantidad,
      desde,
      hasta: desde + cantidad - 1,
      resumen: await resumen(),
    });
  } catch (err) { next(err); }
});

api.get('/boletas', async (req, res, next) => {
  try {
    const estado = ['disponible', 'usada', 'anulada'].includes(req.query.estado) ? req.query.estado : null;
    const busca = normalizar(texto(req.query.q, 40));
    const numero = Number(String(req.query.q ?? '').replace(/\D/g, ''));

    let sql = 'SELECT * FROM boletas WHERE 1 = 1';
    const args = [];
    if (estado) { sql += ' AND estado = ?'; args.push(estado); }
    if (busca) {
      sql += ' AND (codigo LIKE ? OR numero = ?)';
      args.push(`%${busca}%`, Number.isFinite(numero) ? numero : -1);
    }
    sql += ' ORDER BY numero ASC LIMIT 1000';

    res.json({
      boletas: (await filas(sql, args)).map((b) => ({ ...b, codigo_legible: formatear(b.codigo) })),
      resumen: await resumen(),
    });
  } catch (err) { next(err); }
});

api.post('/boletas/:id/estado', async (req, res, next) => {
  try {
    const destino = req.body?.estado;
    if (!['disponible', 'anulada'].includes(destino)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    const r = await ejecutar(
      'UPDATE boletas SET estado = ?, anulada_en = ?, usada_en = NULL WHERE id = ?',
      [destino, destino === 'anulada' ? ahora() : null, Number(req.params.id)]
    );
    if (!r.cambios) return res.status(404).json({ error: 'Boleta no encontrada' });

    res.json({ boleta: await fila('SELECT * FROM boletas WHERE id = ?', [Number(req.params.id)]) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- descargas

api.get('/boletas/:id/png', async (req, res, next) => {
  try {
    const boleta = await fila('SELECT * FROM boletas WHERE id = ?', [Number(req.params.id)]);
    if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada' });

    const config = await leerConfig();
    const imagen = await pngBoleta(boleta, config);
    const nombre = `${nombreArchivo(config.nombre)}-boleta-${String(boleta.numero).padStart(4, '0')}.png`;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(imagen);
  } catch (err) { next(err); }
});

api.get('/descargar', async (req, res, next) => {
  try {
    const desde = Number(req.query.desde) || 1;
    const hasta = Number(req.query.hasta) || desde + MAX_POR_ZIP - 1;

    const boletas = await filas(
      `SELECT * FROM boletas
       WHERE estado != 'anulada' AND numero >= ? AND numero <= ?
       ORDER BY numero ASC LIMIT ?`,
      [desde, hasta, MAX_POR_ZIP]
    );
    if (!boletas.length) return res.status(404).json({ error: 'No hay boletas en ese rango' });

    const config = await leerConfig();
    const base = nombreArchivo(config.nombre);
    const primera = String(boletas[0].numero).padStart(4, '0');
    const ultima = String(boletas[boletas.length - 1].numero).padStart(4, '0');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-boletas-${primera}-a-${ultima}.zip"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', next);
    zip.pipe(res);

    // Una imagen por boleta: cada archivo se manda tal cual a su comprador.
    for (const [i, boleta] of boletas.entries()) {
      const imagen = await pngBoleta(boleta, config);
      zip.append(imagen, { name: `${base}-boleta-${String(boleta.numero).padStart(4, '0')}.png` });
      // Ceder el hilo evita que se congele la validacion en la puerta
      // mientras alguien esta descargando un lote grande.
      if (i % 10 === 9) await new Promise((listo) => setImmediate(listo));
    }
    await zip.finalize();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- validacion

api.post('/validar', async (req, res, next) => {
  try {
    const codigo = normalizar(texto(req.body?.codigo, 60));
    const soloConsultar = Boolean(req.body?.consultar);

    const modo = soloConsultar ? 'consulta' : 'uso';
    const registrar = (boletaId, resultado) =>
      ejecutar(
        'INSERT INTO escaneos (boleta_id, codigo, resultado, modo, usuario_id, en) VALUES (?, ?, ?, ?, ?, ?)',
        [boletaId, codigo || '(vacio)', resultado, modo, req.usuario.id, ahora()]
      );

    if (!esCodigoValido(codigo)) {
      await registrar(null, 'invalida');
      return res.json({ resultado: 'invalida', mensaje: 'Ese código no tiene el formato de una boleta.' });
    }

    const boleta = await fila('SELECT * FROM boletas WHERE codigo = ?', [codigo]);
    if (!boleta) {
      await registrar(null, 'invalida');
      return res.json({ resultado: 'invalida', mensaje: 'Boleta no encontrada. No fue emitida por este sistema.' });
    }

    const salida = async (resultado, mensaje) => {
      await registrar(boleta.id, resultado);
      const actual = await fila('SELECT * FROM boletas WHERE id = ?', [boleta.id]);
      res.json({
        resultado,
        modo,
        mensaje,
        boleta: { ...actual, codigo_legible: formatear(actual.codigo) },
      });
    };

    if (boleta.estado === 'anulada') return salida('anulada', 'Boleta anulada. No permite el ingreso.');

    if (soloConsultar) {
      return salida(
        boleta.estado === 'usada' ? 'repetida' : 'ok',
        boleta.estado === 'usada'
          ? `Ya fue usada el ${new Date(boleta.usada_en).toLocaleString('es-CO')}`
          : 'Boleta válida y sin usar.'
      );
    }

    // Marcar y comprobar en un solo UPDATE: si dos puertas escanean a la vez,
    // solo una obtiene cambios = 1 y la otra ve la boleta como repetida.
    const r = await ejecutar(
      `UPDATE boletas SET estado = 'usada', usada_en = ? WHERE id = ? AND estado = 'disponible'`,
      [ahora(), boleta.id]
    );
    if (r.cambios === 1) return salida('ok', 'Boleta válida. Queda marcada como usada.');

    const actual = await fila('SELECT * FROM boletas WHERE id = ?', [boleta.id]);
    if (actual.estado === 'anulada') return salida('anulada', 'Boleta anulada. No permite el ingreso.');
    return salida('repetida', `Esta boleta ya se usó el ${new Date(actual.usada_en).toLocaleString('es-CO')}`);
  } catch (err) { next(err); }
});

api.get('/escaneos', async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 25, 1), 200);
    const registros = await filas(
      `SELECT e.*, b.numero
       FROM escaneos e LEFT JOIN boletas b ON b.id = e.boleta_id
       ORDER BY e.id DESC LIMIT ?`,
      [limite]
    );
    res.json({ escaneos: registros.map((f) => ({ ...f, codigo_legible: formatear(f.codigo) })) });
  } catch (err) { next(err); }
});
