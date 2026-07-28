#!/usr/bin/env node
/**
 * Gestion de usuarios desde la terminal. Las contrasenas nunca se guardan en claro.
 *
 *   npm run usuario -- crear   <usuario> <contrasena>
 *   npm run usuario -- clave   <usuario> <contrasena>
 *   npm run usuario -- listar
 */
import { fila, filas, listo } from '../src/db.js';
import { crearUsuario, cambiarClave } from '../src/auth.js';

const [accion, usuario, clave] = process.argv.slice(2);

function exigirClave() {
  if (!usuario || !clave) {
    console.error(`Uso: npm run usuario -- ${accion} <usuario> <contrasena>`);
    process.exit(1);
  }
  if (clave.length < 8) {
    console.error('La contrasena debe tener al menos 8 caracteres.');
    process.exit(1);
  }
}

await listo();

switch (accion) {
  case 'crear': {
    exigirClave();
    if (await fila('SELECT 1 FROM usuarios WHERE usuario = ?', [usuario])) {
      console.error(`El usuario "${usuario}" ya existe. Usa "clave" para cambiarle la contrasena.`);
      process.exit(1);
    }
    await crearUsuario(usuario, clave);
    console.log(`Usuario "${usuario}" creado.`);
    break;
  }
  case 'clave': {
    exigirClave();
    if (!(await cambiarClave(usuario, clave))) {
      console.error(`No existe el usuario "${usuario}".`);
      process.exit(1);
    }
    console.log(`Contrasena de "${usuario}" actualizada. Se cerraron sus sesiones abiertas.`);
    break;
  }
  case 'listar': {
    const lista = await filas('SELECT usuario, creado_en FROM usuarios ORDER BY id');
    if (!lista.length) console.log('No hay usuarios.');
    for (const f of lista) console.log(`${f.usuario}\t(creado ${String(f.creado_en).slice(0, 10)})`);
    break;
  }
  default:
    console.log('Acciones: crear | clave | listar');
    console.log('  npm run usuario -- crear maria "una-clave-larga"');
    process.exit(1);
}

process.exit(0);
