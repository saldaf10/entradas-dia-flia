/** Utilidades compartidas por todas las paginas. */

export async function api(ruta, opciones = {}) {
  const cfg = { credentials: 'same-origin', ...opciones };
  if (cfg.cuerpo !== undefined) {
    cfg.method = cfg.method || 'POST';
    cfg.headers = { 'Content-Type': 'application/json', ...(cfg.headers || {}) };
    cfg.body = JSON.stringify(cfg.cuerpo);
    delete cfg.cuerpo;
  }

  const res = await fetch(`/api${ruta}`, cfg);
  if (res.status === 401 && !location.pathname.startsWith('/entrar')) {
    location.href = '/entrar';
    throw new Error('Sesion expirada');
  }

  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

export function aviso(mensaje, malo = false) {
  let caja = document.getElementById('avisos');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'avisos';
    document.body.appendChild(caja);
  }
  const nodo = document.createElement('div');
  nodo.className = `aviso-flotante${malo ? ' malo' : ''}`;
  nodo.textContent = mensaje;
  caja.appendChild(nodo);
  setTimeout(() => nodo.remove(), 4200);
}

/** Escapa texto que venga de la base de datos antes de meterlo en innerHTML. */
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function fechaHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function hora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Marca el enlace activo y conecta el boton de salir. */
export function prepararBarra() {
  for (const a of document.querySelectorAll('.barra nav a')) {
    if (a.getAttribute('href') === location.pathname) a.classList.add('activo');
  }
  document.getElementById('salir')?.addEventListener('click', async () => {
    await api('/salir', { method: 'POST', cuerpo: {} }).catch(() => {});
    location.href = '/entrar';
  });
}

export function descargar(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
