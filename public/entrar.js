import { api } from './comun.js';

const forma = document.getElementById('forma');
const boton = document.getElementById('boton');
const error = document.getElementById('error');

forma.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  error.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Entrando…';

  try {
    await api('/entrar', {
      cuerpo: {
        usuario: document.getElementById('usuario').value,
        clave: document.getElementById('clave').value,
      },
    });
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    document.getElementById('clave').value = '';
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});
