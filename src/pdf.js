import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { formatear } from './codigos.js';
import { logo, fuentes } from './marca.js';

// Identidad Colegio Fontan
const VIOLETA = rgb(0x50 / 255, 0x00 / 255, 0x7d / 255);
const CIAN = rgb(0x00 / 255, 0xc8 / 255, 0xff / 255);
const TINTA = rgb(0x0f / 255, 0x17 / 255, 0x2a / 255);
const GRIS = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
const FONDO = rgb(0xf1 / 255, 0xf5 / 255, 0xf9 / 255);
const BLANCO = rgb(1, 1, 1);

const ANCHO = 340;
const ALTO = 540;

// Caja donde se encaja el logo, respetando su proporcion.
const LOGO_ANCHO = 176;
const LOGO_ALTO = 54;
const LOGO_TOPE = 492;

/**
 * Con las fuentes estandar de PDF (WinAnsi) cualquier caracter fuera de
 * Latin-1 haria fallar drawText. Una fuente propia embebida si los admite,
 * asi que solo se limpia cuando hace falta.
 */
function limpiar(texto, propia) {
  const base = String(texto ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
  return (propia ? base : base.replace(/[^\x20-\x7E\xA1-\xFF]/g, '')).trim();
}

function partirLineas(texto, font, tam, anchoMax) {
  const palabras = texto.split(/\s+/).filter(Boolean);
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

export async function construirPdf(boletas, config) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const propia = Boolean(fuentes);
  const negrita = propia
    ? await doc.embedFont(fuentes.negrita, { subset: true })
    : await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = propia
    ? await doc.embedFont(fuentes.normal, { subset: true })
    : await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const txt = (v) => limpiar(v, propia);
  const centrado = (page, texto, { font, size, y, color }) => {
    page.drawText(texto, { x: (ANCHO - font.widthOfTextAtSize(texto, size)) / 2, y, size, font, color });
  };

  doc.setTitle(`Boletas - ${txt(config.nombre)}`);
  doc.setProducer('Entradas Colegio Fontan');

  const marca = logo
    ? await (logo.esPng ? doc.embedPng(logo.datos) : doc.embedJpg(logo.datos))
    : null;

  for (const boleta of boletas) {
    const page = doc.addPage([ANCHO, ALTO]);

    page.drawRectangle({ x: 0, y: 0, width: ANCHO, height: ALTO, color: FONDO });
    tarjeta(page, { x: 14, y: 14, w: 312, h: 512, r: 26, color: BLANCO });

    // ---- logo, encajado en su caja sin deformarse
    if (marca) {
      const escala = Math.min(LOGO_ANCHO / marca.width, LOGO_ALTO / marca.height);
      const w = marca.width * escala;
      const h = marca.height * escala;
      page.drawImage(marca, { x: (ANCHO - w) / 2, y: LOGO_TOPE - h, width: w, height: h });
    } else {
      centrado(page, txt('COLEGIO FONTAN').split('').join(' '), {
        font: negrita, size: 9, y: LOGO_TOPE - 26, color: VIOLETA,
      });
    }

    page.drawRectangle({ x: (ANCHO - 46) / 2, y: 424, width: 46, height: 3, color: CIAN });

    // ---- nombre del evento y cuando
    const lineas = partirLineas(txt(config.nombre), negrita, 21, 260).slice(0, 2);
    lineas.forEach((linea, i) => {
      centrado(page, linea, { font: negrita, size: 21, y: 398 - i * 24, color: VIOLETA });
    });

    let y = 398 - lineas.length * 24 - 2;
    for (const linea of [config.fecha, config.lugar].filter(Boolean).map(txt)) {
      centrado(page, linea, { font: normal, size: 10.5, y, color: GRIS });
      y -= 15;
    }

    // ---- codigo
    const png = await doc.embedPng(await qrPng(boleta.codigo));
    page.drawImage(png, { x: (ANCHO - 190) / 2, y: 152, width: 190, height: 190 });

    centrado(page, formatear(boleta.codigo), { font: mono, size: 10.5, y: 133, color: TINTA });

    // ---- franja violeta inferior con el numero de boleta
    tarjeta(page, { x: 14, y: 14, w: 312, h: 98, r: 26, color: VIOLETA });
    page.drawRectangle({ x: 14, y: 78, width: 312, height: 34, color: VIOLETA });
    page.drawRectangle({ x: 14, y: 109, width: 312, height: 3, color: CIAN });

    centrado(page, `BOLETA N.\xBA ${String(boleta.numero).padStart(4, '0')}`, {
      font: negrita, size: 17, y: 68, color: BLANCO,
    });
    // Blanco atenuado en vez de cian: el cian sobre violeta vibra al imprimir.
    for (const [i, linea] of ['Presenta este código en la entrada', 'Válido para un solo ingreso'].entries()) {
      const limpio = txt(linea);
      page.drawText(limpio, {
        x: (ANCHO - normal.widthOfTextAtSize(limpio, 8.5)) / 2,
        y: 48 - i * 13, size: 8.5, font: normal, color: BLANCO, opacity: 0.72,
      });
    }
  }

  return doc;
}

export async function pdfBoleta(boleta, config) {
  const doc = await construirPdf([boleta], config);
  return Buffer.from(await doc.save());
}
