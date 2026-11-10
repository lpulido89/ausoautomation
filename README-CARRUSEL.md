# AUSO — carrusel editable

El módulo ya está integrado entre el hero y OUR SERVICES. La galería se oculta cuando no hay fotos activas. En /admin/ se pueden subir hasta 24 fotos JPG, PNG o WebP de hasta 8 MB, editar textos, ordenar, desactivar y eliminar. El portal de clientes queda fuera de esta entrega.

## Preparar la vista previa en Cloudflare Pages

1. Usar el repositorio actual de AUSO. La compilación es npm run build y el directorio de salida es dist. Pages debe compilar desde la raíz para incluir functions/. Comprobar que dist/_routes.json quedó en el build.
2. En R2, usar un bucket Standard privado para la galería. En el proyecto de Pages, vincularlo como AUSO_MEDIA. Para Preview usar un bucket de pruebas distinto al de producción. No habilitar la URL pública de R2. No se necesita D1.
3. En Pages, configurar CF_ACCESS_TEAM_DOMAIN (https://<equipo>.cloudflareaccess.com) y CF_ACCESS_AUD (audiencia de la aplicación Access que protege el host probado). No guardar tokens en Git. La cuenta de administración debe coincidir con la política existente.
4. Conservar la aplicación Access ya configurada para /admin, /admin/*, /api/admin y /api/admin/* del dominio principal. Las aplicaciones Access se aplican por host: si la vista previa usa otro host, verificar su protección y su audiencia antes de usarla. Las Functions también verifican el JWT en panel y API, por lo que rechazan peticiones si falta la configuración o la identidad no coincide.
5. En el entorno de prueba, iniciar sesión como administrador, subir dos fotos de prueba, invertir el orden, editar un título, desactivar una foto y eliminar la otra. Comprobar que el sitio público refleja cada cambio sin recompilar. Probar en incógnito que no se puede acceder al panel ni a la API administrativa, incluyendo el dominio pages.dev si está habilitado. Confirmar que una URL pública de foto desactivada devuelve 404.
6. Pasar a producción después de verificar el entorno anterior. Usar las variables y el bucket de producción, y subir solo fotografías autorizadas para aparecer públicamente.

El manifiesto y las imágenes viven en R2. El panel comprueba la versión del manifiesto antes de guardar y avisa si otra sesión modificó la galería. Las fotos inactivas conservan una miniatura autenticada. No mezclar este bucket con archivos privados de clientes.

## Verificación local

- node --test tests/carousel.test.mjs comprueba la API con un bucket en memoria y JWT de prueba.
- npm run build comprueba la compilación de Astro; el servidor de Astro por sí solo no ejecuta Pages Functions.
- La conexión y el inicio de sesión reales se verifican en Cloudflare Preview después de configurar el binding y las variables.

Documentación: https://developers.cloudflare.com/pages/functions/bindings/ y https://developers.cloudflare.com/pages/functions/routing/
