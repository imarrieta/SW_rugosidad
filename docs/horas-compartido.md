# Contador de horas compartido para el grupo

Guía para dejar el contador de horas funcionando para todo el grupo (unas 20 personas), con los datos en común y con Chrome abriéndolo al arrancar.

## Cómo funciona

- La app es una **aplicación web de Google Apps Script** vinculada a una **hoja de Google Sheets**. No hay servidores que mantener ni coste.
- Cada persona entra con **su cuenta de Google de la empresa**. La app sabe quién es, así que no hay usuarios ni contraseñas que gestionar.
- Las horas de todos se guardan en la hoja, en estas pestañas:
  - `Proyectos`: la lista de proyectos.
  - `Registros`: un tramo de trabajo por fila (persona, proyecto, inicio, fin, horas y nota).
  - `Activos`: los cronómetros en marcha.
  - `Config`: los permisos.
- Solo el script toca la hoja. **No compartas la hoja con todo el grupo**: quien pueda editarla podría cambiar las horas de los demás. Basta con que tengan acceso a la aplicación web.

### Permisos (pestaña `Config`)

| clave | valor por defecto | significado |
|---|---|---|
| `admins` | (vacío) | Correos separados por comas. Los administradores ven las horas de todo el grupo (total, por proyecto y por persona), pueden editar y borrar cualquier proyecto y corregir registros de otros. Quien publica el script siempre es administrador. |
| `todosVenGrupo` | `no` | `sí` para que cualquiera vea las horas de todo el grupo. |
| `todosCreanProyectos` | `sí` | `no` para que solo los administradores creen proyectos. Quien crea un proyecto puede editarlo, pero solo un administrador puede borrarlo. |

Cada persona ve y edita siempre sus propias horas, y tiene su propio cronómetro.

## 1. Instalación (una vez, unos 10 minutos)

Hazlo con la cuenta que vaya a ser la propietaria. Mejor una cuenta de equipo (por ejemplo `horas@tuempresa.com`) que una personal: si la propietaria deja la empresa, la app deja de funcionar.

1. En Google Drive crea una hoja de cálculo nueva, por ejemplo «Horas por proyecto».
2. En la hoja, abre **Extensiones → Apps Script**.
3. Copia en el editor los archivos de `dist/apps-script/` (se generan con `npm run build`):
   - **Codigo.gs**: sustituye todo el contenido del archivo `Código.gs` que aparece por defecto.
   - **Horas.gs**: crea un archivo nuevo con **+ → Secuencia de comandos**, llámalo `Horas` y pega el contenido.
   - **Index.html**: crea un archivo con **+ → HTML**, llámalo exactamente `Index` y pega el contenido.
   - **appsscript.json**: en **Configuración del proyecto** (el engranaje), activa «Mostrar el archivo de manifiesto "appsscript.json" en el editor». Después sustituye su contenido. Si vuestra zona horaria no es `Europe/Madrid`, cámbiala.
4. En el editor, elige la función **`instalar`** en el desplegable y pulsa **Ejecutar**. Acepta los permisos que pide Google. Se crean las cuatro pestañas en la hoja.
5. Pulsa **Implementar → Nueva implementación** y elige el tipo **Aplicación web**, con:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario de _tudominio_**
6. Copia la **URL de la aplicación web**. Tiene la forma `https://script.google.com/a/macros/tudominio.com/s/…/exec`. Es la dirección que usará todo el grupo.
7. En la pestaña `Config` de la hoja, escribe en `admins` los correos de quienes deban ver las horas de todos.

Abre la URL para comprobar que funciona. Arriba debe aparecer tu nombre con la marca «administrador».

### Actualizar la app más adelante

Copia los archivos nuevos en el editor y pulsa **Implementar → Gestionar implementaciones**. Edita la implementación existente (lápiz), elige **Versión: nueva versión** e implementa. **La URL no cambia**, así que no hay que tocar Chrome.

## 2. Chrome abre la app al arrancar, en todos los equipos

Lo configura una persona con permisos de administrador en la Consola de Google Admin. La consola cambia de nombres a menudo: si alguna opción no aparece exactamente así, búscala con el buscador de la propia consola.

1. Entra en [admin.google.com](https://admin.google.com) y abre **Dispositivos → Chrome → Configuración → Usuarios y navegadores**.
2. A la izquierda, elige la unidad organizativa o el grupo de las 20 personas.
3. En la sección **Inicio**:
   - **Acción al iniciar**: «Abrir una lista de URLs».
   - **Páginas que se cargan al iniciar**: pega la URL de la aplicación web.
   - Opcional: **Página principal** con la misma URL y **Botón de página principal** visible, para volver a la app con un clic.
4. Guarda.

Para que se aplique, cada persona tiene que tener **iniciada la sesión en Chrome con su cuenta de la empresa**: el perfil de Chrome, no solo Gmail. Además, en la misma sección **Usuarios y navegadores** debe estar activada la gestión de Chrome para los usuarios que inician sesión: «Aplicar todas las políticas de usuario cuando los usuarios inicien sesión en Chrome». Si los navegadores están inscritos en la gestión de navegadores en la nube de Chrome, la política se aplica aunque no haya sesión iniciada.

Para comprobarlo en un equipo:

- Abre `chrome://policy` y pulsa **Volver a cargar políticas**. Deben aparecer `RestoreOnStartup` = 4 y `RestoreOnStartupURLs` con la URL.
- Cierra Chrome del todo y vuelve a abrirlo: debe arrancar en la app.

Sin acceso a la consola de administración, cada persona puede hacerlo a mano en **Configuración → Al abrir el navegador → Abrir una página específica o un conjunto de páginas → Añadir una página nueva**, pegando la URL.

## Uso diario

- Al abrir Chrome aparece la app con tu nombre. Elige el proyecto, escribe opcionalmente en qué estás y pulsa **Iniciar**. El cronómetro sigue contando aunque cierres Chrome o apagues el ordenador, y lo puedes parar desde otro equipo.
- ¿Se te olvidó? Añade el tramo a mano con **+ Añadir** (inicio y fin, o inicio y duración) o corrige uno existente con ✎.
- Los administradores eligen en el resumen **Mis horas / Todo el grupo / una persona**. En el grupo se ven los totales por proyecto y por persona. **Exportar CSV** descarga lo que se esté viendo y **Abrir hoja de datos** da acceso a todo para tablas dinámicas.
- La app recoge los cambios de los demás al volver a la pestaña y cada 2 minutos.

## Límites a tener en cuenta

- Cada acción tarda entre medio segundo y un segundo en guardarse en la hoja, aunque en pantalla se ve al momento. Si algo falla, aparece un aviso y se recargan los datos.
- Cada vez que abre la app, una persona descarga sus propios registros; un administrador descarga los de todo el grupo. Con 20 personas son unas 25 000 filas al año, y la carga sigue siendo de pocos segundos. Si pasados unos años va lenta, se pueden archivar los años antiguos en otra hoja.
