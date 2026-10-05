# Bot de transferencias y sitios de negocio por suscripción

Extensión de EntregaManiobras. No crea otro bot ni otro proyecto Supabase. Usa Auth, el registro de Telegram, las bancas del creador, el lector Gmail y el worker de pagos existentes. No reemplaza las tablas generales `products` u `orders` con las de los negocios.

## Qué contiene

- Panel público `platform/web/panel.html`: iniciar sesión, crear cuenta, Google, contratar/renovar el bot, reservar un identificador y contratar un sitio.
- Módulo en el panel original: **Sitios y suscripciones**; enlace público para clientes con o sin sesión.
- Creador: precios BOT/WEB en MXN, facturas, pagos pendientes/confirmados/denegados/falsos, suscriptores activos/vencidos/desactivados, renovaciones, bancas usadas y acceso de cada sitio.
- Referencia numérica antes de transferir. El identificador visual se distingue como BOT-1001234 o WEB-1001235. En la transferencia se copia solo el número.
- Un plan BOT por cuenta; las renovaciones extienden 30 días desde la vigencia actual o desde ahora si venció. Un plan WEB independiente por sitio. El dueño decide si contrata ambos; WEB por sí solo no incluye lectura bancaria automatizada.
- Configuración de bancos/correos por web. El mismo UUID de Auth tiene la suscripción en el sitio y en Telegram una vez vinculado. Quien aún no vinculó Telegram conserva su registro web y los avisos quedan en espera.
- Plantilla de comida basada en el catálogo adjunto: biblioteca SVG de alimentos y bebidas, productos, stock, marca, logo, redes, WhatsApp, pin del negocio, recogida/entrega, carrito persistente, referencias, ticket PDF/JPEG, historial y seguimiento.
- Separación de productos, pedidos y configuración por negocio. Precios/stock/cobertura calculados en servidor, no con los importes del navegador.
- SDK para conectar otros sitios a la API central sin entregarles secretos del servidor.
- Publicador de rutas por GitHub Actions; no cobra ni activa suscripciones por sí mismo.

## Instalación en orden

1. Conserva una copia del index actual. Integra el PR de EntregaManiobras cuando estés listo. Sus archivos nuevos están en `platform/`; el cambio al index solo añade un script externo local y conserva el JavaScript original, su CSP y su hash. **No uses el HTML antiguo adjunto como reemplazo del sitio original.**
2. En Supabase → SQL Editor ejecuta **solo `platform/supabase/platform.sql` una vez**. Requiere las migraciones previas de Auth, Gmail, referencias, suscripciones y control de acceso que ya instalaste. No ejecutes otra vez los SQL antiguos.
3. En Supabase → Edge Functions crea únicamente **`saas-platform`**, con el contenido de `platform/supabase/functions/saas-platform/index.ts`. Desactiva Verify JWT para esta nueva función: valida las sesiones dentro del código y admite pedidos públicos y el worker con secreto propio.
4. Reemplaza el código de **`gmail-oauth`** con `platform/supabase/gmail-oauth-index.ts`. Esto permite al suscriptor validar los pedidos de su propio negocio; el servidor conserva la identidad y las pruebas bancarias.
5. Reemplaza el código de tu función existente **`telegram-webhook`** con `platform/supabase/telegram-webhook-index.ts`. No renombres la función ni registres otro webhook. Conserva sus secretos actuales. Los miembros de la plataforma se redirigen al panel para configurar banca/correos; el creador conserva su administrador y los usuarios anteriores independientes conservan su flujo.
6. Secrets de Edge: conserva `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, claves de cifrado y secretos anteriores. `ALLOWED_ORIGINS` debe incluir `https://krispinbam21.github.io`, sin la ruta del repositorio. Para otro dominio añade su origen exacto separado por comas. Nunca subas service_role, contraseña de aplicación, token Telegram o claves de cifrado a GitHub.
7. En Auth → URL Configuration añade la URL de `platform/web/panel.html` a Redirect URLs para Google y confirmación por correo.
8. Abre `https://krispinbam21.github.io/EntregaManiobras/platform/web/panel.html` con tu cuenta administradora. Verifica precios y bancas vinculadas/publicadas del negocio original. Publica al menos una banca de transferencia antes de probar una suscripción.

El `config.js` incluido usa únicamente la URL y clave pública tomadas del index actual de GitHub. Si cambias de proyecto, ejecuta en Codespaces: `python3 platform/scripts/prepare.py --original index.html --out platform/web`. No modifica el HTML ni copia secretos.

## Avisos automáticos a Telegram

La base registra inmediatamente la activación y su aviso. El envío a Telegram usa una cola con reintentos; la vigencia no depende de que Telegram responda.

1. Genera un secreto aleatorio de 32 bytes, por ejemplo `openssl rand -hex 32` en Codespaces.
2. En Supabase → Edge Functions → Secrets guarda ese valor como `PLATFORM_WORKER_SECRET`.
3. En el mismo proyecto → Database → Vault guarda **el mismo valor** con nombre `platform_worker_secret` y la URL del proyecto con nombre `platform_supabase_url`. Vault corresponde a secretos de la base de datos; no es `index.html` ni un archivo de GitHub. Si tu dashboard no muestra Vault, usa sus funciones SQL desde SQL Editor con tus valores reales de manera privada.
4. Con las extensiones `pg_cron` y `pg_net` ya habilitadas, ejecuta solo `platform/supabase/schedule-notifications.sql` una vez. Envía la cola cada minuto. No modifica el cron anterior del lector Gmail.
5. Desde el panel del cliente pulsa **Vincular Telegram** y envía `/vincular CODIGO` al bot. Usa la cuenta web que pagó. El usuario verá su suscripción y el creador recibirá el aviso de quién pagó. Los avisos pendientes se enviarán al vincularse.

## Rutas /nombre-del-negocio/

Un repositorio de proyecto tiene prefijo propio. `github.com/KrispinBAM21/VentaComida` es el repositorio, mientras su dirección pública es `https://krispinbam21.github.io/VentaComida/`.

- Disponibilidad inmediata, sin generar archivos: `.../EntregaManiobras/platform/web/store.html?site=tacos-mzo` después de confirmar WEB y configurar el catálogo.
- Publicador dentro de EntregaManiobras: genera `.../EntregaManiobras/tacos-mzo/`.
- Para exactamente `https://krispinbam21.github.io/tacos-mzo/`, crea/configura el repositorio de usuario **KrispinBAM21/krispinbam21.github.io**, que no estuvo accesible durante esta preparación. Copia allí `platform/web` y `platform/scripts`. El mismo publicador creará cada carpeta en su raíz. Mantén `PLATFORM_CONFIG.base` apuntando a EntregaManiobras, donde está el panel central.
- Para un dominio propio configura Pages en ese repositorio raíz; las carpetas funcionarán como `https://tu-dominio/tacos-mzo/`.

Copia `platform/workflows/publicar-sitios.yml` a `.github/workflows/publicar-sitios.yml` del repositorio de publicación. Configura en **Settings → Secrets and variables → Actions** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Son secretos del workflow, no archivos públicos. Habilita permisos de escritura del workflow y Pages desde la rama elegida. Ejecuta **Actions → Publicar sitios por suscripcion → Run workflow** para la primera publicación; después corre cada 15 minutos, sujeto al calendario de GitHub. Puede haber demora de Pages. Si usas Pages mediante Actions en vez de publicación de rama, integra el paso de construcción en tu workflow de Pages.

Solo se publica un identificador después de pagar WEB. Los identificadores son únicos, minúsculas/números/guiones, 3–40 caracteres; las rutas del sistema están reservadas. No se sobreescriben carpetas ajenas. Al vencer o desactivar el sitio, aunque sus archivos sigan alojados, la API bloquea catálogo, compras y edición. El ticket de un pedido ya creado sigue disponible con su código privado.

## Configuración de cada negocio

1. Suscriptor: pagar BOT si usará validación automática; desde el panel abrir **Configurar banca y Gmail en la web**.
2. Registrar el espacio bancario, conectar Gmail por OAuth o contraseña de aplicación con el formulario existente y probarlo.
3. Crear el sitio y pagar WEB. Entrar a Configurar negocio: nombre, logo HTTPS, WhatsApp, domicilio, pin de mapa, costos y redes.
4. Registrar hasta tres bancas; su nombre y últimos dígitos deben coincidir con la conexión del mismo dueño. Mostrar/ocultar; dejar vacía la cuenta la elimina de los métodos públicos. Nunca se solicita contraseña bancaria.
5. Añadir productos con sus precios y existencias. Ocultar productos mediante el icono de visibilidad.
6. Los pedidos sin pago reservan existencias por una hora; al consultar el catálogo o crear un pedido se liberan las reservas vencidas. Los marcados denegados/falsos también liberan stock una sola vez. Los tickets históricos se conservan.

El cargo de entrega se calcula por **distancia lineal** desde el pin del negocio, con base y tarifa por km en centavos. No representa una ruta de calles. El lector reconoce actualmente **Hey Banco**; mostrar otro banco no implica que ya exista un parser verificado para él.

La lectura y cifrado Gmail no se duplican: usa el lector original actualizado. Su worker anterior debe seguir activo para validar sin pulsar Consultar. Un correo de importe igual sin referencia nunca se aprueba automáticamente. Queda pendiente para verificarlo manualmente. Las aprobaciones manuales exigen motivo y quedan auditadas.

## Conectar otro sitio existente

Incluye `config.js` y `sdk.js` en el sitio nuevo. No necesita otro bot. Configura su negocio en el panel central y añade su origen HTTPS a `ALLOWED_ORIGINS`. No pongas el token de Telegram ni service_role en ese sitio.

```js
const access_token = crypto.randomUUID(); // guardar con el borrador, mantener al reintentar
const order = await Platform.call('order', {
  slug: 'tacos-mzo', access_token,
  customer: { name: 'Nombre del cliente', phone: '3141234567' },
  delivery: { type: 'pickup', address: '' },
  items: [{ id: 'UUID-DEL-PRODUCTO-DE-ESE-NEGOCIO', qty: 2 }],
  bank_id: 'bank-0'
});
// Ahora muestra order.bank, order.reference y order.total. TODAVÍA no ha transferido.
const status = await Platform.call('order_status', { id: order.id, access_token });
```

Los precios del sitio externo deben estar registrados en el catálogo del negocio central. La API no acepta que el navegador imponga un monto arbitrario. El token del pedido autoriza solamente su seguimiento; consérvalo privado. Las operaciones del vendedor requieren un JWT real y pertenencia al sitio.

## Comprobaciones realizadas y pendientes

Probado localmente con PostgreSQL embebido: permisos de schema/RPC, aislamiento entre dueños, factura reutilizable pendiente, aprobación solo por creador, suscripciones por 30 días, rechazo de prueba bancaria no autenticada/cuenta incorrecta, rechazo de movimiento duplicado, cálculo desde productos de servidor, costo de entrega cero, recuperación de pedido por token, stock idempotente, transiciones y bloqueo de sitio.

También se probó la interfaz en Chromium a 360, 390 y 1280 px: conservación del borrador al recargar, referencia visible antes de transferir, recuperación del ticket, panel y ventanas sin desbordamiento. Se descargó un PDF real de prueba y se comprobó que tiene una página completa.

La conexión bancaria, envío real de Telegram, cron, Google y despliegue deben verificarse en tu proyecto después de instalar. La preparación no aplica SQL ni modifica Secrets automáticamente.

Prueba de aceptación: crear cuenta → BOT → guardar referencia antes de pagar → transferencia con referencia/importe exactos → confirmación → vincular Telegram → Gmail desde web → WEB → crear productos → pedido → transferencia → seguimiento → ticket → entrega. Repetir con otra cuenta para confirmar separación de datos.
