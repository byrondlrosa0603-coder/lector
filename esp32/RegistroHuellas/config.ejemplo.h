#pragma once

// Copia este archivo como config.h y completa estos cinco valores.
constexpr char WIFI_SSID[] = "NOMBRE_DE_TU_WIFI";
constexpr char WIFI_PASSWORD[] = "CONTRASENA_DE_TU_WIFI";

// URL completa de la Edge Function lector-huellas.
constexpr char SUPABASE_URL_LECTOR[] = "https://TU_PROYECTO.supabase.co/functions/v1/lector-huellas";
// La misma clave pública que se configura en la app.
constexpr char SUPABASE_API_KEY_PUBLICA[] = "TU_PUBLIC_API_KEY";
// El valor original de clave_esp32 que devolvió el alta del lector.
constexpr char CLAVE_LECTOR[] = "TU_CLAVE_ESP32_DE_64_CARACTERES";

// Debe coincidir con dispositivo.identificador en Supabase.
constexpr char ID_LECTOR[] = "lector-01";

constexpr int PIN_RX_AS608 = 26; // GPIO26 recibe del TX del AS608.
constexpr int PIN_TX_AS608 = 27; // GPIO27 transmite al RX del AS608.
constexpr unsigned long BAUD_AS608 = 57600;
