# Entradas · Colegio Fontán

Generación y validación de boletas con código QR para los eventos del colegio.
Una sola persona entra con usuario y contraseña, genera las boletas, descarga un
PDF por boleta para enviárselo a cada comprador, y en la puerta escanea los QR
para saber cuáles ya se usaron.

No procesa pagos: el cobro se maneja por fuera.

---

## Poner a andar

Requiere **Node 22.5 o superior** (usa el módulo `node:sqlite` incorporado, así que
no hay que compilar nada).

```bash
npm install
```

Crea el usuario que va a manejar la boletería:

```bash
npm run usuario -- crear mama "una-contraseña-larga-y-propia"
```

Arranca:

```bash
npm start
```

Queda en `http://localhost:3000`. Otras acciones de usuarios:

```bash
npm run usuario -- listar
npm run usuario -- clave mama "contraseña-nueva"
```

Cambiar la contraseña cierra todas las sesiones abiertas de esa persona.

---

## Cómo se usa

1. **Eventos** → crear el evento. El nombre, la fecha y el lugar son lo que se
   imprime en la boleta.
2. **Generar boletas** → cantidad y categoría (General, Adulto, Niño…). Al terminar
   se descarga automáticamente un ZIP con **el lote recién creado**, un PDF por boleta.
   Puedes generar varios lotes: la numeración continúa donde quedó.
3. **Enviar** cada PDF a su comprador (WhatsApp, correo, lo que sea).
4. **Escanear** → en la puerta, desde el celular. Apunta la cámara al QR y sale
   en grande si el ingreso está autorizado o si la boleta ya se había usado.

Detalles que ayudan el día del evento:

- **Solo consultar**: revisa una boleta sin marcarla como usada.
- **Código a mano**: si la cámara falla o el QR está borroso, se escribe el código
  impreso debajo del QR. Acepta minúsculas, con o sin guiones.
- **Anular**: una boleta anulada deja de permitir el ingreso (por ejemplo, si se
  devolvió el dinero). Se puede restaurar.
- **Descargar todas**: vuelve a generar el ZIP completo del evento por si hay que
  reenviar algo.

---

## La cámara necesita HTTPS

Los navegadores solo dan acceso a la cámara en `https://` o en `localhost`. Si abres
la app desde un celular apuntando a la IP del computador por `http://`, la cámara
**no** va a abrir — el escáner lo avisa y queda el campo de código a mano.

Para escanear con la cámara, publica la app en un servicio que dé HTTPS
(Render, Railway, Fly.io, o un servidor del colegio con certificado) y entra por
ese dominio.

Al desplegar:

- `NODE_ENV=production` — hace que la cookie de sesión sea `Secure`.
- `PORT` — el que asigne el hosting.
- `DB_FILE` — ruta del archivo SQLite. Por defecto `data/entradas.db`.
  **Tiene que estar en un disco persistente**, o las boletas se pierden en cada
  reinicio. En Render eso es un *Persistent Disk*; en plataformas serverless
  (Vercel, Netlify Functions) el disco es efímero y este diseño no aplica.

---

## Copia de seguridad

Toda la información vive en un solo archivo. Copiarlo es todo el respaldo:

```bash
cp data/entradas.db respaldo-$(date +%F).db
```

Vale la pena hacerlo la noche antes del evento.

---

## Sobre la seguridad

Lo que hay, y por qué alcanza para esto:

- La contraseña se guarda con **scrypt** y sal aleatoria, nunca en texto plano.
- La sesión es una cookie `HttpOnly` + `SameSite=Lax` con un token aleatorio de
  256 bits, guardado en la base y con vencimiento a 7 días.
- **Máximo 8 intentos de login cada 15 minutos** por IP.
- El código de cada boleta son **80 bits aleatorios** (16 símbolos). No es
  correlativo ni deducible: nadie puede inventarse una boleta válida a partir de otra.
- La boleta se marca como usada con un `UPDATE ... WHERE estado = 'disponible'`
  en una sola operación. Si dos personas escanean la misma boleta al mismo tiempo
  en puertas distintas, **solo una recibe "ingreso autorizado"**.
- Todos los escaneos quedan registrados, incluidos los códigos falsos.
- Cabeceras `Content-Security-Policy`, `X-Frame-Options` y `nosniff`; nada de
  JavaScript en línea ni librerías traídas de CDN.

Lo que **no** hay, a propósito: no hay registro público de usuarios, ni
recuperación de contraseña por correo, ni roles. Los usuarios se crean desde la
terminal del servidor.

---

## Estructura

```
src/server.js     Express, cabeceras de seguridad, rutas de páginas
src/rutas.js      API: eventos, boletas, validación, descargas
src/auth.js       Contraseñas (scrypt), sesiones, límite de intentos
src/db.js         SQLite y esquema
src/codigos.js    Generación y normalización de los códigos
src/pdf.js        Diseño de la boleta en PDF
public/           Interfaz (sin build ni framework)
scripts/usuario.js
```
