import { api, aviso, esc, hora, prepararBarra } from './comun.js';

prepararBarra();

const video = document.getElementById('video');
const mira = document.getElementById('mira');
const avisoCamara = document.getElementById('aviso-camara');
const botonCamara = document.getElementById('camara');
const veredicto = document.getElementById('veredicto');
const detalle = document.getElementById('veredicto-detalle');
const registro = document.getElementById('registro');
const soloConsultar = document.getElementById('solo-consultar');

const lienzo = document.createElement('canvas');
const ctx = lienzo.getContext('2d', { willReadFrequently: true });

let flujo = null;
let detector = null;
let validando = false;
const recientes = new Map(); // codigo -> instante, para no releer el mismo QR sin parar
const ESPERA_REPETIDO = 2500;

const TITULOS = {
  ok: 'INGRESO AUTORIZADO',
  repetida: 'YA FUE USADA',
  anulada: 'BOLETA ANULADA',
  invalida: 'CÓDIGO NO VÁLIDO',
};

// ---------------------------------------------------------------- feedback

function pitar(resultado) {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    osc.connect(vol).connect(audio.destination);
    osc.frequency.value = resultado === 'ok' ? 880 : 240;
    vol.gain.setValueAtTime(0.0001, audio.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (resultado === 'ok' ? 0.16 : 0.5));
    osc.start();
    osc.stop(audio.currentTime + (resultado === 'ok' ? 0.18 : 0.52));
    setTimeout(() => audio.close(), 800);
  } catch { /* el audio es un extra, nunca debe romper la validacion */ }

  navigator.vibrate?.(resultado === 'ok' ? 90 : [90, 70, 90]);
}

function mostrar(datos) {
  veredicto.className = `veredicto ${datos.resultado}`;
  const numero = datos.boleta ? `Boleta N.º ${String(datos.boleta.numero).padStart(4, '0')}` : 'Sin boleta';
  veredicto.innerHTML = `
    <p class="mini">${esc(numero)}</p>
    <p class="titulo">${TITULOS[datos.resultado] || datos.resultado}</p>
    <p class="silencio">${esc(datos.mensaje)}</p>
    ${datos.boleta ? `<p class="mini mono separa-arriba">${esc(datos.boleta.codigo_legible)} · ${esc(datos.boleta.categoria)}</p>` : ''}`;
  pitar(datos.resultado);
}

function anotar(datos) {
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="punto ${datos.resultado}"></span>
    <span class="crece">${datos.boleta ? `N.º ${String(datos.boleta.numero).padStart(4, '0')}` : 'Código desconocido'}</span>
    <span class="mini">${hora(new Date().toISOString())}</span>`;
  registro.prepend(li);
  while (registro.children.length > 30) registro.lastElementChild.remove();
}

// ---------------------------------------------------------------- validacion

async function validar(codigo) {
  if (validando) return;
  validando = true;
  try {
    const datos = await api('/validar', { cuerpo: { codigo, consultar: soloConsultar.checked } });
    mostrar(datos);
    anotar(datos);
  } catch (err) {
    aviso(err.message, true);
  } finally {
    validando = false;
  }
}

function alDetectar(texto) {
  const ahora = Date.now();
  const previo = recientes.get(texto);
  if (previo && ahora - previo < ESPERA_REPETIDO) return;
  recientes.set(texto, ahora);
  for (const [k, t] of recientes) if (ahora - t > 60000) recientes.delete(k);
  validar(texto);
}

// ---------------------------------------------------------------- camara

async function leerCuadro() {
  if (!flujo) return;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    try {
      if (detector) {
        const codigos = await detector.detect(video);
        if (codigos[0]?.rawValue) alDetectar(codigos[0].rawValue);
      } else if (window.jsQR) {
        // jsQR necesita los pixeles: se reduce el cuadro para que el movil no sufra.
        const escala = Math.min(1, 480 / Math.max(video.videoWidth, 1));
        lienzo.width = Math.round(video.videoWidth * escala);
        lienzo.height = Math.round(video.videoHeight * escala);
        if (lienzo.width && lienzo.height) {
          ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
          const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
          const hallado = window.jsQR(imagen.data, imagen.width, imagen.height, {
            inversionAttempts: 'dontInvert',
          });
          if (hallado?.data) alDetectar(hallado.data);
        }
      }
    } catch { /* un cuadro ilegible no debe detener el bucle */ }
  }

  setTimeout(leerCuadro, 180);
}

async function encender() {
  if (!navigator.mediaDevices?.getUserMedia) {
    avisoCamara.textContent =
      'Este navegador no da acceso a la cámara. Escribe el código a mano.';
    return;
  }

  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = flujo;
    await video.play();

    if ('BarcodeDetector' in window) {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      if (formatos.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }

    avisoCamara.classList.add('oculto');
    mira.classList.remove('oculto');
    botonCamara.textContent = 'Apagar cámara';
    leerCuadro();
  } catch (err) {
    flujo = null;
    avisoCamara.classList.remove('oculto');
    avisoCamara.textContent =
      err.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Actívalo en el navegador o usa el código a mano.'
        : location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)
          ? 'El navegador solo abre la cámara en HTTPS. Entra por HTTPS o escribe el código a mano.'
          : `No se pudo abrir la cámara: ${err.message}`;
  }
}

function apagar() {
  flujo?.getTracks().forEach((t) => t.stop());
  flujo = null;
  video.srcObject = null;
  mira.classList.add('oculto');
  avisoCamara.classList.remove('oculto');
  avisoCamara.textContent = 'La cámara está apagada.';
  botonCamara.textContent = 'Encender cámara';
}

botonCamara.addEventListener('click', () => (flujo ? apagar() : encender()));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && flujo) apagar();
});

// ---------------------------------------------------------------- manual

document.getElementById('forma-manual').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const campo = document.getElementById('manual');
  const codigo = campo.value.trim();
  if (!codigo) return;
  await validar(codigo);
  campo.value = '';
  campo.focus();
});

// ---------------------------------------------------------------- historial

api('/escaneos?limite=20')
  .then(({ escaneos }) => {
    registro.innerHTML = escaneos
      .map(
        (e) => `<li>
          <span class="punto ${esc(e.resultado)}"></span>
          <span class="crece">${e.numero ? `N.º ${String(e.numero).padStart(4, '0')}` : 'Código desconocido'}</span>
          <span class="mini">${hora(e.en)}</span>
        </li>`
      )
      .join('');
  })
  .catch(() => {});
