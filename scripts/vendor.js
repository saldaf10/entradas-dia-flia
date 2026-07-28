#!/usr/bin/env node
/**
 * Copia jsQR a public/vendor para servirlo como archivo estatico.
 *
 * Se hace explicito en vez de leerlo de node_modules en caliente porque en
 * Vercel el empaquetador no arrastra archivos que nadie importa, y el escaner
 * se quedaria sin su respaldo justo en los navegadores que mas lo necesitan.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'public', 'vendor');

mkdirSync(destino, { recursive: true });
copyFileSync(require.resolve('jsqr/dist/jsQR.js'), join(destino, 'jsqr.js'));
console.log('jsQR copiado a public/vendor/jsqr.js');
