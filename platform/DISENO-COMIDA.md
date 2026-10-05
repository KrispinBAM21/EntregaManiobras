# Temas, premenú, promociones y fondos por negocio

## Actualizar la instalación existente

1. Con el panel completo de la actualización anterior ya instalado, ejecuta únicamente `platform/supabase/promotions-update.sql` en SQL Editor. Es incremental y puede repetirse sin duplicar promociones. No repitas platform.sql, panel-modules.sql ni business-admin-update.sql si ya los ejecutaste.
2. Actualiza la función Edge existente **saas-platform** con `platform/supabase/functions/saas-platform/index.ts` y despliega conservando sus secrets.
3. Integra esta actualización de EntregaManiobras y espera GitHub Pages. Se aplica automáticamente a todos los negocios que usan `platform/web/store.html?site=SU-IDENTIFICADOR`.
4. Para actualizar también la tienda independiente VentaComida, integra su propuesta de cambios. Usa el mismo backend, por lo que no vuelvas a ejecutar el SQL para esa tienda.

## Configurar desde la propia tienda

Inicia sesión con la cuenta propietaria y abre Administración.

- **Redes y apariencia:** modo inicial, colores, fondos liso/degradado/líneas/imagen, color e imagen para modo predeterminado y oscuro. Las imágenes se adjuntan con el mismo cargador seguro de logos y productos. Se puede añadir una imagen diferente para oscuro; si no, reutiliza la del modo predeterminado. La capa sobre el fondo mantiene legibles los controles.
- **Premenú:** se configura dentro de Redes y apariencia, con título, descripción, imagen opcional y botón Ver menú. Puede desactivarse. El visitante puede volver a Inicio; durante su sesión de navegación conserva el acceso al menú.
- **Promociones:** crea una franja, tarjeta o promoción destacada; adjunta imagen, texto, producto opcional, precio especial opcional, inicio y final. Las fechas se introducen en la zona horaria del dispositivo y se guardan como instantes UTC.
- **Plantillas:** el icono de copiar guarda diseño, texto, imagen y producto/precio para reutilizarlos. Al usar una plantilla se asignan fechas nuevas; no vuelve a publicarse automáticamente. Las plantillas también pueden eliminarse.

La preferencia de tema se guarda por negocio en el navegador, y se aplica al catálogo, bienvenida, promociones, formularios, panel y seguimiento. La exportación de tickets conserva papel blanco para impresión.

## Duración y cálculo

El horario de la promoción se valida en el servidor. Al finalizar, la promoción desaparece del catálogo incluso si la página permanece abierta; al volver desde otra aplicación se revisa su vigencia. Los avisos programados aparecen al comenzar su horario. No se eliminan del panel, para poder reutilizarlos.

Un precio especial se aplica solo al producto de ese negocio durante su vigencia, y debe ser menor al habitual. Si coinciden varias promociones para el mismo producto, se usa el precio menor. Las órdenes nuevas se calculan en el servidor; una orden ya generada conserva su importe aunque después venza la promoción. Los precios que envíe el navegador no se utilizan para cobrar.

Máximo 20 promociones y 20 plantillas guardadas por negocio. Las promociones son de un producto o avisos; esta actualización no incorpora paquetes de varios productos ni cupones. Los cambios que haga el administrador después de abrir una tienda se reciben al recargar; los horarios de las promociones que ya se cargaron se actualizan sin recarga.

Pruebas: Postgres con PGlite para vigencia, precio, aislamiento y validación; TypeScript de Edge; Chromium para tema persistente, todas las ventanas, creación/reutilización de plantillas y desaparición de promociones. Comprobación visual de modos claro y oscuro, y sin desbordamientos a 360/390/1280 px.
