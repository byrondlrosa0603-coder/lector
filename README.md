# Lector de asistencia

Portal de gestión de acceso y asistencia con una aplicación web, una aplicación Android y un lector de huellas ESP32 con sensor AS608.

## Inicio rápido

La aplicación ya viene configurada para conectarse al proyecto Supabase existente. Instala Node.js 24.3 o posterior de la rama 24, o Node.js 26, con npm. Abre una terminal en `Codigo/lector`, donde está `package.json`, e instala las dependencias.

```bash
npm ci
```

Después, inicia la web con `npm run web` o abre la app en Android siguiendo los pasos de abajo. Entra con el ID o correo y la contraseña de un empleado registrado.

## Ejecutar y compilar la web

Para iniciar la web en modo de desarrollo, ejecuta este comando y abre la dirección local que muestre Expo.

```bash
npm run web
```

Para generar la versión web y probarla en local, ejecuta estos comandos. La compilación se guarda en `dist/`.

```bash
npx expo export --platform web
npx expo serve
```

## Ejecutar y compilar en Android

Para probar en un teléfono, abre Expo Go compatible con el SDK del proyecto. Conecta el teléfono y la computadora a la misma red Wi-Fi, ejecuta el siguiente comando y escanea el QR desde Expo Go.

```bash
npm start
```

Si ya tienes un emulador Android en marcha, puedes abrir Expo Go en él con `npm run android`.

Para compilar e instalar una versión de depuración, instala Android Studio, configura el SDK de Android y abre un emulador o conecta un teléfono con la depuración USB activada. El siguiente comando compila la app, la instala y arranca el servidor de desarrollo. [Configuración de compilación local de Expo](https://docs.expo.dev/guides/local-app-development/)

```bash
npx expo run:android --device
```

### Generar un APK para instalar en Android

**En la computadora con Windows**

1. Instala Android Studio con el SDK de Android y configura Java para Gradle. [Preparar el entorno Android](https://docs.expo.dev/guides/local-app-development/)
2. Desde `Codigo/lector`, después de instalar las dependencias, genera el proyecto nativo y compila el APK de la variante `release`.

   ```powershell
   npx expo prebuild --platform android
   cd android
   .\gradlew.bat :app:assembleRelease
   ```

   Si Expo te pide un identificador de paquete, puedes usar `com.asistencia.lector`.
3. Busca `android/app/build/outputs/apk/release/app-release.apk` desde la raíz del proyecto y copia el archivo al teléfono.

**En el teléfono Android**

1. Abre `app-release.apk` desde la app de archivos y autoriza la instalación desde ese origen si Android lo solicita.
2. Pulsa **Instalar** y abre **Lector** desde el menú de aplicaciones.

El APK incluye el código de la aplicación y usa la firma de prueba que trae la plantilla local de Expo. [Compilar variantes de Android con Expo](https://docs.expo.dev/more/expo-cli/#compiling-android)

## Compilar y ejecutar el lector ESP32

1. Instala Arduino IDE y el paquete de placas **esp32** de Espressif. En el gestor de bibliotecas instala **Adafruit Fingerprint Sensor Library** y **ArduinoJson** versión 7. [Instalación del paquete ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html)
2. Abre [RegistroHuellasWifi.ino](esp32/RegistroHuellasWifi/RegistroHuellasWifi.ino). Para configurarlo con tus datos, guarda una copia local en una carpeta llamada `RegistroHuellasWifi` y completa `WIFI_SSID`, `WIFI_PASSWORD`, `ID_LECTOR` y `CLAVE_LECTOR` al inicio del archivo. Usa el identificador del lector registrado y la clave original asociada a ese identificador en el secreto `HUELLAS_WIFI_CLAVES` de Supabase.
3. Conecta el TX del AS608 al GPIO 16 del ESP32 y el RX al GPIO 17, con tierra común y la alimentación correspondiente al módulo. Los pines se configuran en `PIN_RX_AS608` y `PIN_TX_AS608`.
4. Conecta el ESP32 por USB, selecciona su placa y puerto en Arduino IDE y pulsa **Verificar** para compilar. Después pulsa **Subir**. Abre el **Monitor serie** a `115200` baudios y copia la dirección que aparece junto a `IP del lector`.
5. Abre la web desde una computadora conectada a la misma red Wi-Fi que el lector. Inicia sesión con una cuenta administrativa, entra en **Editar → Huellas**, pega la IP y pulsa **Conectar lector**. Selecciona un empleado y pulsa **Solicitar captura** para probar el registro.

## Conectar otro proyecto Supabase

Si vas a usar otro proyecto Supabase, actualiza `LOGIN_URL` con la URL completa de `login-empleado` y `PUBLIC_API_KEY` con la clave pública de ese proyecto en [src/config/login.js](src/config/login.js).

Prepara los datos de empleados y despliega `login-empleado`, `sesion-empleado` y `gestionar-catalogos`. Para habilitar **Editar → Huellas**, despliega `gestionar-huellas` y aplica [registro-huellas.sql](supabase/registro-huellas.sql) sobre el esquema de huellas existente. Consulta [LOGIN.md](LOGIN.md) para configurar el login y las sesiones.
