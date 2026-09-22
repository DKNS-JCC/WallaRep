# WallaRep

Herramienta web no oficial para consultar la reputación pública de un vendedor
de Wallapop a partir del enlace de uno de sus anuncios o de su perfil.

Muestra:

- **Denuncias recibidas** (`reports_received`): la API pública de Wallapop lo
  devuelve, pero la app no lo enseña.
- Valoración media, ventas, compras y anuncios en venta.
- Reparto de reseñas por estrellas y, aparte, las reseñas de 3 estrellas o
  menos con su comentario. Se leen hasta las 400 más recientes.

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
