# Configurar el login

La interfaz y sus mensajes se muestran en español por decisión del usuario.

## Mantener sesión iniciada

El formulario incluye una casilla desmarcada por defecto. Al marcarla, el token se
guarda en SecureStore/localStorage y se restaura mientras el servidor lo acepte
(hasta 7 días). Al dejarla desmarcada se eliminan sesiones guardadas anteriores y
en móvil el nuevo token existe únicamente en la memoria del proveedor de sesión.
En web, ambos modos comparten un registro en localStorage entre pestañas del
mismo origen/navegador. Sin marcar la casilla, el registro tiene un plazo local
FIJO de 30 minutos desde el login; recargar, validar o abrir otra pestaña no lo
renueva. Al marcarla no hay ese plazo adicional: se aplica el vencimiento de
Supabase de hasta 7 días. El plazo web se controla con el reloj del cliente;
no cambia ni acorta la validez del token en el servidor.
Al cerrar la última pestaña el registro permanece hasta vencer o cerrar sesión.
Los eventos storage y focus sincronizan cambios de cuenta y cierre de sesión.
La app comprueba el token en almacenamiento antes de aceptar una validación
pendiente, para evitar recuperar una cuenta que otra pestaña acaba de cerrar.
Volver del segundo plano conserva una sesión móvil temporal si el proceso sigue
vivo; terminar el proceso o reiniciar Expo requiere nuevas credenciales.
Al vencer el plazo local, un temporizador retira el acceso de las pestañas
abiertas. Al volver de una pestaña suspendida se comprueba también el plazo.
Cerrar sesión o recibir 401 al validar elimina el token compartido. Los antiguos
tokens persistentes se migran al formato compartido; los antiguos temporales de
sessionStorage se descartan (ingresa una vez nuevamente para usar el nuevo modo).
Perder el token local no revoca el registro remoto: vence con su plazo habitual.
Cerrar sesión explícitamente sigue revocándolo y limpiando el almacenamiento.
La huella solo se puede activar para sesiones persistentes; se comprueba tanto
en la interfaz como en el proveedor. Las sesiones ya guardadas antes de este
cambio siguen restaurándose; para pasar al modo temporal se debe iniciar sesión
nuevamente con la casilla desmarcada. No se modifican SQL ni Edge Functions.

## Desbloqueo opcional con huella (solo móvil)

Tras entrar con contraseña, Inicio ofrece «Activar desbloqueo con huella» si el
celular tiene lector, huella registrada y soporte de SecureStore autenticado.
La activación mueve el token a una clave con requireAuthentication y elimina
la copia sin protección biométrica. No se guardan contraseñas ni huellas.
Al iniciar/reanudar la app se bloquea el portal. Solo el botón «Desbloquear con
huella» abre el diálogo nativo y después valida la sesión existente en Supabase.
La restauración periódica no abre diálogos ni permite omitir el bloqueo.

Siempre se puede ingresar ID/correo y contraseña. Esto crea una sesión nueva y
reinicia la preferencia biométrica; puede activarse de nuevo en Inicio. No se
requiere la huella anterior para cambiar de cuenta. Desactivar la opción en Inicio
restaura el comportamiento de sesión persistente normal. Cerrar sesión revoca el
token y elimina su copia local y preferencia. La caducidad sigue siendo de 7 días.

El sistema operativo puede aceptar otras biometrías fuertes del dispositivo y
cualquier huella registrada; la app no identifica un dedo ni lo vincula al AS608.
Web conserva contraseña y sesión actuales. Algunas funciones biométricas de
SecureStore no funcionan en Expo Go; usar compilación propia si se indica que
no hay soporte. Nunca se degrada a guardar el token sin protección al activar.

Prueba pendiente en teléfono real: activar, mandar app a segundo plano, cancelar
el diálogo, desbloquear, usar contraseña, desactivar y cerrar sesión. Cambios en
las huellas registradas pueden invalidar la clave; se recupera con contraseña.
La validación del token requiere internet. No hay cambios SQL ni Edge Functions.

## Pantalla principal por rol

La navegación usa Expo Router desde `index.js`; las rutas viven en `src/app/`.
El formulario está en `src/screens/LoginScreen.jsx` y la sesión se comparte mediante
SessionProvider. Tras iniciar o restaurar la sesión se abre `/inicio`.

- Empleado: Inicio, Asistencia y Solicitudes.
- Administrativo: Inicio, Empleados, Asistencia, Solicitudes y Servicios.

Inicio muestra nombre, rol, ID y correo reales de la sesión. Las otras secciones
son espacios reservados para definir su contenido posteriormente; no consultan
tablas ni ejecutan operaciones. La navegación limita las rutas visibles por rol;
la autorización de futuras operaciones deberá comprobarse también en servidor.
El cierre de sesión sigue revocando el token con la Edge Function actual.

1. En `src/config/login.js`, pega en `LOGIN_URL` la URL completa de la función:
   `https://TU_PROYECTO.supabase.co/functions/v1/login-empleado`.
2. Conserva `PUBLIC_API_KEY` con tu clave pública: tu gateway la requiere.
   Nunca uses claves secretas ni la clave administrativa en la app.
3. En Supabase, despliega `login-empleado` con Verify JWT desactivado.
4. Ejecuta `npm start` para Expo Go o `npm run web` para navegador.

El proyecto incluye TypeScript y los tipos de React como dependencias de desarrollo
para que Expo no solicite instalarlos al detectar los archivos `.ts` de Supabase.
La app puede continuar en JavaScript. `tsconfig.json` limita la revisión a la app:
las Edge Functions se ejecutan en Deno y tienen su propio entorno de tipos.

## ACTIVAR SESIONES EN SUPABASE (necesario)

1. Abre SQL Editor en el mismo proyecto que contiene `public.empleado`.
   Ejecuta una vez `supabase/sesiones.sql`: crea la tabla `sesion_empleado` con
   RLS y acceso reservado al servidor. No modifica tus empleados ni contraseñas.
2. En Edge Functions, reemplaza TODO el código de `login-empleado` por el archivo
   `supabase/functions/sesion/index.ts`. Pulsa Deploy updates.
3. Crea otra función llamada EXACTAMENTE `sesion-empleado` y pega el MISMO archivo
   completo. Pulsa Deploy function.
4. Desactiva Verify JWT en AMBAS funciones. Cada solicitud de sesión se valida
   mediante un token propio, nunca mediante el ID o rol enviados por el cliente.
5. Conserva la URL de login y la clave pública actuales. La URL de sesion-empleado
   se deriva automáticamente de LOGIN_URL: no tienes que pegar otra URL.
6. Reinicia Expo tras instalar expo-secure-store: `npm start -- --clear`.

El login POST recibe `{ accion: "login", identificador, password }` y devuelve
`{ ok: true, empleado, session: { token, expires_at } }`.
sesion-empleado acepta `{ accion: "validar" }` o `{ accion: "cerrar" }` con
encabezados `x-session-token` y `apikey`. Nunca uses el token como JWT de Supabase.

Las sesiones duran 7 días sin renovación automática. Se guarda únicamente el
token: SecureStore en And
roid/iOS, localStorage en web (accesible a JavaScript;
usar HTTPS y evitar scripts no confiables). La base guarda solo SHA-256 del token
aleatorio, no la contraseña ni el token original. PBKDF2 sigue para contraseñas.
Al abrir/reanudar la app y cada minuto en primer plano se consulta la sesión y el
estado actual del empleado. Un fallo de conexión bloquea la bienvenida y permite
reintentar sin borrar el token. Sign out elimina la sesión en servidor y teléfono;
si falla la red se muestra error y se permite reintentar.

## Comprobación manual tras desplegar

- Inicia sesión, recarga web o cierra y abre Expo: debe restaurar el acceso.
- Cierra sesión, recarga: debe aparecer el login.
- Un token cerrado o expirado debe recibir 401 al validar.
- Sin red, la app no debe dar por validada la sesión; Retry permite recuperarla.
- Cambiar empleado.estado a false debe impedir restaurar su sesión.

No se ha ejecutado SQL ni desplegado código remoto desde Codex. La sesión propia
NO habilita acceso directo por RLS a las otras tablas: futuras funciones deben
validar el token y comprobar sus permisos de servidor antes de operar.
La limitación de intentos del login y la limpieza periódica de sesiones vencidas
quedan pendientes. Al cambiar una contraseña debe revocarse también su conjunto
de sesiones. No existe todavía un flujo de cambio de contraseña en esta app.
