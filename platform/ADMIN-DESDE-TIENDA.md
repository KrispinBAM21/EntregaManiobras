# Administración desde la tienda

La cabecera de `platform/web/store.html` incluye un icono de cuenta y un engrane. El icono de cuenta abre una ventana de inicio de sesión mediante correo/contraseña o Google. Se utiliza la cuenta propietaria ya existente.

El engrane aparece solamente si el servidor devuelve el negocio actual entre los sitios accesibles para la sesión. Abre los seis módulos existentes dentro de la tienda. Una cuenta sin acceso puede iniciar sesión, pero no obtiene permisos de administración. Las operaciones siguen verificando sesión y propiedad en `saas-platform`.

El enlace inferior Administración del negocio también abre esta ventana, sin redirigir al panel general. Después de guardar cambios y cerrar el editor, la tienda se recarga para reflejarlos; el carrito se conserva en su almacenamiento existente.

## Publicar

Fusionar el PR y esperar el despliegue de GitHub Pages. No repetir SQL ni reemplazar funciones Edge. Abrir `platform/web/store.html?site=venta-comida` y recargar sin caché.

Para Google, la URL de la tienda debe estar permitida en los Redirect URLs existentes de Supabase Auth. El acceso por correo y contraseña no requiere esta redirección.

Este cambio afecta la tienda central de EntregaManiobras. Una copia independiente en otro repositorio requiere sincronizar sus archivos y ajustar rutas.
