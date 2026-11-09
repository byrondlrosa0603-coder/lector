#pragma once

#include <Arduino.h>

namespace As608 {
constexpr size_t TAMANO_MAXIMO = 2048;
constexpr int SIN_ESPACIO = -1;
constexpr int POSICIONES_DESCONOCIDAS = -2;

enum class Ocupacion { Libre, Ocupada, Desconocida };

void iniciar(int pinRx, int pinTx, unsigned long baudios);
bool disponible();
int buscarPosicionLibre(uint32_t plazo);
Ocupacion consultarPosicion(uint16_t posicion);
const char* capturar(uint32_t plazo, uint8_t* plantilla, size_t& tamano);
bool guardar(uint16_t posicion);
bool leer(uint16_t posicion, uint8_t* plantilla, size_t& tamano);
bool borrar(uint16_t posicion);
}
