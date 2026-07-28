import { api, aviso, esc, fechaHora, prepararBarra, descargar } from './comun.js';

prepararBarra();

const eventoId = Number(location.pathname.split('/').pop());
const tabla = document.getElementById('tabla');
const pieTabla = document.getElementById('pie-tabla');
const buscar = document.getElementById('buscar');
const filtro = document.getElementById('filtro');

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
      <td>${esc(b.categoria)}</td>
      <td><span class="pastilla ${b.estado}">${b.estado === 'disponible' ? 'sin usar' : b.estado}</span></td>
      <td class="mini">${b.usada_en ? fechaHora(b.usada_en) : '—'}</td>
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

async function cargarBoletas() {
  const params = new URLSearchParams();
  if (filtro.value) params.set('estado', filtro.value);
  if (buscar.value.trim()) params.set('q', buscar.value.trim());

  const { boletas, resumen } = await api(`/eventos/${eventoId}/boletas?${params}`);
  pintarCifras(resumen);

  if (!boletas.length) {
    tabla.innerHTML = `<tr><td colspan="6" class="vacio">
      ${resumen.total ? 'Ninguna boleta coincide con el filtro.' : 'Aún no has generado boletas para este evento.'}
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

async function cargarEvento() {
  const { evento } = await api(`/eventos/${eventoId}`);
  document.title = `${evento.nombre} · Boletas Colegio Fontán`;
  document.getElementById('titulo').textContent = evento.nombre;
  document.getElementById('detalle').textContent =
    [evento.fecha, evento.lugar].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- acciones

document.getElementById('forma-lote').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = ev.target.querySelector('button[type=submit]');
  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    const { creadas, desde } = await api(`/eventos/${eventoId}/boletas`, {
      cuerpo: {
        cantidad: Number(document.getElementById('cantidad').value),
        categoria: document.getElementById('categoria').value,
        nota: document.getElementById('nota').value,
      },
    });
    aviso(`${creadas} boleta(s) generadas. Descargando el lote…`);
    await cargarBoletas();
    // Solo el lote recien creado, para no rebajar de nuevo lo ya enviado.
    descargar(`/api/eventos/${eventoId}/descargar?desde=${desde}`);
  } catch (err) {
    aviso(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Generar boletas';
  }
});

document.getElementById('descargar-todo').addEventListener('click', () => {
  descargar(`/api/eventos/${eventoId}/descargar`);
  aviso('Preparando el ZIP. Puede tardar unos segundos si son muchas boletas.');
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

Promise.all([cargarEvento(), cargarBoletas()]).catch((err) => aviso(err.message, true));
