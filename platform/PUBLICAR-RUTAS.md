# Publicar enlaces de los negocios

Esta actualización instala `.github/workflows/publicar-sitios.yml`. Publica el sitio principal y rutas completas de negocios habilitados con suscripción vigente. No requiere SQL nuevo ni cambios a funciones Edge: usa la función existente `saas_publish_sites`.

## Configurar una vez en GitHub

1. En EntregaManiobras, Settings → Secrets and variables → Actions, guardar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` como Repository secrets. La segunda es la clave de servicio del proyecto, no una clave aleatoria ni la anon. Nunca colocarla en HTML ni JavaScript público.
2. En Settings → Pages → Build and deployment → Source, seleccionar **GitHub Actions**.
3. Integrar este PR. En Actions → Publicar sitio principal y negocios, abrir la ejecución y esperar a que termine. Para actualizar manualmente, usar Run workflow.

El enlace será `https://krispinbam21.github.io/EntregaManiobras/tacos-mzo/` para el identificador tacos-mzo. El panel muestra el enlace y una alternativa inmediata mediante `store.html?site=tacos-mzo` mientras se publica la carpeta.

Las altas posteriores se incorporan en la ejecución programada cada 15 minutos; GitHub puede retrasar ese horario. No se promete publicación instantánea. El pago debe estar confirmado y la suscripción vigente. El servidor sigue comprobando el estado cuando se abre un catálogo, incluso antes de que se retire una ruta vencida.

El propietario inicia sesión desde el icono de perfil del catálogo. Administración solo se muestra si la cuenta tiene permisos para ese negocio. La página pública no se abre en vista previa ni exige sesión para consultar el catálogo.

Para tener `/tacos-mzo/` directamente en la raíz de github.io, se necesita publicar desde `KrispinBAM21.github.io`; este cambio usa el repositorio actual y no altera otros repositorios.

Validación local: `python platform/tests/publish-routes.py`; prueba de interfaz en móvil y escritorio con API simulada. La publicación real queda pendiente de configurar los secrets, seleccionar GitHub Actions e integrar el PR.
