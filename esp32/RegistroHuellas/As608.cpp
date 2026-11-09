#include "As608.h"
#include <Adafruit_Fingerprint.h>

namespace {
Adafruit_Fingerprint sensor(&Serial2);
constexpr uint8_t LEER_INDICE = 0x1F;

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
int escanearPosiciones(uint32_t plazo, int objetivo = -1, As608::Ocupacion* ocupacion = nullptr) {
  descartarEntrada();
  if (sensor.getTemplateCount() != FINGERPRINT_OK) return As608::POSICIONES_DESCONOCIDAS;
  int libre = As608::SIN_ESPACIO;
  unsigned int legibles = 0;
  As608::Ocupacion resultado = As608::Ocupacion::Desconocida;
  for (uint32_t posicion = 0; posicion < sensor.capacity; posicion++) {
    if (!hayTiempo(plazo)) return As608::POSICIONES_DESCONOCIDAS;
    const uint8_t codigo = sensor.loadModel(posicion);
    if (codigo == FINGERPRINT_OK) {
      legibles++;
      if (static_cast<int>(posicion) == objetivo) resultado = As608::Ocupacion::Ocupada;
    } else if (codigo == FINGERPRINT_DBRANGEFAIL) {
      if (posicion != 0 && libre == As608::SIN_ESPACIO) libre = posicion;
      if (static_cast<int>(posicion) == objetivo) resultado = As608::Ocupacion::Libre;
    } else if (!(posicion == 0 && codigo == FINGERPRINT_BADLOCATION)) {
      Serial.printf("LoadChar devolvió 0x%02x en posición %lu.\n",
                    static_cast<unsigned>(codigo), static_cast<unsigned long>(posicion));
      return As608::POSICIONES_DESCONOCIDAS;
    }
  }
  if (legibles != sensor.templateCount) return As608::POSICIONES_DESCONOCIDAS;
  if (ocupacion) *ocupacion = resultado;
  return libre;
}

bool esperarDedo(bool presente, uint32_t plazo) {
  while (hayTiempo(plazo)) {
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
        tamano + paquete.tamano > As608::TAMANO_MAXIMO) return false;
    memcpy(plantilla + tamano, paquete.datos, paquete.tamano);
    tamano += paquete.tamano;
    if (paquete.tipo == FINGERPRINT_ENDDATAPACKET) return tamano >= 128;
  }
  return false;
}
}

void As608::iniciar(int pinRx, int pinTx, unsigned long baudios) {
  Serial2.setRxBufferSize(4096);
  Serial2.begin(baudios, SERIAL_8N1, pinRx, pinTx);
}

bool As608::disponible() {
  descartarEntrada();
  return sensor.verifyPassword() && sensor.getParameters() == FINGERPRINT_OK && sensor.capacity > 1;
}

int As608::buscarPosicionLibre(uint32_t plazo) {
  Paquete indice;
  for (uint32_t base = 0; base < sensor.capacity; base += 256) {
    if (!hayTiempo(plazo)) return POSICIONES_DESCONOCIDAS;
    if (!leerIndice(base / 256, indice)) {
      Serial.println("Índice AS608 no disponible. Comprobando posiciones mediante LoadChar.");
      return escanearPosiciones(plazo);
    }
    const uint32_t fin = min(base + 256, static_cast<uint32_t>(sensor.capacity));
    for (uint32_t posicion = base; posicion < fin; posicion++) {
      if (posicion == 0 || ocupadaEnIndice(indice, posicion)) continue;
      // Comprueba la posición con el lector antes de escribir.
      if (sensor.loadModel(posicion) == FINGERPRINT_DBRANGEFAIL) return posicion;
      return escanearPosiciones(plazo);
    }
  }
  return SIN_ESPACIO;
}

As608::Ocupacion As608::consultarPosicion(uint16_t posicion) {
  if (posicion == 0 || posicion >= sensor.capacity) return Ocupacion::Desconocida;
  Paquete indice;
  if (leerIndice(posicion / 256, indice)) {
    return ocupadaEnIndice(indice, posicion) ? Ocupacion::Ocupada : Ocupacion::Libre;
  }
  Ocupacion estado = Ocupacion::Desconocida;
  escanearPosiciones(millis() + 35000, posicion, &estado);
  return estado;
}

const char* As608::capturar(uint32_t plazo, uint8_t* plantilla, size_t& tamano) {
  Serial.println("Coloca el dedo en el AS608.");
  if (!esperarDedo(true, plazo) || sensor.image2Tz(1) != FINGERPRINT_OK) return "captura_fallida";
  const uint8_t busqueda = sensor.fingerSearch(1);
  if (busqueda == FINGERPRINT_OK) return "huella_duplicada";
  if (busqueda != FINGERPRINT_NOTFOUND && busqueda != FINGERPRINT_NOMATCH) return "lector_no_disponible";

  Serial.println("Retira el dedo.");
  if (!esperarDedo(false, plazo)) return "captura_fallida";
  Serial.println("Coloca otra vez el mismo dedo.");
  if (!esperarDedo(true, plazo) || sensor.image2Tz(2) != FINGERPRINT_OK ||
      sensor.createModel() != FINGERPRINT_OK || !hayTiempo(plazo)) return "captura_fallida";
  if (!exportarPlantilla(plantilla, tamano)) return "plantilla_no_exportable";
  return nullptr;
}

bool As608::guardar(uint16_t posicion) {
  return sensor.storeModel(posicion) == FINGERPRINT_OK;
}

bool As608::leer(uint16_t posicion, uint8_t* plantilla, size_t& tamano) {
  return sensor.loadModel(posicion) == FINGERPRINT_OK && exportarPlantilla(plantilla, tamano);
}

bool As608::borrar(uint16_t posicion) {
  return sensor.deleteModel(posicion) == FINGERPRINT_OK;
}
