# Configurar el login

1. En `src/config/login.js`, pega en `LOGIN_URL` la URL completa de la función:
   `https://TU_PROYECTO.supabase.co/functions/v1/login-empleado`.
2. Deja `PUBLIC_API_KEY` vacía salvo que el gateway requiera una clave pública.
   Nunca uses claves secretas ni la clave administrativa en la app.
3. En Supabase, despliega `login-empleado` con Verify JWT desactivado.
4. Ejecuta `npm start` para Expo Go o `npm run web` para navegador.

Contrato POST: `{ identificador, password }`.
Respuesta esperada: `{ ok: true, empleado: { id, nombre, apellido, correo, rol } }`.

La interfaz está en inglés conforme a las instrucciones del proyecto.
La app no consulta tablas ni guarda la contraseña. El resultado vive en memoria
y se pierde al recargar. La bienvenida confirma credenciales; todavía no existe
una sesión autenticada ni autorización para otras operaciones.
