#!/usr/bin/env node
/**
 * Recorta los margenes transparentes del logo y lo deja como public/marca/logo.png.
 *
 * Los logos exportados desde el manual de marca suelen venir centrados en una
 * lamina enorme: si se incrustan tal cual, en la boleta se ve diminuto porque
 * casi todo el archivo es aire. Esto encuentra el recuadro que de verdad tiene
 * pixeles y lo deja ajustado.
 *
 *   npm run marca
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'marca');
const SALIDA = join(CARPETA, 'logo.png');
const UMBRAL_ALFA = 8; // por debajo de esto se considera transparente

// ---------------------------------------------------------------- PNG

function leerPng(ruta) {
  const buf = readFileSync(ruta);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');

  let off = 8;
  const idat = [];
  let ancho = 0, alto = 0, canales = 4, profundidad = 8, tipoColor = 6;

  while (off < buf.length) {
    const largo = buf.readUInt32BE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    const datos = buf.subarray(off + 8, off + 8 + largo);
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      profundidad = datos[8];
      tipoColor = datos[9];
      canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipoColor];
      if (datos[12] !== 0) throw new Error('PNG entrelazado, no soportado');
    } else if (tipo === 'IDAT') idat.push(datos);
    else if (tipo === 'IEND') break;
    off += 12 + largo;
  }

  if (profundidad !== 8 || !canales) {
    throw new Error(`PNG de ${profundidad} bits tipo ${tipoColor}, no soportado`);
  }

  const crudo = inflateSync(Buffer.concat(idat));
  const bpp = canales;
  const linea = ancho * bpp;
  const px = Buffer.alloc(alto * linea);
  let p = 0;

  // Deshace los filtros por linea (spec PNG).
  for (let y = 0; y < alto; y += 1) {
    const filtro = crudo[p]; p += 1;
    for (let x = 0; x < linea; x += 1) {
      const c = crudo[p + x];
      const a = x >= bpp ? px[y * linea + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * linea + x] : 0;
      const d = x >= bpp && y > 0 ? px[(y - 1) * linea + x - bpp] : 0;
      let v;
      if (filtro === 0) v = c;
      else if (filtro === 1) v = c + a;
      else if (filtro === 2) v = c + b;
      else if (filtro === 3) v = c + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - d), pb = Math.abs(a - d), pc = Math.abs(a + b - 2 * d);
        v = c + (pa <= pb && pa <= pc ? a : pb <= pc ? b : d);
      }
      px[y * linea + x] = v & 0xff;
    }
    p += linea;
  }
  return { ancho, alto, canales, px };
}

const TABLA_CRC = [...Array(256).keys()].map((n) => {
  for (let k = 0; k < 8; k += 1) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function escribirPng(ancho, alto, rgba) {
  const linea = ancho * 4;
  const crudo = Buffer.alloc(alto * (linea + 1));
  for (let y = 0; y < alto; y += 1) {
    crudo[y * (linea + 1)] = 0; // sin filtro
    rgba.copy(crudo, y * (linea + 1) + 1, y * linea, (y + 1) * linea);
  }

  const crc = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const suma = Buffer.alloc(4); suma.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, suma]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- recorte

const fuentes = readdirSync(CARPETA).filter((n) => /\.png$/i.test(n) && n !== 'logo.png');
const origen = fuentes[0] ?? (readdirSync(CARPETA).includes('logo.png') ? 'logo.png' : null);

if (!origen) {
  console.error('No hay ningun PNG en public/marca/. Deja ahi el logo y vuelve a correr.');
  process.exit(1);
}

const { ancho, alto, canales, px } = leerPng(join(CARPETA, origen));
const linea = ancho * canales;

let x0 = ancho, y0 = alto, x1 = -1, y1 = -1;
for (let y = 0; y < alto; y += 1) {
  for (let x = 0; x < ancho; x += 1) {
    const alfa = canales === 4 ? px[y * linea + x * canales + 3]
      : canales === 2 ? px[y * linea + x * canales + 1] : 255;
    if (alfa > UMBRAL_ALFA) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}

if (x1 < 0) {
  console.error(`"${origen}" esta completamente transparente.`);
  process.exit(1);
}

const w = x1 - x0 + 1;
const h = y1 - y0 + 1;
const recorte = Buffer.alloc(w * h * 4);

for (let y = 0; y < h; y += 1) {
  for (let x = 0; x < w; x += 1) {
    const o = (y + y0) * linea + (x + x0) * canales;
    const d = (y * w + x) * 4;
    if (canales >= 3) {
      recorte[d] = px[o]; recorte[d + 1] = px[o + 1]; recorte[d + 2] = px[o + 2];
      recorte[d + 3] = canales === 4 ? px[o + 3] : 255;
    } else {
      recorte[d] = recorte[d + 1] = recorte[d + 2] = px[o];
      recorte[d + 3] = canales === 2 ? px[o + 1] : 255;
    }
  }
}

writeFileSync(SALIDA, escribirPng(w, h, recorte));
console.log(`${origen}: ${ancho}x${alto} -> logo.png ${w}x${h} (proporcion ${(w / h).toFixed(2)}:1)`);
