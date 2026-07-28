import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { db } from './db.js';
import { cargarSesion, exigirSesion, limpiarSesiones } from './auth.js';
import { api } from './rutas.js';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const publico = join(raiz, 'public');

const app = express();
app.set('trust proxy', 1); // Necesario para que req.ip sea real detras de un proxy/hosting.
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    // Todo el JS y CSS es local; 'blob:' es para el frame de video del escaner.
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
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

// jsQR se sirve desde node_modules: el escaner funciona sin CDN ni internet.
app.get('/vendor/jsqr.js', (_req, res) => {
  res.sendFile(require.resolve('jsqr/dist/jsQR.js'));
});

const pagina = (archivo) => (_req, res) => res.sendFile(join(publico, archivo));

app.get('/entrar', (req, res) =>
  req.usuario ? res.redirect('/') : res.sendFile(join(publico, 'entrar.html'))
);
app.get('/', exigirSesion, pagina('panel.html'));
app.get('/evento/:id', exigirSesion, pagina('evento.html'));
app.get('/escanear', exigirSesion, pagina('escanear.html'));

app.use(express.static(publico, { index: false, maxAge: '1h' }));

app.use((_req, res) => res.status(404).json({ error: 'No encontrado' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Error interno' });
});

limpiarSesiones();
setInterval(limpiarSesiones, 6 * 60 * 60 * 1000).unref();

const puerto = Number(process.env.PORT) || 3000;
app.listen(puerto, () => {
  const usuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  console.log(`\n  Entradas Colegio Fontan  ->  http://localhost:${puerto}\n`);
  if (!usuarios) {
    console.log('  No hay ningun usuario todavia. Crea uno con:');
    console.log('    npm run usuario -- crear <usuario> <contrasena>\n');
  }
});
