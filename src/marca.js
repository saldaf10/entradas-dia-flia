import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

/**
 * Recursos de marca opcionales. Se dejan caer en public/marca/ y la boleta
 * los toma sola; si no estan, cae en el logotipo de texto y en Helvetica.
 *
 *   logo.png / logo.jpg          -> logo impreso en la boleta
 *   cualquier .ttf / .otf        -> tipografia del evento
 *   (el archivo cuyo nombre diga "bold" o "semibold" se usa para los titulos)
 */
const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'marca');

function archivos() {
  if (!existsSync(CARPETA)) return [];
  return readdirSync(CARPETA).filter((n) => !n.startsWith('.'));
}

function buscarLogo() {
  const nombre = archivos().find((n) => /^logo\.(png|jpg|jpeg)$/i.test(n));
  if (!nombre) return null;
  return { datos: readFileSync(join(CARPETA, nombre)), esPng: /\.png$/i.test(nombre) };
}

function buscarFuentes() {
  const tipograficos = archivos().filter((n) => /\.(ttf|otf)$/i.test(n));
  if (!tipograficos.length) return null;

  const negrita = tipograficos.find((n) => /(bold|semibold|600|700)/i.test(n));
  // Si solo hay un archivo sirve para todo; no es ideal, pero es mejor que
  // mezclar la tipografia del colegio con Helvetica en la misma boleta.
  const normal = tipograficos.find((n) => n !== negrita) ?? negrita ?? tipograficos[0];

  return {
    normal: readFileSync(join(CARPETA, normal)),
    negrita: readFileSync(join(CARPETA, negrita ?? normal)),
    nombres: { normal, negrita: negrita ?? normal },
  };
}

// Se leen una vez por proceso: son pocos kilobytes y no cambian en caliente.
export const logo = buscarLogo();
export const fuentes = buscarFuentes();

export function resumenMarca() {
  return {
    logo: Boolean(logo),
    fuente: fuentes ? `${fuentes.nombres.normal} / ${fuentes.nombres.negrita}` : 'Helvetica (por defecto)',
  };
}
