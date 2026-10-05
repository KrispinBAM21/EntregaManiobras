# Panel de administración por negocio

Esta actualización amplía el panel de cada negocio creado con la plantilla de comida. Se abre desde el icono de cuenta o el acceso de administración de su propia tienda; también está disponible en la plataforma. Al crear otros sitios con la misma plantilla no es necesario copiar sus módulos uno por uno.

## Instalación sobre la versión existente

1. Ejecuta una vez `platform/supabase/business-admin-update.sql` en el SQL Editor de tu proyecto. Requiere que `platform.sql` y `panel-modules.sql` ya estén instalados. No vuelvas a ejecutar esos archivos anteriores.
2. Sustituye el código de la función Edge existente **saas-platform** por `platform/supabase/functions/saas-platform/index.ts` y despliega. Conserva los secrets y la configuración de autenticación existentes. No crees otra función.
3. Integra esta actualización en main y espera a que termine el despliegue de GitHub Pages. Recarga la tienda e inicia sesión con la cuenta propietaria.

## Módulos

Negocio, Productos, Calculadora de viajes, Pedidos con mapa y seguimiento, Revisión de pagos, Comprobantes de pedidos, Auditoría, Viajes realizados, Usuarios y permisos, Comisiones y liquidaciones, Clientes y bloqueos por teléfono, Pagos, Tickets, Redes y apariencia, Seguridad de mi cuenta.

El propietario dispone de todos los módulos de su negocio. El personal recibe únicamente los permisos asignados: productos, pedidos y entregas, revisión de pagos, configuración o reportes. Debe crear y confirmar previamente su cuenta en la plataforma; el propietario lo agrega mediante su correo. Las operaciones se comprueban en el servidor y los datos permanecen separados por sitio.

El módulo **Bot de transferencias** y las opciones para vincular banca y correo se muestran únicamente si el propietario tiene acceso activo al bot. Se utiliza la vinculación existente en `gmail-conexion.html`; no se comparten las credenciales con empleados ni con otros negocios. Sin bot se pueden guardar hasta tres cuentas manuales y aprobar los pagos desde Revisión de pagos. La revisión automática necesita una cuenta vinculada y un lector de movimientos operativo.

La comisión es el porcentaje del traslado que conserva el negocio. El importe del repartidor se fija al aceptar el viaje; los productos no forman parte de su comisión. Los viajes históricos sin importe de comisión guardado no se recalculan automáticamente.

## Comprobación

- Abre tu tienda con sesión propietaria: aparece el panel completo.
- Sin suscripción al bot: el módulo Bot está oculto y las cuentas manuales funcionan.
- Con suscripción al bot: aparece el módulo y se habilita la vinculación de bancos.
- Asigna solo Productos a otra cuenta: no puede consultar pedidos ni cambiar la configuración.
- Confirma el pago de un pedido, acepta su viaje, finalízalo y registra su liquidación.

Los reportes muestran los últimos 200 pedidos o eventos. Comprobantes corresponde a tickets de pedidos, no a un nuevo sistema de carga de comprobantes bancarios. Los bloqueos de esta plantilla son por teléfono dentro de cada negocio. La tarifa de entrega utiliza distancia lineal desde el negocio; el GPS se usa para elegir el punto, sin un requisito nuevo de proximidad para finalizar. Los módulos globales de suscripciones y administración de la plataforma permanecen reservados al creador.

Validación local: pruebas de Postgres con PGlite, tipos de la función Edge y pruebas de interfaz en Chromium a 360, 390 y 1280 píxeles. Estas pruebas no sustituyen una transferencia real ni despliegan cambios en Supabase.
