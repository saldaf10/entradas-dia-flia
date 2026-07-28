import express from 'express';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listo } from './db.js';
import { cargarSesion, exigirSesion } from './auth.js';
import { api } from './rutas.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const publico = join(raiz, 'public');
const paginas = join(raiz, 'paginas');

export const app = express();
app.set('trust proxy', 1); // Para que req.ip sea real detras del proxy de Vercel.
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    // Todo el JS y CSS es local; 'blob:' es para el video del escaner.
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
});

// El esquema se crea una vez por proceso; en Vercel eso es una vez por arranque en frio.
app.use((_req, _res, next) => {
  listo().then(() => next(), next);
});

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(cargarSesion);

// El navegador solo manda cookies en POST cross-site si es un form clasico;
// exigir JSON cierra esa puerta y complementa al SameSite=Lax de la cookie.
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Se espera JSON' });
  }
  next();
});

app.use('/api', api);

/**
 * Sello que cambia con cada despliegue. Se inyecta en los `?v=__V__` de las
 * paginas para que un navegador con la version anterior en cache no siga
 * ejecutando el JS viejo despues de publicar cambios.
 */
const VERSION = process.env.VERCEL_DEPLOYMENT_ID || String(Date.now());
const cache = new Map();

function pagina(archivo) {
  const html = () => {
    if (!cache.has(archivo)) {
      cache.set(archivo, readFileSync(join(paginas, archivo), 'utf8').replaceAll('__V__', VERSION));
    }
    return cache.get(archivo);
  };
  return (_req, res) => res.type('html').send(html());
}

const entrar = pagina('entrar.html');
app.get('/entrar', (req, res) => (req.usuario ? res.redirect('/') : entrar(req, res)));
app.get('/', exigirSesion, pagina('panel.html'));
app.get('/escanear', exigirSesion, pagina('escanear.html'));

// Sin cache larga a proposito: son pocos kilobytes y el ETag evita la descarga
// repetida, pero garantiza que tras un despliegue nadie siga con el JS viejo.
app.use(express.static(publico, { index: false, maxAge: 0, etag: true }));

app.use((_req, res) => res.status(404).json({ error: 'No encontrado' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Error interno' });
});
