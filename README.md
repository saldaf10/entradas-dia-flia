# Entradas · Colegio Fontán

Boletas con código QR para los eventos del colegio. Una sola persona entra con
usuario y contraseña, genera las boletas, descarga un PDF por boleta para
enviárselo a cada comprador, y en la puerta escanea los QR desde el celular para
saber cuáles ya se usaron.

No procesa pagos: el cobro se maneja por fuera.

Solo hay **un evento a la vez**. Sus datos (nombre, fecha, lugar) se editan desde
la misma pantalla principal y son los que salen impresos en la boleta.

---

## Las dos pantallas

**Boletas** (`/`) — es la pantalla principal y ahí mismo está el generador:

1. *Generar códigos QR* → escribe cuántas boletas y presiona **Generar boletas y
   descargar**. Al terminar bajan solas, en ZIP, con un PDF por boleta.
2. Abajo queda la lista de todas las boletas emitidas, con su estado. Desde ahí
   puedes bajar el PDF de una sola boleta o anularla.

Puedes generar varios lotes; la numeración continúa donde quedó.

**Escanear** (`/escanear`) — para la puerta el día del evento. Apunta la cámara al
QR y sale en grande si el ingreso está autorizado o si la boleta ya se usó.

- **Solo consultar**: revisa una boleta sin marcarla como usada. En «Últimos
  escaneos» cada línea dice si fue **ingreso** o **consulta**.
- **Código a mano**: si la cámara falla, se escribe el código impreso bajo el QR.
  Acepta minúsculas, con o sin guiones.

---

## Correr en el computador

Requiere **Node 22.5 o superior**.

```bash
npm install
npm run usuario -- crear mama "una-contraseña-larga-y-propia"
npm start
```

Queda en `http://localhost:3000` y guarda todo en `data/entradas.db`.

Otras acciones:

```bash
npm run usuario -- listar
npm run usuario -- clave mama "contraseña-nueva"
```

Cambiar la contraseña cierra las sesiones abiertas de esa persona.

---

## Publicar en Vercel

### Por qué hace falta una base aparte

En tu computador la app guarda todo en un archivo (`data/entradas.db`). Vercel no
sirve para eso: cada despliegue arranca con el disco en blanco, así que un archivo
guardado ahí desaparece. La información tiene que vivir en un servicio aparte.

Se usa **Turso**: es el mismo SQLite de siempre, pero alojado en internet en vez
de en un archivo tuyo. No hay que aprender nada nuevo — el código es idéntico,
solo cambia a dónde apunta. Su plan gratuito da 500 millones de lecturas al mes;
un evento del colegio usa unos pocos miles.

### Pasos

**1. Importar el repo en Vercel** (Add New → Project).

**2. En el proyecto → pestaña Storage → Browse Marketplace → Turso.** Conectar una
base crea sola las variables `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`, que es lo
que la app busca. No hay que copiar tokens a mano.

**3. Redesplegar** (Deployments → … → Redeploy) para que tome las variables.
Las tablas se crean solas la primera vez que alguien entra.

**4. Crear el usuario en la base de producción.** Este es el paso que se olvida:
sin él la app abre pero nadie puede entrar. Desde la carpeta del proyecto:

```bash
vercel env pull .env.produccion
set -a && . ./.env.produccion && set +a && npm run usuario -- crear admincolegio 'la-contraseña'
```

`vercel env pull` baja las variables del proyecto (requiere `npm i -g vercel` y
`vercel link` la primera vez). Sin variables, el comando trabaja sobre el archivo
local; con ellas, sobre la base real. Es el mismo comando para cambiar la
contraseña después.

> El archivo `.env.produccion` trae el token: está en `.gitignore`, no lo subas.

### La cámara y el HTTPS

Los navegadores solo dan acceso a la cámara en `https://` o en `localhost`. Vercel
da HTTPS, así que desde el celular el escáner funciona. Si en cambio abres la app
por la IP del computador (`http://192.168.…`), la cámara **no** abre — el escáner
lo avisa y queda disponible el campo de código a mano.

### Por qué las descargas grandes vienen partidas

Una función de Vercel tiene límite de tiempo y de tamaño de respuesta, así que
cada ZIP trae máximo **200 boletas**. Si generas 500, bajan tres archivos seguidos
y la pantalla te va diciendo por cuál va. No hay que hacer nada especial.

---

## Copia de seguridad

Con base local, todo está en un archivo:

```bash
cp data/entradas.db respaldo-$(date +%F).db
```

Con Turso, desde el panel de Turso o con su CLI (`turso db shell … .dump`).
Vale la pena hacerlo la noche antes del evento.

---

## Sobre la seguridad

- La contraseña se guarda con **scrypt** y sal aleatoria, nunca en texto plano.
- La sesión es una cookie `HttpOnly` + `SameSite=Lax` con un token aleatorio de
  256 bits, guardado en la base y con vencimiento a 7 días.
- **Máximo 8 intentos de login cada 15 minutos** por IP.
- El código de cada boleta son **80 bits aleatorios** (16 símbolos). No es
  correlativo ni deducible: nadie puede inventarse una boleta válida a partir de
  otra.
- La boleta se marca como usada con un `UPDATE … WHERE estado = 'disponible'` en
  una sola operación. Si dos personas escanean la misma boleta al mismo tiempo en
  puertas distintas, **solo una recibe "ingreso autorizado"**.
- Todos los escaneos quedan registrados, incluidos los códigos falsos.
- Cabeceras `Content-Security-Policy`, `X-Frame-Options` y `nosniff`; nada de
  JavaScript en línea ni librerías traídas de CDN.

Lo que **no** hay, a propósito: no hay registro público de usuarios, ni
recuperación de contraseña por correo, ni roles. Los usuarios se crean desde la
terminal.

---

## Estructura

```
api/index.js      Entrada para Vercel (la misma app, sin listen)
src/app.js        Express, cabeceras, rutas de páginas
src/server.js     Arranque local
src/rutas.js      API: evento, boletas, validación, descargas
src/auth.js       Contraseñas (scrypt), sesiones, límite de intentos
src/db.js         Base de datos: archivo local o Turso
src/codigos.js    Generación y normalización de los códigos
src/pdf.js        Diseño de la boleta en PDF
paginas/          HTML (servido por Express, no es estático)
public/           CSS, JS y jsQR
scripts/usuario.js
```
