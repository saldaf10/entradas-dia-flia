import { app } from './app.js';
import { listo, fila, esRemota } from './db.js';
import { limpiarSesiones } from './auth.js';
import { resumenMarca } from './marca.js';

const puerto = Number(process.env.PORT) || 3000;

await listo();
await limpiarSesiones();
setInterval(() => limpiarSesiones().catch(() => {}), 6 * 60 * 60 * 1000).unref();

app.listen(puerto, () => {
  console.log(`\n  Entradas Colegio Fontan  ->  http://localhost:${puerto}`);
  console.log(`  Base de datos: ${esRemota ? 'Turso (remota)' : 'archivo local'}`);

  const marca = resumenMarca();
  console.log(`  Logo en la boleta: ${marca.logo ? 'si' : 'no (falta public/marca/logo.png)'}`);
  console.log(`  Tipografia: ${marca.fuente}\n`);

  fila('SELECT COUNT(*) AS n FROM usuarios').then(({ n }) => {
    if (!Number(n)) {
      console.log('  No hay ningun usuario todavia. Crealo con:');
      console.log('    npm run usuario -- crear <usuario> <contrasena>\n');
    }
  });
});
