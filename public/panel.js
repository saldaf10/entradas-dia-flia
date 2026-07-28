import { api, aviso, esc, fechaHora, prepararBarra, descargar, descargarArchivo } from './comun.js';

prepararBarra();

const tabla = document.getElementById('tabla');
const pieTabla = document.getElementById('pie-tabla');
const buscar = document.getElementById('buscar');
const filtro = document.getElementById('filtro');
const progreso = document.getElementById('progreso');
const formaEvento = document.getElementById('forma-evento');

let config = null;
let maxZip = 200;

// ---------------------------------------------------------------- evento

function pintarEvento() {
  document.title = `${config.nombre} · Boletas Colegio Fontán`;
  document.getElementById('titulo').textContent = config.nombre;
  document.getElementById('detalle').textContent =
    [config.fecha, config.lugar].filter(Boolean).join(' · ');

  document.getElementById('nombre').value = config.nombre ?? '';
  document.getElementById('fecha').value = config.fecha ?? '';
  document.getElementById('lugar').value = config.lugar ?? '';
}

document.getElementById('editar').addEventListener('click', () => {
  formaEvento.classList.toggle('oculto');
  if (!formaEvento.classList.contains('oculto')) document.getElementById('nombre').focus();
});

document.getElementById('cancelar').addEventListener('click', () => {
  pintarEvento();
  formaEvento.classList.add('oculto');
});

formaEvento.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const datos = await api('/config', {
      method: 'PATCH',
      cuerpo: {
        nombre: document.getElementById('nombre').value,
        fecha: document.getElementById('fecha').value,
        lugar: document.getElementById('lugar').value,
      },
    });
    config = datos.config;
    pintarEvento();
    formaEvento.classList.add('oculto');
    aviso('Datos guardados. Las boletas nuevas saldrán con estos datos.');
  } catch (err) {
    aviso(err.message, true);
  }
});

// ---------------------------------------------------------------- boletas

function pintarCifras(r) {
  document.getElementById('cifras').innerHTML = `
    <div class="cifra"><b>${r.total || 0}</b><span>Emitidas</span></div>
    <div class="cifra verde"><b>${r.disponibles || 0}</b><span>Sin usar</span></div>
    <div class="cifra violeta"><b>${r.usadas || 0}</b><span>Ya ingresaron</span></div>
    <div class="cifra gris"><b>${r.anuladas || 0}</b><span>Anuladas</span></div>`;
}

function filaBoleta(b) {
  const anulable = b.estado !== 'anulada';
  return `
    <tr class="${b.estado}">
      <td><strong>${String(b.numero).padStart(4, '0')}</strong></td>
      <td class="mono mini">${esc(b.codigo_legible)}</td>
      <td><span class="pastilla ${b.estado}">${b.estado === 'disponible' ? 'sin usar' : b.estado}</span></td>
      <td class="mini fecha">${b.usada_en ? fechaHora(b.usada_en) : '—'}</td>
      <td>
        <div class="fila acciones">
          <button class="suave chico" data-pdf="${b.id}">PDF</button>
          <button class="texto chico" data-estado="${b.id}" data-destino="${anulable ? 'anulada' : 'disponible'}">
            ${anulable ? 'Anular' : 'Restaurar'}
          </button>
        </div>
      </td>
    </tr>`;
}

let ultimoResumen = { total: 0 };

async function cargarBoletas() {
  const params = new URLSearchParams();
  if (filtro.value) params.set('estado', filtro.value);
  if (buscar.value.trim()) params.set('q', buscar.value.trim());

  const { boletas, resumen } = await api(`/boletas?${params}`);
  ultimoResumen = resumen;
  pintarCifras(resumen);

  if (!boletas.length) {
    tabla.innerHTML = `<tr><td colspan="5" class="vacio">
      ${resumen.total ? 'Ninguna boleta coincide con el filtro.' : 'Todavía no has generado boletas. Usa el Paso 1 aquí arriba.'}
    </td></tr>`;
    pieTabla.textContent = '';
    return;
  }

  tabla.innerHTML = boletas.map(filaBoleta).join('');
  pieTabla.textContent =
    boletas.length >= 1000
      ? 'Mostrando las primeras 1000 boletas. Usa el buscador para acotar.'
      : `${boletas.length} boleta(s) en pantalla.`;
}

// ---------------------------------------------------------------- descargas

/**
 * Baja el rango en varios ZIP. Un solo archivo con cientos de PDF supera
 * los limites de una funcion serverless, asi que se parte y se encadena.
 */
async function descargarRango(desde, hasta) {
  const partes = Math.ceil((hasta - desde + 1) / maxZip);
  for (let i = 0; i < partes; i += 1) {
    const a = desde + i * maxZip;
    const b = Math.min(a + maxZip - 1, hasta);
    progreso.textContent = partes > 1
      ? `Preparando parte ${i + 1} de ${partes} (boletas ${a} a ${b})…`
      : `Preparando ${b - a + 1} boleta(s)…`;
    await descargarArchivo(`/api/descargar?desde=${a}&hasta=${b}`);
  }
  progreso.textContent = partes > 1
    ? `Listo: ${partes} archivos ZIP descargados.`
    : 'Listo, revisa tus descargas.';
  setTimeout(() => { progreso.textContent = ''; }, 8000);
}

document.getElementById('forma-lote').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = document.getElementById('generar');
  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    const { creadas, desde, hasta } = await api('/boletas', {
      cuerpo: { cantidad: Number(document.getElementById('cantidad').value) },
    });
    aviso(`${creadas} boleta(s) generadas.`);
    await cargarBoletas();
    await descargarRango(desde, hasta);
  } catch (err) {
    aviso(err.message, true);
    progreso.textContent = '';
  } finally {
    boton.disabled = false;
    boton.textContent = 'Generar boletas y descargar';
  }
});

document.getElementById('descargar-todo').addEventListener('click', async (ev) => {
  if (!ultimoResumen.total) return aviso('Todavía no hay boletas generadas.', true);
  ev.target.disabled = true;
  try {
    await descargarRango(1, Number(ultimoResumen.total));
  } catch (err) {
    aviso(err.message, true);
    progreso.textContent = '';
  } finally {
    ev.target.disabled = false;
  }
});

tabla.addEventListener('click', async (ev) => {
  const pdf = ev.target.closest('[data-pdf]');
  if (pdf) return descargar(`/api/boletas/${pdf.dataset.pdf}/pdf`);

  const cambio = ev.target.closest('[data-estado]');
  if (!cambio) return;

  const anulando = cambio.dataset.destino === 'anulada';
  if (anulando && !confirm('¿Anular esta boleta? Dejará de permitir el ingreso.')) return;

  try {
    await api(`/boletas/${cambio.dataset.estado}/estado`, { cuerpo: { estado: cambio.dataset.destino } });
    aviso(anulando ? 'Boleta anulada.' : 'Boleta restaurada como sin usar.');
    await cargarBoletas();
  } catch (err) {
    aviso(err.message, true);
  }
});

let temporizador;
buscar.addEventListener('input', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => cargarBoletas().catch((e) => aviso(e.message, true)), 250);
});
filtro.addEventListener('change', () => cargarBoletas().catch((e) => aviso(e.message, true)));

(async () => {
  const datos = await api('/config');
  config = datos.config;
  maxZip = datos.max_zip || maxZip;
  pintarEvento();
  await cargarBoletas();
})().catch((err) => aviso(err.message, true));
