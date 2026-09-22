# WallaRep

Herramienta web, no oficial y sin afiliación con Wallapop, para consultar
datos públicos de reputación de un vendedor a partir del enlace a uno de sus
anuncios — incluido el número de **denuncias recibidas** (`reports_received`),
un dato que la propia API pública de Wallapop expone pero que su app no
muestra en pantalla.

La herramienta no opina sobre si un vendedor es fiable o no: solo muestra los
números tal cual los devuelve Wallapop.

## Cómo funciona

1. El usuario pega el enlace de un anuncio (`https://es.wallapop.com/item/...`).
2. `functions/api/resolve.js` (una función serverless de Cloudflare Pages)
   pide esa página a Wallapop **desde el servidor** y extrae únicamente el ID
   público del vendedor del JSON que la propia página incrusta
   (`__NEXT_DATA__`). Este paso es necesario porque esa página HTML no tiene
   cabeceras CORS, así que el navegador no puede leerla directamente. La
   función no guarda ni registra nada: es un simple pasamanos sin estado.
3. Con ese ID, el navegador del usuario llama **directamente** a la API
   pública de Wallapop (`api.wallapop.com`, que sí permite peticiones
   cross-origin) para pedir el perfil y las estadísticas del vendedor, y
   pinta el resultado. Nuestro servidor no interviene en este paso ni ve
   estos datos.

No hay base de datos, ni analítica, ni registro de qué anuncios o vendedores
se consultan.

## Aviso legal / de riesgo

- Wallapop no documenta ni da soporte a esta API; puede cambiar, dejar de
  funcionar o bloquear el dominio de esta herramienta en cualquier momento.
- No se bordea ninguna medida de seguridad: no hay login, CAPTCHA ni límite
  de peticiones que se evada. Los datos usados son los que la propia página
  del anuncio ya envía a cualquier visitante.
- Usar una API no documentada de un tercero probablemente incumple sus
  términos de servicio, aunque no implique acceso no autorizado en el
  sentido penal. Es un riesgo civil/contractual (bloqueo, cese y desista),
  no penal, pero no hay garantías.
- Los datos mostrados (nombre, foto, valoraciones, denuncias recibidas...)
  son datos personales de terceros. Por eso la herramienta no los almacena
  ni registra en ningún momento.
- No es una herramienta oficial de Wallapop ni tiene relación con Wallapop
  S.L.

## Desarrollo local

Necesitas [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npx wrangler pages dev .
```

Esto sirve el sitio estático y la función `/api/resolve` juntos en local.

## Despliegue en Cloudflare Pages

1. Sube este proyecto a un repositorio de GitHub.
2. En el panel de Cloudflare, crea un proyecto de **Pages** conectado a ese
   repositorio. No hace falta comando de build ni directorio de salida
   especial (es un sitio estático en la raíz).
3. En **Custom domains** del proyecto de Pages, añade el subdominio que
   quieras (por ejemplo `wallarep.dkns.dev`). Si `dkns.dev` ya usa Cloudflare
   como DNS, Cloudflare añade el registro automáticamente.
4. Cada nuevo `git push` despliega una nueva versión.
