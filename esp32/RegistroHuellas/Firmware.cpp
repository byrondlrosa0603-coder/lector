#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>
#include <time.h>

#include "As608.h"
#include "Certificados.h"
#if __has_include("config.h")
#include "config.h"
#else
#error "Copia config.ejemplo.h como config.h y completa la configuración del lector."
#endif

namespace {
constexpr char CLAVE_NVS[] = "confirmacion";
constexpr uint32_t VERSION_DIARIO = 1;
constexpr uint32_t INTERVALO_MS = 3500;

struct Confirmacion {
  uint32_t version;
  uint16_t posicion;
  char solicitud[37];
  uint8_t hashPlantilla[32];
  uint8_t hashConfiguracion[32];
};

Preferences memoria;
Confirmacion pendiente{};
uint8_t plantilla[As608::TAMANO_MAXIMO];
uint8_t hashConfiguracion[32];
String solicitudFallida;
const char* motivoFallo = nullptr;
bool inicializado = false;
bool apiDisponible = false;

bool uuidValido(const char* id) {
  if (!id || strlen(id) != 36) return false;
  for (int i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (id[i] != '-') return false;
    } else if (!strchr("0123456789abcdefABCDEF", id[i])) return false;
  }
  return true;
}

bool configuracionValida() {
  const String url(SUPABASE_URL_LECTOR);
  const String apiKey(SUPABASE_API_KEY_PUBLICA);
  return url.startsWith("https://") && url.endsWith("/functions/v1/lector-huellas") &&
         url.indexOf("TU_PROYECTO") < 0 && apiKey.length() > 0 &&
         !apiKey.startsWith("TU_") && !apiKey.startsWith("sb_secret_") &&
         strlen(CLAVE_LECTOR) == 64 && strspn(CLAVE_LECTOR, "0123456789abcdef") == 64 &&
         strlen(ID_LECTOR) > 0 && strlen(ID_LECTOR) <= 100 &&
         strlen(WIFI_SSID) > 0 && strcmp(WIFI_SSID, "NOMBRE_DE_TU_WIFI") != 0;
}

bool leerDiario() {
  if (!memoria.isKey(CLAVE_NVS)) return true;
  if (memoria.getBytesLength(CLAVE_NVS) != sizeof(pendiente) ||
      memoria.getBytes(CLAVE_NVS, &pendiente, sizeof(pendiente)) != sizeof(pendiente) ||
      pendiente.version != VERSION_DIARIO || pendiente.posicion == 0 ||
      pendiente.solicitud[36] != '\0' || !uuidValido(pendiente.solicitud) ||
      memcmp(pendiente.hashConfiguracion, hashConfiguracion, sizeof(hashConfiguracion)) != 0) {
    Serial.println("Hay una confirmación local ilegible o asociada a otra URL o lector. Se conserva su posición.");
    return false;
  }
  Serial.println("Hay una confirmación pendiente. Se retomará al conectar.");
  return true;
}

bool iniciarDiario(const char* id, uint16_t posicion, size_t tamano) {
  Confirmacion nueva{};
  nueva.version = VERSION_DIARIO;
  nueva.posicion = posicion;
  memcpy(nueva.solicitud, id, sizeof(nueva.solicitud));
  memcpy(nueva.hashConfiguracion, hashConfiguracion, sizeof(hashConfiguracion));
  if (mbedtls_sha256(plantilla, tamano, nueva.hashPlantilla, 0) != 0 ||
      memoria.putBytes(CLAVE_NVS, &nueva, sizeof(nueva)) != sizeof(nueva)) {
    Serial.println("No se pudo guardar la confirmación pendiente en la memoria del ESP32.");
    return false;
  }
  pendiente = nueva;
  return true;
}

void cerrarDiario() {
  if (memoria.remove(CLAVE_NVS) || !memoria.isKey(CLAVE_NVS)) {
    pendiente = Confirmacion{};
  } else {
    Serial.println("No se pudo cerrar la confirmación local. Se reintentará.");
  }
}

int enviar(const JsonDocument& datos, JsonDocument& respuesta) {
  WiFiClientSecure conexion;
  conexion.setCACert(CERTIFICADOS_SUPABASE);
  conexion.setHandshakeTimeout(6);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(6000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(conexion, SUPABASE_URL_LECTOR)) {
    Serial.println("No se pudo abrir la URL HTTPS del lector.");
    return 0;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_API_KEY_PUBLICA);
  http.addHeader("x-device-id", ID_LECTOR);
  http.addHeader("x-device-key", CLAVE_LECTOR);

  String json;
  if (datos.overflowed() || !json.reserve(measureJson(datos) + 1) || serializeJson(datos, json) == 0) {
    http.end();
    return 0;
  }

  const int codigo = http.POST(json);
  if (codigo > 0) {
    if (deserializeJson(respuesta, http.getString())) respuesta.clear();
    if (codigo >= 300) {
      const char* error = respuesta["error"] | "Revisa la URL, la clave pública y el despliegue de lector-huellas.";
      Serial.printf("Supabase HTTP %d: %s\n", codigo, error);
    }
  } else {
    Serial.printf("Error HTTPS: %s\n", HTTPClient::errorToString(codigo).c_str());
    char detalle[160];
    if (conexion.lastError(detalle, sizeof(detalle)) != 0) Serial.println(detalle);
  }
  http.end();
  return codigo;
}

bool respuestaCorrecta(int codigo, const JsonDocument& respuesta) {
  return codigo >= 200 && codigo < 300 && respuesta["ok"] == true;
}

const char* estadoSolicitud(const JsonDocument& respuesta, const char* id) {
  const char* recibido = respuesta["solicitud"]["id"] | "";
  return strcmp(recibido, id) == 0 ? (respuesta["solicitud"]["estado"] | "") : "";
}

bool reportarFallo(const char* id, const char* motivo) {
  JsonDocument datos;
  datos["accion"] = "fallar";
  datos["id_solicitud"] = id;
  datos["motivo"] = motivo;
  JsonDocument respuesta;
  const int codigo = enviar(datos, respuesta);
  if (codigo == 404 && strcmp(respuesta["error"] | "", "Solicitud no encontrada") == 0) return true;
  if (!respuestaCorrecta(codigo, respuesta)) return false;
  const char* estado = estadoSolicitud(respuesta, id);
  return strcmp(estado, "fallida") == 0 || strcmp(estado, "vencida") == 0;
}

void recuperarConfirmacion() {
  if (!As608::disponible()) {
    Serial.println("Conecta el AS608 para retomar la confirmación pendiente.");
    return;
  }
  size_t tamano;
  if (!As608::leer(pendiente.posicion, plantilla, tamano)) {
    // Si se reinició antes de escribir la plantilla, se puede cerrar la solicitud.
    if (As608::consultarPosicion(pendiente.posicion) == As608::Ocupacion::Libre) {
      if (reportarFallo(pendiente.solicitud, "captura_fallida")) cerrarDiario();
    } else {
      Serial.println("No se pudo leer la posición pendiente. Se conserva hasta verificarla.");
    }
    return;
  }

  uint8_t hash[32];
  if (mbedtls_sha256(plantilla, tamano, hash, 0) != 0 ||
      memcmp(hash, pendiente.hashPlantilla, sizeof(hash)) != 0) {
    Serial.println("La plantilla de la posición pendiente cambió. Se conserva para revisión.");
    return;
  }

  constexpr char DIGITOS_HEX[] = "0123456789abcdef";
  String hex;
  if (!hex.reserve(tamano * 2 + 1)) return;
  for (size_t i = 0; i < tamano; i++) {
    hex += DIGITOS_HEX[plantilla[i] >> 4];
    hex += DIGITOS_HEX[plantilla[i] & 0x0F];
  }
  JsonDocument datos;
  datos["accion"] = "confirmar";
  datos["id_solicitud"] = pendiente.solicitud;
  datos["id_plantilla"] = pendiente.posicion;
  datos["plantilla_hex"] = hex;
  JsonDocument respuesta;
  const int codigo = enviar(datos, respuesta);
  if (!respuestaCorrecta(codigo, respuesta)) return;

  const char* estado = estadoSolicitud(respuesta, pendiente.solicitud);
  if (strcmp(estado, "completada") == 0) {
    Serial.printf("Huella registrada en Supabase. Posición AS608: %u.\n", static_cast<unsigned>(pendiente.posicion));
    cerrarDiario();
  } else if (strcmp(estado, "fallida") == 0 || strcmp(estado, "vencida") == 0) {
    // Supabase confirmó el rechazo y el hash coincide con la captura temporal.
    if (As608::borrar(pendiente.posicion)) {
      Serial.println("Solicitud cerrada. Se liberó la posición temporal.");
      cerrarDiario();
    } else {
      Serial.println("No se pudo liberar la posición temporal. Se reintentará.");
    }
  }
}

// PostgreSQL devuelve la fecha ISO 8601 con zona, a veces con fracción de segundo.
time_t fechaUtc(const char* texto) {
  struct tm fecha{};
  int caracteres = 0;
  if (sscanf(texto, "%d-%d-%dT%d:%d:%d%n", &fecha.tm_year, &fecha.tm_mon, &fecha.tm_mday,
             &fecha.tm_hour, &fecha.tm_min, &fecha.tm_sec, &caracteres) != 6) return 0;
  fecha.tm_year -= 1900;
  fecha.tm_mon -= 1;
  const char* zona = texto + caracteres;
  if (*zona == '.') zona += 1 + strspn(zona + 1, "0123456789");
  if (strcmp(zona, "Z") == 0) return mktime(&fecha);
  if (*zona != '+' && *zona != '-') return 0;
  int horas, minutos, longitud = 0;
  if (sscanf(zona + 1, "%2d:%2d%n", &horas, &minutos, &longitud) != 2 ||
      longitud != 5 || zona[1 + longitud] != '\0' || horas < 0 || horas > 23 ||
      minutos < 0 || minutos > 59) return 0;
  const long offset = horas * 3600L + minutos * 60L;
  return mktime(&fecha) - (*zona == '+' ? offset : -offset);
}

const char* realizarCaptura(const char* id, const char* expiraEn) {
  const double restantes = difftime(fechaUtc(expiraEn), time(nullptr));
  if (restantes <= 10 || restantes > 130) return "captura_fallida";
  const uint32_t plazo = millis() + static_cast<uint32_t>((restantes - 10) * 1000);
  if (!As608::disponible()) return "lector_no_disponible";
  const int posicion = As608::buscarPosicionLibre(plazo);
  if (posicion == As608::SIN_ESPACIO) return "sin_espacio";
  if (posicion == As608::POSICIONES_DESCONOCIDAS) return "lector_no_disponible";

  size_t tamano;
  if (const char* fallo = As608::capturar(plazo, plantilla, tamano)) return fallo;
  Serial.printf("Plantilla extraída: %u bytes.\n", static_cast<unsigned>(tamano));
  if (static_cast<int32_t>(plazo - millis()) <= 0) return "captura_fallida";
  if (!iniciarDiario(id, posicion, tamano)) return "captura_fallida";
  if (!As608::guardar(posicion)) {
    Serial.println("El sensor no confirmó la escritura. Se verificará la posición.");
  }
  // Leer desde el sensor confirma que la copia local coincide antes del envío.
  recuperarConfirmacion();
  return nullptr;
}

void tomarSolicitud() {
  JsonDocument datos;
  datos["accion"] = "tomar";
  JsonDocument respuesta;
  const int codigo = enviar(datos, respuesta);
  if (!respuestaCorrecta(codigo, respuesta)) return;
  if (!apiDisponible) {
    apiDisponible = true;
    Serial.println("Supabase conectado. Esperando solicitudes de la web.");
  }

  const JsonObjectConst solicitud = respuesta["solicitud"].as<JsonObjectConst>();
  if (solicitud.isNull()) return;
  const char* id = solicitud["id"] | "";
  if (!uuidValido(id) || strcmp(solicitud["estado"] | "", "capturando") != 0) return;

  Serial.println("Solicitud recibida.");
  if (const char* fallo = realizarCaptura(id, solicitud["expira_en"] | "")) {
    Serial.printf("Captura sin guardar: %s.\n", fallo);
    if (!reportarFallo(id, fallo)) {
      solicitudFallida = id;
      motivoFallo = fallo;
    }
  }
}
}

void iniciarRegistroHuellas() {
  Serial.begin(115200);
  if (!configuracionValida()) {
    Serial.println("Revisa la URL, las claves y el Wi-Fi en config.h.");
    return;
  }
  const String contexto = String(SUPABASE_URL_LECTOR) + "|" + ID_LECTOR;
  if (mbedtls_sha256(reinterpret_cast<const uint8_t*>(contexto.c_str()), contexto.length(), hashConfiguracion, 0) != 0 ||
      !memoria.begin("reg-huellas", false)) {
    Serial.println("No se pudo abrir la memoria de confirmaciones.");
    return;
  }
  if (!leerDiario()) return;
  As608::iniciar(PIN_RX_AS608, PIN_TX_AS608, BAUD_AS608);
  delay(1000);
  Serial.println(As608::disponible() ? "AS608 conectado." : "AS608 sin respuesta. Revisa UART y alimentación.");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTzTime("UTC0", "pool.ntp.org", "time.nist.gov");
  Serial.println("Conectando al Wi-Fi y sincronizando la hora.");
  inicializado = true;
}

void atenderRegistroHuellas() {
  if (!inicializado) { delay(INTERVALO_MS); return; }
  if (WiFi.status() != WL_CONNECTED) {
    apiDisponible = false;
    Serial.println("Esperando conexión Wi-Fi.");
  } else if (time(nullptr) < 1700000000) {
    Serial.println("Esperando sincronización de hora para HTTPS.");
  } else if (pendiente.version == VERSION_DIARIO) {
    recuperarConfirmacion();
  } else if (motivoFallo) {
    if (reportarFallo(solicitudFallida.c_str(), motivoFallo)) {
      solicitudFallida = "";
      motivoFallo = nullptr;
    }
  } else {
    tomarSolicitud();
  }
  delay(INTERVALO_MS);
}
