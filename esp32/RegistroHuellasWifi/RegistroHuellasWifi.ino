#include <Arduino.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <esp_random.h>
#include <mbedtls/gcm.h>
#include <mbedtls/sha256.h>
#include <memory>

// Configuración del lector. Guarda tu copia configurada fuera del repositorio.
constexpr char WIFI_SSID[] = "INFINITUM63BA";
constexpr char WIFI_PASSWORD[] = "ZYV9fMyW3P";
constexpr char ID_LECTOR[] = "lector-01";
constexpr char CLAVE_LECTOR[] = "d79aea4b37a94cd8bea5883ecaf04ec5d916f5e164bd46d699b653177648f6d5";
constexpr int PIN_RX_AS608 = 16;
constexpr int PIN_TX_AS608 = 17;
constexpr unsigned long BAUD_AS608 = 57600;

// Encapsula el UART. Las futuras acciones del ESP32 pueden reutilizar este sensor.
class SensorHuellas {
public:
  static constexpr size_t TAMANO_MAXIMO = 2048;
  static constexpr int SIN_ESPACIO = -1;
  static constexpr int POSICIONES_DESCONOCIDAS = -2;
  enum class Ocupacion { Libre, Ocupada, Desconocida };
  explicit SensorHuellas(WebServer& web) : servidor(web) {}

private:
  WebServer& servidor;
  Adafruit_Fingerprint sensor{&Serial2};
  static constexpr uint8_t LEER_INDICE = 0x1F;
  const char* paso = "preparando";

  struct Paquete {
    uint8_t tipo;
    uint16_t tamano;
    uint8_t datos[256];
  };

  bool hayTiempo(uint32_t plazo) {
    return static_cast<int32_t>(plazo - millis()) > 0;
  }

  void descartarEntrada() {
    while (Serial2.available()) Serial2.read();
  }

  bool recibir(uint8_t* salida, size_t cantidad, uint32_t plazo) {
    for (size_t i = 0; i < cantidad;) {
      if (!hayTiempo(plazo)) return false;
      const int byte = Serial2.read();
      if (byte < 0) delay(1);
      else salida[i++] = static_cast<uint8_t>(byte);
    }
    return true;
  }

  bool recibirPaquete(Paquete& paquete, uint32_t plazo) {
    uint8_t encabezado[9];
    if (!recibir(encabezado, sizeof(encabezado), plazo) ||
        encabezado[0] != 0xEF || encabezado[1] != 0x01) return false;

    uint32_t direccion = 0;
    for (int i = 2; i < 6; i++) direccion = (direccion << 8) | encabezado[i];
    if (direccion != sensor.device_addr && direccion != 0xFFFFFFFFUL) return false;

    const uint16_t longitud = (encabezado[7] << 8) | encabezado[8];
    if (longitud < 2 || longitud > sizeof(paquete.datos) + 2) return false;
    paquete.tipo = encabezado[6];
    paquete.tamano = longitud - 2;

    uint8_t checksum[2];
    if (!recibir(paquete.datos, paquete.tamano, plazo) || !recibir(checksum, sizeof(checksum), plazo)) return false;
    uint16_t suma = paquete.tipo + encabezado[7] + encabezado[8];
    for (uint16_t i = 0; i < paquete.tamano; i++) suma += paquete.datos[i];
    return suma == ((checksum[0] << 8) | checksum[1]);
  }

  bool comandoConAcuse(uint8_t codigo, uint8_t parametro, Paquete& acuse, uint32_t plazo) {
    descartarEntrada();
    uint8_t comando[] = { codigo, parametro };
    Adafruit_Fingerprint_Packet paquete(FINGERPRINT_COMMANDPACKET, sizeof(comando), comando);
    sensor.writeStructuredPacket(paquete);
    return recibirPaquete(acuse, plazo) && acuse.tipo == FINGERPRINT_ACKPACKET &&
           acuse.tamano >= 1 && acuse.datos[0] == FINGERPRINT_OK;
  }

  bool leerIndice(uint8_t pagina, Paquete& indice) {
    return comandoConAcuse(LEER_INDICE, pagina, indice, millis() + 1000) && indice.tamano == 33;
  }

  bool ocupadaEnIndice(const Paquete& indice, uint16_t posicion) {
    const uint16_t bit = posicion % 256;
    return (indice.datos[1 + bit / 8] & (1U << (bit % 8))) != 0;
  }

  // Algunos módulos reservan 0x1F. En esos casos comparamos las posiciones
  // legibles con el conteo del lector antes de confiar en una posición libre.
  int escanearPosiciones(uint32_t plazo, int excluir, int objetivo = -1, Ocupacion* ocupacion = nullptr) {
    descartarEntrada();
    if (sensor.getTemplateCount() != FINGERPRINT_OK) return POSICIONES_DESCONOCIDAS;
    int libre = SIN_ESPACIO;
    unsigned int legibles = 0;
    Ocupacion resultado = Ocupacion::Desconocida;
    for (uint32_t posicion = 0; posicion < sensor.capacity; posicion++) {
      if (!hayTiempo(plazo)) return POSICIONES_DESCONOCIDAS;
      servidor.handleClient();
      const uint8_t codigo = sensor.loadModel(posicion);
      if (codigo == FINGERPRINT_OK) {
        legibles++;
        if (static_cast<int>(posicion) == objetivo) resultado = Ocupacion::Ocupada;
      } else if (codigo == FINGERPRINT_DBRANGEFAIL) {
        if (posicion != 0 && static_cast<int>(posicion) != excluir && libre == SIN_ESPACIO) libre = posicion;
        if (static_cast<int>(posicion) == objetivo) resultado = Ocupacion::Libre;
      } else if (!(posicion == 0 && codigo == FINGERPRINT_BADLOCATION)) {
        Serial.printf("LoadChar devolvió 0x%02x en posición %lu.\n",
                      static_cast<unsigned>(codigo), static_cast<unsigned long>(posicion));
        return POSICIONES_DESCONOCIDAS;
      }
    }
    if (legibles != sensor.templateCount) return POSICIONES_DESCONOCIDAS;
    if (ocupacion) *ocupacion = resultado;
    return libre;
  }

  bool esperarDedo(bool presente, uint32_t plazo) {
    while (hayTiempo(plazo)) {
      servidor.handleClient();
      const uint8_t codigo = sensor.getImage();
      if (presente && codigo == FINGERPRINT_OK) return true;
      if (!presente && codigo == FINGERPRINT_NOFINGER) return true;
      if (codigo != FINGERPRINT_OK && codigo != FINGERPRINT_NOFINGER && codigo != FINGERPRINT_IMAGEFAIL) return false;
      delay(100);
    }
    return false;
  }

  bool exportarPlantilla(uint8_t* plantilla, size_t& tamano) {
    tamano = 0;
    const uint32_t plazo = millis() + 4500;
    Paquete paquete;
    // UpChar devuelve primero un ACK y después los bloques de datos.
    if (!comandoConAcuse(FINGERPRINT_UPLOAD, 1, paquete, plazo)) return false;
    while (recibirPaquete(paquete, plazo)) {
      if ((paquete.tipo != FINGERPRINT_DATAPACKET && paquete.tipo != FINGERPRINT_ENDDATAPACKET) ||
          tamano + paquete.tamano > TAMANO_MAXIMO) return false;
      memcpy(plantilla + tamano, paquete.datos, paquete.tamano);
      tamano += paquete.tamano;
      if (paquete.tipo == FINGERPRINT_ENDDATAPACKET) return tamano >= 128;
    }
    return false;
  }

public:
  void iniciar(int pinRx, int pinTx, unsigned long baudios) {
    Serial2.setRxBufferSize(4096);
    Serial2.begin(baudios, SERIAL_8N1, pinRx, pinTx);
  }

  bool disponible() {
    descartarEntrada();
    return sensor.verifyPassword() && sensor.getParameters() == FINGERPRINT_OK && sensor.capacity > 1;
  }

  int buscarPosicionLibre(uint32_t plazo, int excluir) {
    paso = "preparando";
    Paquete indice;
    for (uint32_t base = 0; base < sensor.capacity; base += 256) {
      if (!hayTiempo(plazo)) return POSICIONES_DESCONOCIDAS;
      if (!leerIndice(base / 256, indice)) {
        Serial.println("Índice AS608 no disponible. Comprobando posiciones mediante LoadChar.");
        return escanearPosiciones(plazo, excluir);
      }
      const uint32_t fin = min(base + 256, static_cast<uint32_t>(sensor.capacity));
      for (uint32_t posicion = base; posicion < fin; posicion++) {
        if (posicion == 0 || static_cast<int>(posicion) == excluir || ocupadaEnIndice(indice, posicion)) continue;
        // Comprueba la posición con el lector antes de escribir.
        if (sensor.loadModel(posicion) == FINGERPRINT_DBRANGEFAIL) return posicion;
        return escanearPosiciones(plazo, excluir);
      }
    }
    return SIN_ESPACIO;
  }

  Ocupacion consultarPosicion(uint16_t posicion) {
    if (posicion >= sensor.capacity) return Ocupacion::Desconocida;
    Paquete indice;
    if (leerIndice(posicion / 256, indice)) {
      return ocupadaEnIndice(indice, posicion) ? Ocupacion::Ocupada : Ocupacion::Libre;
    }
    Ocupacion estado = Ocupacion::Desconocida;
    escanearPosiciones(millis() + 35000, -1, posicion, &estado);
    return estado;
  }

  const char* capturar(uint32_t plazo, uint8_t* plantilla, size_t& tamano, int coincidenciaPermitida) {
    paso = "primer_dedo";
    Serial.println("Coloca el dedo en el AS608.");
    if (!esperarDedo(true, plazo) || sensor.image2Tz(1) != FINGERPRINT_OK) return "captura_fallida";
    const uint8_t busqueda = sensor.fingerSearch(1);
    if (busqueda == FINGERPRINT_OK) {
      if (sensor.fingerID != coincidenciaPermitida) return "huella_duplicada";
    } else if (busqueda != FINGERPRINT_NOTFOUND && busqueda != FINGERPRINT_NOMATCH) {
      return "lector_no_disponible";
    }

    paso = "retirar";
    Serial.println("Retira el dedo.");
    if (!esperarDedo(false, plazo)) return "captura_fallida";
    paso = "segundo_dedo";
    Serial.println("Coloca otra vez el mismo dedo.");
    if (!esperarDedo(true, plazo) || sensor.image2Tz(2) != FINGERPRINT_OK ||
        sensor.createModel() != FINGERPRINT_OK || !hayTiempo(plazo)) return "captura_fallida";
    paso = "procesando";
    if (!exportarPlantilla(plantilla, tamano)) return "plantilla_no_exportable";
    return nullptr;
  }

  bool guardar(uint16_t posicion) {
    return sensor.storeModel(posicion) == FINGERPRINT_OK;
  }

  bool leer(uint16_t posicion, uint8_t* plantilla, size_t& tamano) {
    return sensor.loadModel(posicion) == FINGERPRINT_OK && exportarPlantilla(plantilla, tamano);
  }

  bool borrar(uint16_t posicion) {
    return sensor.deleteModel(posicion) == FINGERPRINT_OK;
  }

  const char* indicacion() const { return paso; }
};

class RegistroWifi {
  enum class Fase { Libre, Programada, Capturando, Recuperar, Resultado, Cerrar };
  enum class Operacion { Registrar, Reemplazar, Borrar };
  enum class Verificacion { Coincide, Libre, Desconocida };
  struct Posicion {
    int numero = -1;
    uint8_t hash[32]{};
  };
  struct RegistroLocal {
    uint32_t version;
    uint16_t posicion;
    char id[37];
    uint8_t hash[32];
    uint8_t lector[32];
  };
  static constexpr char CLAVE_NVS[] = "pendiente";
  static constexpr uint32_t REGISTRO_CAPTURA = 1;
  static constexpr uint32_t REGISTRO_BORRADO = 2;

  WebServer servidor{80};
  SensorHuellas sensor;
  Preferences memoria;
  RegistroLocal registro{};
  Fase fase = Fase::Libre;
  Fase faseAnterior = Fase::Libre;
  Operacion operacion = Operacion::Registrar;
  Posicion anterior, retiro;
  String idSolicitud, nonce, resultado;
  uint32_t venceNonce = 0, plazo = 0, siguienteVerificacion = 0;
  bool listo = false, ipMostrada = false, confirmada = false;
  const char* errorLocal = nullptr;
  uint8_t claveOrden[32], claveResultado[32], hashLector[32];
  uint8_t plantilla[SensorHuellas::TAMANO_MAXIMO];

  static bool tiempo(uint32_t limite) {
    return static_cast<int32_t>(limite - millis()) > 0;
  }

  static bool esUuid(const char* id) {
    if (strlen(id) != 36) return false;
    for (int i = 0; i < 36; i++) {
      if (i == 8 || i == 13 || i == 18 || i == 23) {
        if (id[i] != '-') return false;
      } else if (!strchr("0123456789abcdefABCDEF", id[i])) return false;
    }
    return true;
  }

  static bool hash(const uint8_t* bytes, size_t tamano, uint8_t* salida) {
    return mbedtls_sha256(bytes, tamano, salida, 0) == 0;
  }

  static bool hash(const String& valor, uint8_t* salida) {
    return hash(reinterpret_cast<const uint8_t*>(valor.c_str()), valor.length(), salida);
  }

  static void agregarHex(String& salida, const uint8_t* bytes, size_t tamano) {
    constexpr char digitos[] = "0123456789abcdef";
    for (size_t i = 0; i < tamano; i++) {
      salida += digitos[bytes[i] >> 4];
      salida += digitos[bytes[i] & 15];
    }
  }

  static bool desdeHex(const char* entrada, uint8_t* salida, size_t tamano) {
    constexpr char digitos[] = "0123456789abcdef";
    if (strlen(entrada) != tamano * 2) return false;
    for (size_t i = 0; i < tamano; i++) {
      const char* alto = strchr(digitos, entrada[i * 2]);
      const char* bajo = strchr(digitos, entrada[i * 2 + 1]);
      if (!alto || !bajo) return false;
      salida[i] = ((alto - digitos) << 4) | (bajo - digitos);
    }
    return true;
  }

  static bool leerPosicion(JsonVariantConst dato, Posicion& salida) {
    if (!dato["posicion"].is<int>()) return false;
    const int numero = dato["posicion"].as<int>();
    if (numero < 0 || numero > 65535 || !desdeHex(dato["hash"] | "", salida.hash, sizeof(salida.hash))) return false;
    salida.numero = numero;
    return true;
  }

  void cabeceras() {
    servidor.sendHeader("Access-Control-Allow-Origin", "*");
    servidor.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    servidor.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    servidor.sendHeader("Cache-Control", "no-store");
  }

  void responder(int codigo, const JsonDocument& doc) {
    String json;
    serializeJson(doc, json);
    cabeceras();
    servidor.send(codigo, "application/json", json);
  }

  void fallarHttp(int codigo, const char* mensaje) {
    JsonDocument doc;
    doc["error"] = mensaje;
    responder(codigo, doc);
  }

  void responderEstado(const char* estado, int codigo = 200) {
    JsonDocument doc;
    doc["estado"] = estado;
    if (strcmp(estado, "capturando") == 0) {
      doc["paso"] = fase == Fase::Capturando ? sensor.indicacion() : "preparando";
    }
    responder(codigo, doc);
  }

  void informar() {
    if (!nonce.length() || !tiempo(venceNonce)) {
      uint8_t bytes[16];
      esp_fill_random(bytes, sizeof(bytes));
      nonce = "";
      agregarHex(nonce, bytes, sizeof(bytes));
      venceNonce = millis() + 45000;
    }
    JsonDocument doc;
    doc["identificador"] = ID_LECTOR;
    doc["gestiona_credenciales"] = true;
    doc["nonce"] = nonce;
    if (idSolicitud.length()) doc["id_solicitud"] = idSolicitud;
    else doc["id_solicitud"] = nullptr;
    responder(200, doc);
  }

  bool descifrarOrden(JsonDocument& orden) {
    const String cuerpo = servidor.arg("plain");
    if (cuerpo.length() > 1300) return false;
    JsonDocument sobre;
    if (deserializeJson(sobre, cuerpo)) return false;
    const char* datos = sobre["datos"] | "";
    const size_t caracteres = strlen(datos);
    uint8_t iv[12], cifrado[512], claro[512];
    if (caracteres < 34 || caracteres % 2 || caracteres / 2 > sizeof(cifrado) ||
        !desdeHex(sobre["iv"] | "", iv, sizeof(iv)) || !desdeHex(datos, cifrado, caracteres / 2)) return false;

    const size_t longitud = caracteres / 2 - 16;
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    const bool valido = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, claveOrden, 256) == 0 &&
      mbedtls_gcm_auth_decrypt(&gcm, longitud, iv, sizeof(iv), nullptr, 0,
                              cifrado + longitud, 16, cifrado, claro) == 0;
    mbedtls_gcm_free(&gcm);
    return valido && !deserializeJson(orden, reinterpret_cast<const char*>(claro), longitud);
  }

  bool sellarResultado(const char* motivo, size_t tamano) {
    JsonDocument doc;
    doc["identificador"] = ID_LECTOR;
    doc["id_solicitud"] = idSolicitud;
    if (motivo) {
      doc["accion"] = "fallar";
      doc["motivo"] = motivo;
    } else if (registro.version == REGISTRO_BORRADO) {
      doc["accion"] = "borrar";
    } else {
      String hex;
      if (!hex.reserve(tamano * 2 + 1)) return false;
      agregarHex(hex, plantilla, tamano);
      doc["accion"] = "confirmar";
      doc["id_plantilla"] = registro.posicion;
      doc["plantilla_hex"] = hex;
    }
    String claro;
    if (doc.overflowed() || serializeJson(doc, claro) == 0) return false;

    const size_t longitud = claro.length();
    std::unique_ptr<uint8_t[]> cifrado(new (std::nothrow) uint8_t[longitud]);
    if (!cifrado) return false;
    uint8_t iv[12], tag[16];
    esp_fill_random(iv, sizeof(iv));
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    const bool exito = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, claveResultado, 256) == 0 &&
      mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, longitud, iv, sizeof(iv), nullptr, 0,
                               reinterpret_cast<const uint8_t*>(claro.c_str()), cifrado.get(), sizeof(tag), tag) == 0;
    mbedtls_gcm_free(&gcm);
    if (!exito) return false;

    String ivHex, datosHex;
    if (!datosHex.reserve((longitud + sizeof(tag)) * 2 + 1)) return false;
    agregarHex(ivHex, iv, sizeof(iv));
    agregarHex(datosHex, cifrado.get(), longitud);
    agregarHex(datosHex, tag, sizeof(tag));
    JsonDocument respuesta;
    respuesta["estado"] = "resultado";
    respuesta["resultado"]["iv"] = ivHex;
    respuesta["resultado"]["datos"] = datosHex;
    if (respuesta.overflowed()) return false;
    resultado = "";
    if (serializeJson(respuesta, resultado) == 0) return false;
    fase = Fase::Resultado;
    return true;
  }

  void recibirOrden() {
    JsonDocument orden;
    if (!descifrarOrden(orden) || strcmp(orden["identificador"] | "", ID_LECTOR) != 0) {
      fallarHttp(403, "El lector rechazó la orden. Revisa ID_LECTOR y su clave.");
      return;
    }
    const char* id = orden["id_solicitud"] | "";
    if (!esUuid(id)) { fallarHttp(400, "Solicitud inválida."); return; }
    if (fase != Fase::Libre && idSolicitud != id) {
      fallarHttp(409, "Hay otra captura pendiente. Sincronízala primero.");
      return;
    }
    if (strcmp(orden["accion"] | "", "cerrar") == 0 && orden["confirmada"].is<bool>()) {
      if (fase == Fase::Libre) { responderEstado("cerrada"); return; }
      if (fase == Fase::Capturando || fase == Fase::Programada) { responderEstado("capturando", 202); return; }
      if (fase != Fase::Cerrar) {
        const bool exito = orden["confirmada"].as<bool>();
        Posicion solicitada;
        const bool necesitaRetiro = exito && (registro.version == REGISTRO_BORRADO ||
          operacion != Operacion::Registrar || !orden["retiro"].isNull());
        if (necesitaRetiro && (!leerPosicion(orden["retiro"], solicitada) ||
            (registro.version == REGISTRO_CAPTURA && solicitada.numero == registro.posicion))) {
          fallarHttp(400, "El cierre no identifica la posición anterior.");
          return;
        }
        confirmada = exito;
        retiro = solicitada;
        faseAnterior = fase;
        fase = Fase::Cerrar;
      }
      responderEstado("cerrando", 202);
      return;
    }
    if (strcmp(orden["accion"] | "", "capturar") != 0) {
      fallarHttp(400, "Acción inválida.");
      return;
    }
    if (fase == Fase::Resultado) {
      if (errorLocal) { fallarHttp(409, errorLocal); return; }
      cabeceras();
      servidor.send(200, "application/json", resultado);
      return;
    }
    if (fase != Fase::Libre) {
      if (errorLocal) fallarHttp(409, errorLocal);
      else responderEstado("capturando", 202);
      return;
    }
    const uint32_t vigencia = orden["vigencia_ms"] | 0UL;
    if (!nonce.length() || !tiempo(venceNonce) || nonce != (orden["nonce"] | "") ||
        vigencia < 1000 || vigencia > 120000) {
      fallarHttp(409, "La orden venció. Sincroniza la captura desde la web.");
      return;
    }
    const char* tipo = orden["operacion"] | "registrar";
    Posicion anteriorOrden;
    if (strcmp(tipo, "registrar") == 0) {
      operacion = Operacion::Registrar;
    } else {
      if ((strcmp(tipo, "reemplazar") != 0 && strcmp(tipo, "borrar") != 0) ||
          !leerPosicion(orden["anterior"], anteriorOrden)) {
        fallarHttp(400, "La orden no identifica la huella que se va a modificar.");
        return;
      }
      operacion = strcmp(tipo, "borrar") == 0 ? Operacion::Borrar : Operacion::Reemplazar;
    }
    anterior = anteriorOrden;
    nonce = "";
    idSolicitud = id;
    plazo = millis() + vigencia;
    fase = Fase::Programada;
    responderEstado("capturando", 202);
  }

  bool cargarRegistro() {
    if (!memoria.isKey(CLAVE_NVS)) return true;
    if (memoria.getBytesLength(CLAVE_NVS) != sizeof(registro) ||
        memoria.getBytes(CLAVE_NVS, &registro, sizeof(registro)) != sizeof(registro) ||
        (registro.version != REGISTRO_CAPTURA && registro.version != REGISTRO_BORRADO) ||
        (registro.version == REGISTRO_CAPTURA && registro.posicion == 0) || registro.id[36] != '\0' ||
        !esUuid(registro.id) || memcmp(registro.lector, hashLector, sizeof(hashLector)) != 0) return false;
    idSolicitud = registro.id;
    fase = Fase::Recuperar;
    return true;
  }

  bool guardarRegistro(uint32_t version, uint16_t posicion, const uint8_t* huellaHash) {
    RegistroLocal nuevo{};
    nuevo.version = version;
    nuevo.posicion = posicion;
    memcpy(nuevo.id, idSolicitud.c_str(), sizeof(nuevo.id));
    memcpy(nuevo.lector, hashLector, sizeof(hashLector));
    memcpy(nuevo.hash, huellaHash, sizeof(nuevo.hash));
    if (memoria.putBytes(CLAVE_NVS, &nuevo, sizeof(nuevo)) != sizeof(nuevo)) return false;
    registro = nuevo;
    return true;
  }

  bool leerPlantillaGuardada(size_t& tamano) {
    uint8_t comprobacion[32];
    return sensor.leer(registro.posicion, plantilla, tamano) && hash(plantilla, tamano, comprobacion) &&
           memcmp(comprobacion, registro.hash, sizeof(comprobacion)) == 0;
  }

  Verificacion verificarPosicion(const Posicion& posicion) {
    size_t tamano;
    uint8_t digest[32];
    if (sensor.leer(posicion.numero, plantilla, tamano)) {
      return hash(plantilla, tamano, digest) && memcmp(digest, posicion.hash, sizeof(digest)) == 0
        ? Verificacion::Coincide : Verificacion::Desconocida;
    }
    return sensor.consultarPosicion(posicion.numero) == SensorHuellas::Ocupacion::Libre
      ? Verificacion::Libre : Verificacion::Desconocida;
  }

  bool retirarPosicion(const Posicion& posicion) {
    if (!sensor.disponible()) return false;
    const auto estado = verificarPosicion(posicion);
    return estado == Verificacion::Libre || (estado == Verificacion::Coincide && sensor.borrar(posicion.numero));
  }

  void recuperar() {
    siguienteVerificacion = millis() + 2500;
    errorLocal = "El ESP32 está verificando la posición guardada. Sincroniza cuando el AS608 esté listo.";
    if (registro.version == REGISTRO_BORRADO) {
      if (sellarResultado(nullptr, 0)) errorLocal = nullptr;
      return;
    }
    if (!sensor.disponible()) return;
    size_t tamano;
    if (leerPlantillaGuardada(tamano)) {
      if (sellarResultado(nullptr, tamano)) errorLocal = nullptr;
    } else {
      const auto ocupacion = sensor.consultarPosicion(registro.posicion);
      if (fase == Fase::Recuperar && ocupacion == SensorHuellas::Ocupacion::Libre &&
          sellarResultado("captura_fallida", 0)) errorLocal = nullptr;
    }
  }

  const char* capturar() {
    if (!sensor.disponible()) return "lector_no_disponible";
    if (anterior.numero >= 0 && verificarPosicion(anterior) == Verificacion::Desconocida) {
      return "posicion_anterior_no_verificable";
    }
    if (operacion == Operacion::Borrar) {
      if (!tiempo(plazo) || !guardarRegistro(REGISTRO_BORRADO, anterior.numero, anterior.hash)) return "captura_fallida";
      fase = Fase::Recuperar;
      recuperar();
      return nullptr;
    }
    const int posicion = sensor.buscarPosicionLibre(plazo, anterior.numero);
    if (posicion == SensorHuellas::SIN_ESPACIO) return "sin_espacio";
    if (posicion == SensorHuellas::POSICIONES_DESCONOCIDAS) return "lector_no_disponible";
    size_t tamano;
    if (const char* motivo = sensor.capturar(plazo, plantilla, tamano, anterior.numero)) return motivo;
    uint8_t digest[32];
    if (!tiempo(plazo) || !hash(plantilla, tamano, digest) ||
        !guardarRegistro(REGISTRO_CAPTURA, posicion, digest)) return "captura_fallida";
    if (!sensor.guardar(posicion)) Serial.println("El sensor no confirmó la escritura. Se verificará la posición.");
    fase = Fase::Recuperar;
    recuperar();
    return nullptr;
  }

  void cerrar() {
    Posicion eliminar = retiro;
    if (!confirmada && registro.version == REGISTRO_CAPTURA) {
      eliminar.numero = registro.posicion;
      memcpy(eliminar.hash, registro.hash, sizeof(eliminar.hash));
    }
    if (eliminar.numero >= 0 && !retirarPosicion(eliminar)) {
      Serial.println("No se pudo retirar la posición. Se conserva para sincronizar de nuevo.");
      fase = faseAnterior;
      return;
    }
    if (registro.version != 0) {
      if (!memoria.remove(CLAVE_NVS) && memoria.isKey(CLAVE_NVS)) {
        fase = faseAnterior;
        return;
      }
    }
    Serial.println(confirmada ? "Cambio de huella sincronizado con Supabase." : "Solicitud cerrada.");
    registro = RegistroLocal{};
    idSolicitud = "";
    resultado = "";
    nonce = "";
    operacion = Operacion::Registrar;
    anterior = Posicion{};
    retiro = Posicion{};
    errorLocal = nullptr;
    memset(plantilla, 0, sizeof(plantilla));
    fase = Fase::Libre;
  }

public:
  RegistroWifi() : sensor(servidor) {}

  void iniciar() {
    Serial.begin(115200);
    if (strlen(CLAVE_LECTOR) != 64 || strspn(CLAVE_LECTOR, "0123456789abcdef") != 64 ||
        strcmp(WIFI_SSID, "NOMBRE_DE_TU_WIFI") == 0 || !strlen(WIFI_SSID)) {
      Serial.println("Completa el Wi-Fi y CLAVE_LECTOR al inicio del sketch.");
      return;
    }
    if (!hash(String("lector-wifi:v1:orden:") + CLAVE_LECTOR, claveOrden) ||
        !hash(String("lector-wifi:v1:resultado:") + CLAVE_LECTOR, claveResultado) ||
        !hash(String(ID_LECTOR) + "|" + CLAVE_LECTOR, hashLector) ||
        !memoria.begin("reg-wifi", false) || !cargarRegistro()) {
      Serial.println("No se pudo abrir el registro local. Conserva la posición y la configuración originales.");
      return;
    }

    sensor.iniciar(PIN_RX_AS608, PIN_TX_AS608, BAUD_AS608);
    delay(1000);
    Serial.println(sensor.disponible() ? "AS608 conectado." : "AS608 sin respuesta. Revisa UART y alimentación.");
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    servidor.on("/estado", HTTP_GET, [this] { informar(); });
    servidor.on("/orden", HTTP_POST, [this] { recibirOrden(); });
    servidor.on("/orden", HTTP_OPTIONS, [this] {
      cabeceras();
      servidor.send(204);
    });
    servidor.on("/estado", HTTP_OPTIONS, [this] {
      cabeceras();
      servidor.send(204);
    });
    servidor.onNotFound([this] { fallarHttp(404, "Ruta desconocida."); });
    servidor.begin();
    listo = true;
    Serial.println("Esperando conexión Wi-Fi.");
  }

  void atender() {
    if (!listo) { delay(1000); return; }
    if (WiFi.status() == WL_CONNECTED) {
      if (!ipMostrada) {
        ipMostrada = true;
        Serial.print("IP del lector: ");
        Serial.println(WiFi.localIP());
      }
      servidor.handleClient();
    } else {
      ipMostrada = false;
    }
    if (fase == Fase::Programada) {
      fase = Fase::Capturando;
      Serial.println("Solicitud recibida.");
      if (const char* motivo = capturar()) {
        if (!sellarResultado(motivo, 0)) {
          fase = Fase::Resultado;
          errorLocal = "El lector no pudo preparar el resultado cifrado.";
        }
      }
    } else if (fase == Fase::Recuperar && !tiempo(siguienteVerificacion)) {
      recuperar();
    } else if (fase == Fase::Cerrar) {
      cerrar();
    }
    delay(5);
  }
};

RegistroWifi registro;

void setup() {
  registro.iniciar();
}

void loop() {
  registro.atender();
}
