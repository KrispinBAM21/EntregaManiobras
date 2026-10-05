# Actualizar paneles por negocio

Esta actualización se instala sobre la plataforma existente. No vuelvas a ejecutar platform.sql ni schedule-notifications.sql.

1. En Supabase SQL Editor ejecuta únicamente `platform/supabase/panel-modules.sql`. Añade el almacenamiento de imágenes, la configuración compartida del mapa y las acciones privadas del panel; conserva negocios y pedidos.
2. Reemplaza el código de la función Edge existente **saas-platform** con `platform/supabase/functions/saas-platform/index.ts` y despliega. Mantén la configuración de JWT anterior: la función verifica sesiones internamente, con JWT del gateway desactivado para las acciones públicas. No crees otra función y no cambies gmail-oauth ni telegram-webhook.
3. Integra los cambios del PR en GitHub para actualizar los archivos de `platform/web/`. Conserva tu `config.js` actual con URL y clave pública de Supabase.
4. Abre `/EntregaManiobras/platform/web/panel.html`. En cada negocio pulsa el engranaje: aparecen Negocio, Productos, Pedidos y entregas, Pagos, Tickets, Redes y apariencia. El propietario ve únicamente sus negocios; el administrador de la plataforma puede revisar los clientes.
5. Como administrador configura **Mapa predeterminado de la plataforma**. Cada negocio usa ese mapa o activa su configuración propia en Negocio. Se admiten tiles HTTPS y claves públicas para navegador. La tarifa de entrega utiliza distancia lineal; configura cargo base, precio por km y cobertura en Pedidos y entregas.
6. El propietario vincula y prueba su banca/correo desde su propia sesión en el lector existente. Luego publica hasta tres cuentas, beneficiario y visibilidad en Pagos. El plan del lector bancario se conserva separado del plan del sitio. La aprobación manual de pagos sigue disponible en cada negocio y para suscripciones en el panel central.
7. Utiliza el icono del ojo para la vista previa privada. Requiere sesión y deshabilita compras. El administrador puede revisar sitios pendientes o vencidos. En Tickets puedes abrir un comprobante de ejemplo y descargarlo; no crea una orden real.

## Imágenes y límites

Logo, fotografía del producto e imagen adicional del ticket se adjuntan desde el panel. Se aceptan JPEG, PNG y WebP en navegador; se optimizan y se vuelven a decodificar/codificar en el servidor como JPEG o PNG. Máximo final 5 MB por archivo, 100 archivos o 50 MB por negocio. Storage publica imágenes comerciales; no uses estos campos para documentos privados. Sustituir una imagen conserva el archivo anterior; si alcanzas el límite, revisa los archivos del negocio en Storage antes de eliminar los que ya no se utilizan.

## Pruebas

`npm ci --prefix platform`, `npm test --prefix platform`, `npm run check --prefix platform`.
La prueba de interfaz necesita Playwright y Chromium: `PLAYWRIGHT_MODULE=<ruta-playwright> BROWSER_EXECUTABLE=<ruta-chromium> node platform/tests/ui.cjs`.

La plantilla central se abre como `store.html?site=<slug>`. Si utilizas una copia en otro repositorio como VentaComida, sincroniza allí store.js, sdk.js, platform.css y las dependencias del store.html, o usa un enlace a la plantilla central para compartir futuras actualizaciones.
