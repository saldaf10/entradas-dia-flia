import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';

/**
 * Recursos de marca de la boleta.
 *
 *   public/marca/logo.png          -> logo impreso (lo genera "npm run marca")
 *   public/marca/fuentes/*.ttf|otf -> tipografia; el archivo que diga "bold"
 *                                     o "semibold" se usa para los titulos
 *
 * Las fuentes son obligatorias para la imagen: el rasterizador no dibuja
 * texto sin un archivo, y los servidores de Vercel no traen ninguna.
 */
const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'marca');
const FUENTES = join(CARPETA, 'fuentes');

function listar(carpeta) {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta).filter((n) => !n.startsWith('.'));
}

/** Alto y ancho reales de la imagen, para encajarla sin deformarla. */
function medidas(datos, esPng) {
  if (esPng) return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) };

  // JPEG: se recorren los marcadores hasta el SOF, que trae las dimensiones.
  let i = 2;
  while (i < datos.length) {
    if (datos[i] !== 0xff) { i += 1; continue; }
    const marca = datos[i + 1];
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { alto: datos.readUInt16BE(i + 5), ancho: datos.readUInt16BE(i + 7) };
    }
    i += 2 + datos.readUInt16BE(i + 2);
  }
  return { ancho: 1, alto: 1 };
}

function buscarLogo() {
  const nombre = listar(CARPETA).find((n) => /^logo\.(png|jpg|jpeg)$/i.test(n));
  if (!nombre) return null;
  const datos = readFileSync(join(CARPETA, nombre));
  const esPng = /\.png$/i.test(nombre);
  return { datos, esPng, ...medidas(datos, esPng) };
}

function buscarFuentes() {
  const archivos = listar(FUENTES).filter((n) => /\.(ttf|otf)$/i.test(n));
  if (!archivos.length) return { rutas: [], familia: 'sans-serif', nombres: [] };

  const rutas = archivos.map((n) => join(FUENTES, n));
  let nombre = 'sans-serif';
  try {
    // El SVG pide la fuente por nombre de familia, no por ruta.
    nombre = fontkit.create(readFileSync(rutas[0])).familyName || nombre;
  } catch { /* si no se puede leer el nombre, resvg usa la primera que cargue */ }

  return { rutas, familia: nombre, nombres: archivos };
}

// Se leen una vez por proceso: son pocos archivos y no cambian en caliente.
export const logo = buscarLogo();

const fuentes = buscarFuentes();
export const fuentesArchivos = fuentes.rutas;
export const familia = fuentes.familia;

export function resumenMarca() {
  return {
    logo: logo ? `${logo.ancho}x${logo.alto}` : null,
    fuente: fuentes.nombres.length ? `${familia} (${fuentes.nombres.join(', ')})` : null,
  };
}
