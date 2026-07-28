import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { formatear } from './codigos.js';

// Identidad Colegio Fontan
const VIOLETA = rgb(0x50 / 255, 0x00 / 255, 0x7d / 255);
const CIAN = rgb(0x00 / 255, 0xc8 / 255, 0xff / 255);
const TINTA = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);
const GRIS = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
const FONDO = rgb(0xf1 / 255, 0xf5 / 255, 0xf9 / 255);
const BLANCO = rgb(1, 1, 1);
const VIOLETA_SUAVE = rgb(0xf3 / 255, 0xe9 / 255, 0xf9 / 255);

const ANCHO = 340;
const ALTO = 540;

/**
 * Las fuentes estandar de PDF usan WinAnsi: cualquier caracter fuera de Latin-1
 * (emojis, comillas tipograficas) haria fallar drawText. El nombre del evento lo
 * escribe una persona, asi que se limpia antes de dibujar.
 */
function limpiar(texto) {
  return String(texto ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, '')
    .trim();
}

/** Imita el tracking amplio de los titulillos del sitio. */
function espaciado(texto) {
  return limpiar(texto).split('').join(' ');
}

function partirLineas(texto, font, tam, anchoMax) {
  const palabras = limpiar(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(prueba, tam) <= anchoMax || !actual) actual = prueba;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function centrado(page, texto, { font, size, y, color }) {
  const limpio = limpiar(texto);
  const x = (ANCHO - font.widthOfTextAtSize(limpio, size)) / 2;
  page.drawText(limpio, { x, y, size, font, color });
}

/** Rectangulo con esquinas redondeadas (drawSvgPath dibuja con el eje Y invertido). */
function tarjeta(page, { x, y, w, h, r, color }) {
  const d =
    `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} ` +
    `A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} ` +
    `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(d, { x, y: y + h, color });
}

async function qrPng(codigo) {
  return QRCode.toBuffer(codigo, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 600,
    color: { dark: '#50007dff', light: '#ffffffff' },
  });
}

/**
 * Dibuja una boleta por pagina. Devuelve el PDFDocument para poder
 * reutilizarlo tanto en la descarga individual como en la masiva.
 */
export async function construirPdf(boletas, config) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Boletas - ${limpiar(config.nombre)}`);
  doc.setProducer('Entradas Colegio Fontan');

  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);

  for (const boleta of boletas) {
    const page = doc.addPage([ANCHO, ALTO]);

    page.drawRectangle({ x: 0, y: 0, width: ANCHO, height: ALTO, color: FONDO });
    tarjeta(page, { x: 14, y: 14, w: 312, h: 512, r: 26, color: BLANCO });

    // Cabecera violeta: rectangulo redondeado + relleno recto para cuadrar el borde inferior.
    tarjeta(page, { x: 14, y: 418, w: 312, h: 108, r: 26, color: VIOLETA });
    page.drawRectangle({ x: 14, y: 418, width: 312, height: 40, color: VIOLETA });
    page.drawRectangle({ x: 14, y: 414, width: 312, height: 4, color: CIAN });

    page.drawText(espaciado('COLEGIO FONTÁN'), {
      x: 34, y: 488, size: 7.5, font: negrita, color: CIAN,
    });

    // El nombre se ancla al borde inferior de la banda para que crezca hacia arriba
    // sin dejar un hueco cuando ocupa una sola linea.
    const lineas = partirLineas(config.nombre, negrita, 19, 264).slice(0, 2);
    lineas.forEach((linea, i) => {
      const y = 438 + (lineas.length - 1 - i) * 23;
      page.drawText(linea, { x: 34, y, size: 19, font: negrita, color: BLANCO });
    });

    centrado(page, `BOLETA N.\xBA ${String(boleta.numero).padStart(4, '0')}`, {
      font: negrita, size: 15, y: 384, color: VIOLETA,
    });

    const cat = espaciado(boleta.categoria || 'General').toUpperCase();
    const anchoCat = normal.widthOfTextAtSize(cat, 7.5);
    tarjeta(page, {
      x: (ANCHO - anchoCat - 24) / 2, y: 356, w: anchoCat + 24, h: 18, r: 9, color: VIOLETA_SUAVE,
    });
    centrado(page, cat, { font: normal, size: 7.5, y: 361.5, color: VIOLETA });

    const png = await doc.embedPng(await qrPng(boleta.codigo));
    page.drawImage(png, { x: (ANCHO - 180) / 2, y: 152, width: 180, height: 180 });

    centrado(page, formatear(boleta.codigo), {
      font: mono, size: 10.5, y: 132, color: TINTA,
    });

    page.drawLine({
      start: { x: 50, y: 116 }, end: { x: ANCHO - 50, y: 116 },
      thickness: 1, color: rgb(0.89, 0.91, 0.94), dashArray: [3, 3],
    });

    const pie = [config.fecha, config.lugar].filter(Boolean).map(limpiar);
    pie.forEach((linea, i) => {
      centrado(page, linea, { font: normal, size: 9.5, y: 96 - i * 14, color: GRIS });
    });

    centrado(page, 'Presenta este código en la entrada.', {
      font: normal, size: 8, y: 56, color: GRIS,
    });
    centrado(page, 'Válido para un solo ingreso.', {
      font: normal, size: 8, y: 44, color: GRIS,
    });
  }

  return doc;
}

export async function pdfBoleta(boleta, config) {
  const doc = await construirPdf([boleta], config);
  return Buffer.from(await doc.save());
}
