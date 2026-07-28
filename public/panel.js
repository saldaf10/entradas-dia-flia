import { api, aviso, esc, prepararBarra } from './comun.js';

prepararBarra();

const lista = document.getElementById('lista');
const forma = document.getElementById('forma-evento');

function tarjetaEvento(evento) {
  const r = evento.resumen;
  const total = r.total || 0;
  const usadas = r.usadas || 0;
  const avance = total ? Math.round((usadas / total) * 100) : 0;
  const detalle = [evento.fecha, evento.lugar].filter(Boolean).map(esc).join(' · ');

  return `
    <a class="evento" href="/evento/${evento.id}">
      <h2>${esc(evento.nombre)}</h2>
      ${detalle ? `<p class="mini separa-arriba">${detalle}</p>` : ''}
      <div class="barrita" data-avance="${avance}"><i></i></div>
      <p class="mini separa-arriba">
        <strong>${total}</strong> boletas · <strong>${usadas}</strong> usadas ·
        <strong>${r.disponibles || 0}</strong> sin usar
      </p>
    </a>`;
}

async function cargar() {
  const { eventos } = await api('/eventos');
  if (!eventos.length) {
    lista.innerHTML = `
      <div class="tarjeta vacio ancho-total">
        <p>Todavía no hay eventos.</p>
        <p class="mini">Crea uno arriba para empezar a generar boletas.</p>
      </div>`;
    return;
  }
  lista.innerHTML = eventos.map(tarjetaEvento).join('');
  // El ancho se aplica por CSSOM: la CSP prohibe atributos style en el HTML.
  for (const barra of lista.querySelectorAll('.barrita')) {
    barra.firstElementChild.style.width = `${barra.dataset.avance}%`;
  }
}

forma.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = forma.querySelector('button');
  boton.disabled = true;
  try {
    const { evento } = await api('/eventos', {
      cuerpo: {
        nombre: document.getElementById('nombre').value,
        fecha: document.getElementById('fecha').value,
        lugar: document.getElementById('lugar').value,
      },
    });
    location.href = `/evento/${evento.id}`;
  } catch (err) {
    aviso(err.message, true);
    boton.disabled = false;
  }
});

cargar().catch((err) => aviso(err.message, true));
