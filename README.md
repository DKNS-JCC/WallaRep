# WallaRep

Herramienta web no oficial para consultar la reputación pública de un vendedor
de Wallapop a partir del enlace de uno de sus anuncios o de su perfil.

Muestra, por este orden:

1. **Reportes recibidos** (`reports_received`), comparados con vendedores de
   actividad parecida. Es el motivo de la herramienta: la API pública de
   Wallapop lo devuelve, pero la app no lo enseña.
2. Valoración media, ventas, compras y anuncios en venta.
3. Reseñas de 3 estrellas o menos con su comentario, fecha y artículo (la app
   de Wallapop no permite filtrarlas). Se leen hasta las 400 más recientes.
4. Reparto de todas las reseñas por estrellas y la lista completa.

### Qué es `reports_received`

Comprobado a mano con dos cuentas (septiembre de 2026):

- Suma 1 cuando alguien reporta **uno de sus anuncios** y también cuando
  alguien usa **«Reportar usuario»** desde el chat.
- Suma al instante, sin revisión de Wallapop, y no se sabe el motivo.
- Cada persona que reporta al usuario solo suma una vez.

Por eso el número suelto no dice mucho: en una muestra de 9.407 vendedores
(septiembre de 2026), el 51 % tenía al menos un reporte, el 10 % tenía más de
12, y el número crece con las ventas y es unas 3 veces mayor en profesionales.

### Cómo se decide si es «normal»

`scripts/build-peers.mjs` toma una muestra de vendedores reales y ajusta una
regresión lineal de `log(1 + reportes)` sobre `log(1 + ventas)`,
`log(1 + reseñas)`, si es profesional y los años de antigüedad. Las compras y
los anuncios activos se probaron y no aportan nada una vez están las ventas.
Guarda en `peers.json` solo los coeficientes y los percentiles de los
residuos, separados en tres niveles de actividad (la dispersión cambia con el
volumen).

Con eso la app calcula, para el vendedor consultado:

- lo típico para su perfil (la mediana de vendedores parecidos);
- qué porcentaje de vendedores parecidos tiene menos reportes que él;
- un veredicto: por debajo (percentil < 25), normal, por encima
  (percentil > 75) o muy por encima (percentil > 90). Solo se sale de
  «normal» si además la diferencia con lo típico es de 3 reportes o más: con
  pocos reportes el percentil se mueve mucho (1 reporte puede superar al 75 %
  cuando casi todos tienen 0) y no significa nada.

Es una estimación: la muestra sale de búsquedas públicas y el modelo explica
en torno a la mitad de la variación. El script separa un 20 % de la muestra
para comprobar que los percentiles están bien calibrados fuera de los datos
de ajuste.

```bash
node scripts/build-peers.mjs           # nueva muestra y ajuste
node scripts/build-peers.mjs --refit   # reajustar con la muestra guardada
node scripts/build-peers.mjs --extend  # añadir más profesionales a la muestra
```

Acepta el enlace tal cual, sin `https://`, o el texto completo que copia el
botón «Compartir» de la app. La URL de la página (`?url=...`) se puede
compartir para abrir directamente una consulta.

## Cómo funciona

1. `functions/api/resolve.js` (función de Cloudflare Pages) descarga la página
   del anuncio o del perfil y saca el ID del vendedor del JSON
   `__NEXT_DATA__`. Hace falta un servidor porque esa página no tiene
   cabeceras CORS. Solo acepta rutas `/item/` y `/user/` de `wallapop.com`
   y reconstruye la URL con host fijo, así que no sirve de proxy abierto.
2. Con ese ID, el navegador pide perfil, estadísticas y reseñas directamente a
   `api.wallapop.com`, que sí permite CORS. Nuestro servidor no ve esos datos.

No hay base de datos, ni analítica, ni registro de consultas.

## Avisos

- Usa una API no documentada de Wallapop: puede cambiar o dejar de
  funcionar sin aviso. Si Wallapop cambia su web, la función devuelve un
  error explícito («Wallapop ha cambiado su web…»).
- Usar una API no documentada probablemente incumple los términos de
  servicio de Wallapop.
- Los datos mostrados son datos personales de terceros; no se almacenan.
- No tiene relación con Wallapop S.L.

## Desarrollo local

```bash
npx wrangler pages dev .
```

Sirve el sitio estático y `/api/resolve` en `http://localhost:8788`.

## Despliegue en Cloudflare Pages

1. Crea un proyecto de **Pages** conectado a este repositorio, sin comando
   de build y con la raíz como directorio de salida.
2. Añade el dominio en **Custom domains** (p. ej. `wallarep.dkns.dev`).
3. Cada `git push` despliega una versión nueva.
