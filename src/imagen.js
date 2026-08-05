import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';
import { formatear } from './codigos.js';
import { logo, fuentesArchivos, familia } from './marca.js';

// Identidad Colegio Fontan
const VIOLETA = '#50007d';
const CIAN = '#00c8ff';
const TINTA = '#0f172a';
const GRIS = '#64748b';
const FONDO = '#f1f5f9';

// Lienzo en puntos; se rasteriza a ESCALA para que se vea nitido en el celular.
// 2.5 deja la boleta en 850x1350: se ve bien en pantalla, sirve para imprimir
// en pequeno, y mantiene cada archivo liviano para mandarlo por WhatsApp.
const ANCHO = 340;
const ALTO = 540;
const ESCALA = Number(process.env.PNG_ESCALA) || 2.5;

const LOGO_ANCHO = 200;
const LOGO_ALTO = 66;
const LOGO_TOPE = 496; // borde superior del logo, medido desde abajo

/** El texto va dentro del SVG: hay que escapar lo que rompe el marcado. */
function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Ancho aproximado de un texto, para centrar y para partir en lineas.
 * Inter ronda estos factores; no hace falta mas precision porque el SVG
 * centra solo con text-anchor y esto solo decide donde cortar el renglon.
 */
function anchoAprox(texto, tam, negrita) {
  const factor = negrita ? 0.58 : 0.55;
  return texto.length * tam * factor;
}

function partirLineas(texto, tam, anchoMax, negrita) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (anchoAprox(prueba, tam, negrita) <= anchoMax || !actual) actual = prueba;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** En SVG el eje Y crece hacia abajo; el diseno estaba pensado al reves. */
const y = (desdeAbajo) => ALTO - desdeAbajo;

function texto(contenido, { yPos, tam, color, negrita = false, opacidad = 1 }) {
  return `<text x="${ANCHO / 2}" y="${y(yPos)}" text-anchor="middle"
    font-family="${familia}" font-weight="${negrita ? 700 : 400}" font-size="${tam}"
    fill="${color}"${opacidad < 1 ? ` fill-opacity="${opacidad}"` : ''}
    xml:space="preserve">${esc(contenido)}</text>`;
}

async function qrDataUri(codigo) {
  return QRCode.toDataURL(codigo, {
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 600,
    color: { dark: VIOLETA, light: '#ffffff' },
  });
}

function svgBoleta(boleta, config, qr, logoUri) {
  const partes = [];

  partes.push(`<rect width="${ANCHO}" height="${ALTO}" fill="${FONDO}"/>`);
  partes.push(`<rect x="14" y="14" width="312" height="512" rx="26" fill="#ffffff"/>`);

  // ---- logo (o el logotipo de texto si no hay archivo)
  if (logoUri) {
    const escala = Math.min(LOGO_ANCHO / logo.ancho, LOGO_ALTO / logo.alto);
    const w = logo.ancho * escala;
    const h = logo.alto * escala;
    partes.push(`<image href="${logoUri}" x="${(ANCHO - w) / 2}" y="${y(LOGO_TOPE)}"
      width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`);
  } else {
    partes.push(`<text x="${ANCHO / 2}" y="${y(LOGO_TOPE - 26)}" text-anchor="middle"
      font-family="${familia}" font-weight="700" font-size="9" letter-spacing="3"
      fill="${VIOLETA}">COLEGIO FONTÁN</text>`);
  }

  partes.push(`<rect x="${(ANCHO - 46) / 2}" y="${y(421)}" width="46" height="3" fill="${CIAN}"/>`);

  // ---- evento
  const lineas = partirLineas(String(config.nombre ?? '').trim(), 21, 260, true).slice(0, 2);
  lineas.forEach((linea, i) => {
    partes.push(texto(linea, { yPos: 392 - i * 24, tam: 21, color: VIOLETA, negrita: true }));
  });

  let cursor = 392 - lineas.length * 24 - 2;
  for (const linea of [config.fecha, config.lugar].filter(Boolean)) {
    partes.push(texto(String(linea).trim(), { yPos: cursor, tam: 10.5, color: GRIS }));
    cursor -= 15;
  }

  // ---- codigo
  partes.push(`<image href="${qr}" x="${(ANCHO - 190) / 2}" y="${y(342)}" width="190" height="190"/>`);
  partes.push(`<text x="${ANCHO / 2}" y="${y(133)}" text-anchor="middle"
    font-family="monospace" font-size="10.5" letter-spacing="0.5"
    fill="${TINTA}">${esc(formatear(boleta.codigo))}</text>`);

  // ---- franja violeta inferior
  partes.push(`<path d="M14 ${y(112)} H326 V${y(40)} A26 26 0 0 1 300 ${y(14)}
    H40 A26 26 0 0 1 14 ${y(40)} Z" fill="${VIOLETA}"/>`);
  partes.push(`<rect x="14" y="${y(112)}" width="312" height="3" fill="${CIAN}"/>`);

  partes.push(texto(`BOLETA N.º ${String(boleta.numero).padStart(4, '0')}`, {
    yPos: 68, tam: 17, color: '#ffffff', negrita: true,
  }));
  partes.push(texto('Presenta este código en la entrada', {
    yPos: 48, tam: 8.5, color: '#ffffff', opacidad: 0.72,
  }));
  partes.push(texto('Válido para un solo ingreso', {
    yPos: 35, tam: 8.5, color: '#ffffff', opacidad: 0.72,
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}"
    viewBox="0 0 ${ANCHO} ${ALTO}">${partes.join('')}</svg>`;
}

const logoUri = logo
  ? `data:image/${logo.esPng ? 'png' : 'jpeg'};base64,${logo.datos.toString('base64')}`
  : null;

export async function pngBoleta(boleta, config) {
  const svg = svgBoleta(boleta, config, await qrDataUri(boleta.codigo), logoUri);
  const render = new Resvg(svg, {
    fitTo: { mode: 'width', value: ANCHO * ESCALA },
    font: {
      // Sin fuentes del sistema: en Vercel no hay ninguna y el texto saldria en blanco.
      loadSystemFonts: false,
      fontFiles: fuentesArchivos,
      defaultFontFamily: familia,
    },
  });
  return Buffer.from(render.render().asPng());
}
