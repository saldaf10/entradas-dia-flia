import { randomBytes } from 'node:crypto';

// Base32 estilo Crockford: sin I, L, O ni U para que nadie confunda letras al teclear.
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO = 16; // 16 simbolos = 80 bits de entropia

/** Codigo aleatorio de 16 simbolos. Va tal cual dentro del QR. */
export function nuevoCodigo() {
  const bytes = randomBytes(LARGO);
  let salida = '';
  // 32 divide a 256, asi que enmascarar con 0x1f mantiene la distribucion uniforme.
  for (const b of bytes) salida += ALFABETO[b & 0x1f];
  return salida;
}

/** Agrupa de a 4 para leerlo o dictarlo: ABCD-EFGH-JKMN-PQRS */
export function formatear(codigo) {
  return codigo.match(/.{1,4}/g)?.join('-') ?? codigo;
}

/**
 * Deja un texto escrito a mano o leido por camara en su forma canonica.
 * Tolera guiones, espacios, minusculas y las confusiones tipicas (O/0, I/L/1, U/V).
 */
export function normalizar(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export function esCodigoValido(codigo) {
  return codigo.length === LARGO && [...codigo].every((c) => ALFABETO.includes(c));
}
