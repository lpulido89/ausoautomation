# Portal de descargas de AUSO

El administrador abre **Materiales de cursos** desde `/admin/`. Ahí puede crear cursos, subir archivos de hasta 50 MB y dar o quitar acceso por correo. El cliente abre `/portal/` y ve solo sus cursos. La API verifica la identidad firmada de Cloudflare y comprueba la asignación también para cada descarga directa.

## Activar solo en Preview

1. Crear una base D1 de pruebas (por ejemplo, `auso-portal-preview`). Aplicar una vez el SQL de `migrations/portal/0001_initial.sql` a esa base. En **Pages → Settings → Preview → Bindings** agregar la base como `PORTAL_DB`.
2. Crear un bucket R2 Standard privado distinto al de las fotos (por ejemplo, `auso-downloads-preview`). En **Preview → Bindings**, agregarlo como `AUSO_DOWNLOADS`. No habilitar el acceso público ni configurar un dominio para el bucket.
3. Conservar las variables y la aplicación Access existentes de Preview. Para ensayar el portal con cuentas de prueba, permitir esas cuentas en la aplicación de la vista previa; la validación del panel de administración sigue limitada al administrador. Usar correos que puedan iniciar sesión y archivos de prueba sin datos privados.
4. Volver a desplegar la rama de pruebas. Entrar a `/admin/materiales/`, crear dos cursos, subir un archivo a cada uno y asignar un curso diferente a cada correo. Abrir `/portal/` con cada cuenta, comprobar que solo aparezca su curso y que el enlace del otro curso devuelva 404. Verificar que retirar acceso también invalida el enlace.

## Antes de publicar

Usar una base y un bucket privados de producción separados de los de Preview. Configurar una aplicación Access para `/portal`, `/portal/*` y `/api/portal/*` del dominio público, con el método de inicio de sesión por correo y una política adecuada para clientes. Guardar su audiencia como `CF_PORTAL_ACCESS_AUD` en Production, junto con el dominio del equipo en `CF_ACCESS_TEAM_DOMAIN`. Mantener la aplicación administrativa separada, con su audiencia en `CF_ACCESS_AUD`. Comprobar los accesos en producción antes de cargar archivos reales.

Prueba local: `node --test tests/carousel.test.mjs tests/portal.test.mjs`. Usa SQLite en memoria y un almacenamiento simulado; no reemplaza la verificación en Cloudflare Preview.
