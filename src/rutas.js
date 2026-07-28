import express from 'express';
import archiver from 'archiver';
import { db, ahora } from './db.js';
import { nuevoCodigo, normalizar, esCodigoValido, formatear } from './codigos.js';
import { pdfBoleta } from './pdf.js';
import {
  COOKIE, verificar, abrirSesion, cerrarSesion,
  exigirSesion, limitarIntentos, reiniciarIntentos,
} from './auth.js';

export const api = express.Router();

const MAX_POR_LOTE = 500;
const enProduccion = process.env.NODE_ENV === 'production';

function texto(valor, max = 120) {
  return String(valor ?? '').trim().slice(0, max);
}

/** Nombre de archivo seguro para las descargas. */
function nombreArchivo(base) {
  return base
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'boleta';
}

function eventoDe(id) {
  return db.prepare('SELECT * FROM eventos WHERE id = ?').get(Number(id));
}

function resumen(eventoId) {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(estado = 'disponible') AS disponibles,
         SUM(estado = 'usada')      AS usadas,
         SUM(estado = 'anulada')    AS anuladas
       FROM boletas WHERE evento_id = ?`
    )
    .get(eventoId);
}

// ---------------------------------------------------------------- sesion

api.post('/entrar', (req, res) => {
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

  const fila = verificar(usuario, clave);
  if (!fila) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  reiniciarIntentos(ip);
  const sesion = abrirSesion(fila.id);
  res.cookie(COOKIE, sesion.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: enProduccion,
    expires: new Date(sesion.expira),
    path: '/',
  });
  res.json({ usuario: fila.usuario });
});

api.post('/salir', (req, res) => {
  cerrarSesion(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

api.get('/yo', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin sesión' });
  res.json({ usuario: req.usuario.usuario });
});

// A partir de aqui todo exige sesion.
api.use(exigirSesion);

// ---------------------------------------------------------------- eventos

api.get('/eventos', (_req, res) => {
  const eventos = db
    .prepare('SELECT * FROM eventos ORDER BY archivado ASC, id DESC')
    .all()
    .map((e) => ({ ...e, resumen: resumen(e.id) }));
  res.json({ eventos });
});

api.post('/eventos', (req, res) => {
  const nombre = texto(req.body?.nombre, 90);
  if (!nombre) return res.status(400).json({ error: 'El evento necesita un nombre' });

  const info = db
    .prepare('INSERT INTO eventos (nombre, fecha, lugar, creado_en) VALUES (?, ?, ?, ?)')
    .run(nombre, texto(req.body?.fecha, 60) || null, texto(req.body?.lugar, 90) || null, ahora());
  res.status(201).json({ evento: eventoDe(info.lastInsertRowid) });
});

api.get('/eventos/:id', (req, res) => {
  const evento = eventoDe(req.params.id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ evento, resumen: resumen(evento.id) });
});

api.patch('/eventos/:id', (req, res) => {
  const evento = eventoDe(req.params.id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const nombre = req.body?.nombre === undefined ? evento.nombre : texto(req.body.nombre, 90);
  if (!nombre) return res.status(400).json({ error: 'El evento necesita un nombre' });
  const fecha = req.body?.fecha === undefined ? evento.fecha : texto(req.body.fecha, 60) || null;
  const lugar = req.body?.lugar === undefined ? evento.lugar : texto(req.body.lugar, 90) || null;
  const archivado = req.body?.archivado === undefined ? evento.archivado : (req.body.archivado ? 1 : 0);

  db.prepare('UPDATE eventos SET nombre = ?, fecha = ?, lugar = ?, archivado = ? WHERE id = ?')
    .run(nombre, fecha, lugar, archivado, evento.id);
  res.json({ evento: eventoDe(evento.id) });
});

// ---------------------------------------------------------------- boletas

api.post('/eventos/:id/boletas', (req, res) => {
  const evento = eventoDe(req.params.id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const cantidad = Number(req.body?.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_POR_LOTE) {
    return res.status(400).json({ error: `La cantidad debe ir entre 1 y ${MAX_POR_LOTE}` });
  }
  const categoria = texto(req.body?.categoria, 40) || 'General';
  const nota = texto(req.body?.nota, 120) || null;

  const ultimo = db
    .prepare('SELECT COALESCE(MAX(numero), 0) AS n FROM boletas WHERE evento_id = ?')
    .get(evento.id).n;

  const insertar = db.prepare(
    `INSERT INTO boletas (evento_id, codigo, numero, categoria, nota, creada_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const creadas = [];
  db.exec('BEGIN');
  try {
    const t = ahora();
    for (let i = 1; i <= cantidad; i += 1) {
      const numero = ultimo + i;
      // El UNIQUE del codigo es la red de seguridad; reintentar cubre la colision improbable.
      for (let intento = 0; ; intento += 1) {
        const codigo = nuevoCodigo();
        try {
          const info = insertar.run(evento.id, codigo, numero, categoria, nota, t);
          creadas.push({ id: info.lastInsertRowid, codigo, numero });
          break;
        } catch (err) {
          if (intento >= 4 || !String(err.message).includes('UNIQUE')) throw err;
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'No se pudieron generar las boletas' });
  }

  res.status(201).json({ creadas: creadas.length, desde: creadas[0].numero, resumen: resumen(evento.id) });
});

api.get('/eventos/:id/boletas', (req, res) => {
  const evento = eventoDe(req.params.id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const estado = ['disponible', 'usada', 'anulada'].includes(req.query.estado) ? req.query.estado : null;
  const busca = normalizar(texto(req.query.q, 40));
  const numero = Number(String(req.query.q ?? '').replace(/\D/g, ''));

  let sql = 'SELECT * FROM boletas WHERE evento_id = ?';
  const args = [evento.id];
  if (estado) { sql += ' AND estado = ?'; args.push(estado); }
  if (busca) {
    sql += ' AND (codigo LIKE ? OR numero = ?)';
    args.push(`%${busca}%`, Number.isFinite(numero) ? numero : -1);
  }
  sql += ' ORDER BY numero ASC LIMIT 1000';

  const boletas = db.prepare(sql).all(...args).map((b) => ({ ...b, codigo_legible: formatear(b.codigo) }));
  res.json({ boletas, resumen: resumen(evento.id) });
});

api.post('/boletas/:id/estado', (req, res) => {
  const boleta = db.prepare('SELECT * FROM boletas WHERE id = ?').get(Number(req.params.id));
  if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada' });

  const destino = req.body?.estado;
  if (!['disponible', 'anulada'].includes(destino)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  db.prepare('UPDATE boletas SET estado = ?, anulada_en = ?, usada_en = NULL WHERE id = ?')
    .run(destino, destino === 'anulada' ? ahora() : null, boleta.id);

  res.json({ boleta: db.prepare('SELECT * FROM boletas WHERE id = ?').get(boleta.id) });
});

// ---------------------------------------------------------------- descargas

api.get('/boletas/:id/pdf', async (req, res, next) => {
  try {
    const boleta = db.prepare('SELECT * FROM boletas WHERE id = ?').get(Number(req.params.id));
    if (!boleta) return res.status(404).json({ error: 'Boleta no encontrada' });
    const evento = eventoDe(boleta.evento_id);

    const pdf = await pdfBoleta(boleta, evento);
    const nombre = `${nombreArchivo(evento.nombre)}-boleta-${String(boleta.numero).padStart(4, '0')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

api.get('/eventos/:id/descargar', async (req, res, next) => {
  try {
    const evento = eventoDe(req.params.id);
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

    const soloNuevas = req.query.desde ? Number(req.query.desde) : null;
    const boletas = db
      .prepare(
        `SELECT * FROM boletas WHERE evento_id = ? AND estado != 'anulada'
         ${soloNuevas ? 'AND numero >= ?' : ''} ORDER BY numero ASC`
      )
      .all(...(soloNuevas ? [evento.id, soloNuevas] : [evento.id]));

    if (!boletas.length) return res.status(404).json({ error: 'No hay boletas para descargar' });

    const base = nombreArchivo(evento.nombre);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-boletas.zip"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', next);
    zip.pipe(res);

    // Un PDF por boleta: cada archivo se manda tal cual a su comprador.
    for (const [i, boleta] of boletas.entries()) {
      const pdf = await pdfBoleta(boleta, evento);
      zip.append(pdf, { name: `${base}-boleta-${String(boleta.numero).padStart(4, '0')}.pdf` });
      // Un lote grande tarda segundos; ceder el hilo evita que se congele
      // la validacion en la puerta mientras alguien descarga.
      if (i % 10 === 9) await new Promise((listo) => setImmediate(listo));
    }
    await zip.finalize();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- validacion

api.post('/validar', (req, res) => {
  const codigo = normalizar(texto(req.body?.codigo, 60));
  const soloConsultar = Boolean(req.body?.consultar);

  const registrar = (boletaId, resultado) => {
    db.prepare('INSERT INTO escaneos (boleta_id, codigo, resultado, usuario_id, en) VALUES (?, ?, ?, ?, ?)')
      .run(boletaId, codigo || '(vacio)', resultado, req.usuario.id, ahora());
  };

  if (!esCodigoValido(codigo)) {
    registrar(null, 'invalida');
    return res.json({ resultado: 'invalida', mensaje: 'Ese código no tiene el formato de una boleta.' });
  }

  const boleta = db.prepare('SELECT * FROM boletas WHERE codigo = ?').get(codigo);
  if (!boleta) {
    registrar(null, 'invalida');
    return res.json({ resultado: 'invalida', mensaje: 'Boleta no encontrada. No fue emitida por este sistema.' });
  }

  const evento = eventoDe(boleta.evento_id);
  const salida = (resultado, mensaje) => {
    registrar(boleta.id, resultado);
    const actual = db.prepare('SELECT * FROM boletas WHERE id = ?').get(boleta.id);
    res.json({
      resultado,
      mensaje,
      boleta: { ...actual, codigo_legible: formatear(actual.codigo) },
      evento: { id: evento.id, nombre: evento.nombre },
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
  // solo una obtiene changes = 1 y la otra ve la boleta como repetida.
  const r = db
    .prepare(`UPDATE boletas SET estado = 'usada', usada_en = ? WHERE id = ? AND estado = 'disponible'`)
    .run(ahora(), boleta.id);

  if (r.changes === 1) return salida('ok', 'Boleta válida. Queda marcada como usada.');

  const actual = db.prepare('SELECT * FROM boletas WHERE id = ?').get(boleta.id);
  if (actual.estado === 'anulada') return salida('anulada', 'Boleta anulada. No permite el ingreso.');
  return salida('repetida', `Esta boleta ya se usó el ${new Date(actual.usada_en).toLocaleString('es-CO')}`);
});

api.get('/escaneos', (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 25, 1), 200);
  const filas = db
    .prepare(
      `SELECT e.*, b.numero, b.categoria, ev.nombre AS evento
       FROM escaneos e
       LEFT JOIN boletas b ON b.id = e.boleta_id
       LEFT JOIN eventos ev ON ev.id = b.evento_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(limite)
    .map((f) => ({ ...f, codigo_legible: formatear(f.codigo) }));
  res.json({ escaneos: filas });
});
