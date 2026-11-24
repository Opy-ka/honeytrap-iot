/*
 * ============================================================================
 * HONEYTRAP IoT - CYBER-PHYSICAL SERVER ROOM GUARD FIRMWARE (v2.1 PQC)
 * ============================================================================
 * Fitur Utama:
 * 1. Cyber Decoy TCP Listeners + Dynamic Fake Banner Grabbing (Port 21, 22, 23, 80)
 * 2. Physical Security & Environmental Sensors (Edge Computing):
 *    - PIR Motion Sensor (GPIO 32) : Deteksi penyusup fisik (Offline/Online)
 *    - Servo Motor SG90  (GPIO 13) : Auto-Lockdown pintu rak server (0° -> 90°)
 *    - Sensor Suhu DHT   (GPIO 4)  : Telemetri suhu rak server + Overheat Alert (>35°C)
 *                                    (Dilengkapi Auto-Fallback jika DHT belum dipasang)
 * 3. Lapis 1 - Peringatan Fisik & Aktuator Otonom (LED Hijau/Kuning/Merah + Buzzer + Servo)
 * 4. End-to-End Post-Quantum Cryptography (ML-KEM-512 + ML-DSA-44 + AES-256-GCM)
 * 5. Watchdog Timer (esp_task_wdt) & Limitasi Socket anti-DoS / SYN Flood
 *
 * Catatan: Driver Servo & DHT sudah built-in di kode ini (TANPA perlu install library tambahan!)
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <esp_random.h>
#include <mbedtls/gcm.h>
#include <mbedtls/base64.h>
#include "pqc_keys.h"

extern "C" {
  #include "src/pqc/mlkem512/api.h"
  #include "src/pqc/mldsa44/api.h"
}

// ======================= 1. KONFIGURASI WIFI & EMQX =========================
const char* WIFI_SSID     = "Gopi_kunn";
const char* WIFI_PASSWORD = "donaldjapil2";

const char* MQTT_BROKER   = "c10481f8.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT     = 8883; // Port TLS EMQX Online
const char* MQTT_USERNAME = "gopi";
const char* MQTT_PASSWORD = "1234";

const char* TOPIC_INTRUSION = "honeytrap/intrusions";
const char* TOPIC_COMMAND   = "honeytrap/command"; // Untuk reset alarm & unlock servo dari Dashboard

// ======================= 2. KONFIGURASI PIN HARDWARE ========================
#define PIN_LED_GREEN   25   // Status AMAN (SAFE)
#define PIN_LED_YELLOW  26   // Status WASPADA (WARNING - Port 21/23 / Overheat DHT)
#define PIN_LED_RED     27   // Status KRITIS (CRITICAL - Port 22/80 / Gerakan PIR)
#define PIN_BUZZER      14   // Passive Buzzer Aktif saat WARNING/CRITICAL
#define PIN_BTN_RESET   0    // Tombol BOOT di board ESP32 untuk matikan alarm & buka kunci servo

// Pin Tambahan Cyber-Physical Guard
#define PIN_PIR         32   // Input Digital Sensor Gerak PIR (HC-SR501)
#define PIN_SERVO       13   // Output PWM Motor Servo Pengunci Rak Server (SG90)
#define PIN_DHT         4    // Pin Data Sensor Suhu DHT11 / DHT22 (Opsional / Auto-Fallback)

#define TEMP_WARNING_THRESHOLD 35.0 // Suhu rak server > 35°C memicu WARNING

// ======================= 3. KONFIGURASI KEAMANAN & WDT ======================
#define WDT_TIMEOUT_SEC 15   // Reboot otomatis jika sistem hang > 15 detik
#define MAX_CLIENTS     3    // Batas koneksi simultan sesuai PRD Bab 5

// ======================= 4. DECOY SERVERS (PORT JEBAKAN) ====================
WiFiServer ftpServer(21, MAX_CLIENTS);
WiFiServer sshServer(22, MAX_CLIENTS);
WiFiServer telnetServer(23, MAX_CLIENTS);
WiFiServer httpServer(80, MAX_CLIENTS);

WiFiClientSecure espTlsClient;
PubSubClient mqttClient(espTlsClient);

// State Alarm & Kunci Fisik Lokal (0 = SAFE/UNLOCKED, 1 = WARNING, 2 = CRITICAL/LOCKED)
int currentAlarmState = -1;
int currentServoAngle = -1;
unsigned long lastBlinkTime = 0;
bool redBlinkState = false;

// State Sensor PIR & DHT
unsigned long lastPirTriggerTime = 0;
unsigned long lastDhtReadTime = 0;
unsigned long lastThermalAlertTime = 0;
float rackTempC = 26.5;
float rackHumidity = 54.0;
bool dhtHardwareDetected = false;

// ============================================================================
// DRIVER SERVO BUILT-IN (TANPA LIBRARY TAMBAHAN & BEBAS KONFLIK TIMER BUZZER)
// Sudut 0° = UNLOCKED (Pintu Terbuka), Sudut 90° = LOCKED (Auto-Lockdown)
// ============================================================================
void moveServoAngle(int angle) {
  if (angle == currentServoAngle) return;
  currentServoAngle = angle;

  // Konversi sudut (0-180) ke lebar pulsa mikrodetik (544us - 2400us)
  int pulseWidthUs = map(constrain(angle, 0, 180), 0, 180, 544, 2400);
  Serial.printf("[SERVO] Menggerakkan Kunci Mekanik Rak Server ke %d derajat (%s)\n",
                angle, angle >= 90 ? "LOCKED / TERKUNCI" : "UNLOCKED / TERBUKA");

  // Kirim 22 pulsa PWM 50Hz (20ms periode) agar tuas servo mencapai posisi target dengan kuat
  for (int i = 0; i < 22; i++) {
    digitalWrite(PIN_SERVO, HIGH);
    delayMicroseconds(pulseWidthUs);
    digitalWrite(PIN_SERVO, LOW);
    delay(20 - (pulseWidthUs / 1000));
    esp_task_wdt_reset();
  }
}

// ============================================================================
// DRIVER DHT11/DHT22 BUILT-IN DENGAN AUTO-FALLBACK
// Jika sensor fisik DHT dipasang di D4 -> baca suhu asli. Jika tidak -> simulasi suhu stabil.
// ============================================================================
void updateRackTemperature() {
  uint8_t data[5] = {0, 0, 0, 0, 0};

  pinMode(PIN_DHT, INPUT_PULLUP);
  delayMicroseconds(50);

  // Kirim sinyal start LOW 18ms
  pinMode(PIN_DHT, OUTPUT);
  digitalWrite(PIN_DHT, LOW);
  delay(18);
  digitalWrite(PIN_DHT, HIGH);
  delayMicroseconds(30);
  pinMode(PIN_DHT, INPUT_PULLUP);

  // Tunggu respons LOW dari DHT (maks 100us). Jika tidak ada respons -> DHT tidak dicolok
  unsigned long t0 = micros();
  while (digitalRead(PIN_DHT) == HIGH) {
    if (micros() - t0 > 100) {
      dhtHardwareDetected = false;
      // Variasi mikro alami agar banner tetap realistis meskipun tanpa modul DHT fisik
      rackTempC = 26.4 + ((random(-3, 4)) * 0.1);
      rackHumidity = 54.0 + ((random(-5, 6)) * 0.1);
      return;
    }
  }

  // Lewati fase LOW (80us) dan HIGH (80us) pembuka dari DHT
  t0 = micros();
  while (digitalRead(PIN_DHT) == LOW)  { if (micros() - t0 > 120) return; }
  t0 = micros();
  while (digitalRead(PIN_DHT) == HIGH) { if (micros() - t0 > 120) return; }

  // Baca 40 bit data
  for (int i = 0; i < 40; i++) {
    t0 = micros();
    while (digitalRead(PIN_DHT) == LOW) { if (micros() - t0 > 100) return; }
    unsigned long highStart = micros();
    while (digitalRead(PIN_DHT) == HIGH) { if (micros() - highStart > 120) return; }
    if ((micros() - highStart) > 40) {
      data[i / 8] |= (1 << (7 - (i % 8)));
    }
  }

  // Verifikasi checksum 8-bit
  if (data[4] == ((data[0] + data[1] + data[2] + data[3]) & 0xFF) && (data[0] > 0 || data[2] > 0)) {
    dhtHardwareDetected = true;
    // Deteksi otomatis format DHT11 vs DHT22
    if (data[1] == 0 && data[3] < 10 && data[2] < 60) {
      rackHumidity = data[0] + (data[1] * 0.1);
      rackTempC    = data[2] + (data[3] * 0.1);
    } else {
      rackHumidity = ((data[0] << 8) | data[1]) * 0.1;
      int16_t rawT = ((data[2] & 0x7F) << 8) | data[3];
      if (data[2] & 0x80) rawT = -rawT;
      rackTempC = rawT * 0.1;
    }
  }
}

// ============================================================================
// FUNGSI KONTROL ALARM FISIK & SERVO LOCKDOWN (LAPIS 1 - EDGE COMPUTING)
// ============================================================================
void setAlarmState(int state) {
  // Jangan turunkan level alarm dari CRITICAL ke WARNING sebelum di-reset
  if (state < currentAlarmState && state != 0) return;
  currentAlarmState = state;

  if (currentAlarmState == 0) {
    // SAFE: LED Hijau menyala, Buzzer mati, Servo UNLOCKED (0 derajat)
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, LOW);
    noTone(PIN_BUZZER);
    digitalWrite(PIN_BUZZER, LOW);
    moveServoAngle(0); // Buka kunci rak server
    Serial.println("[ALARM] Status AMAN (SAFE) -> Kunci Servo Terbuka (0 deg).");
  } 
  else if (currentAlarmState == 1) {
    // WARNING: LED Kuning menyala + 1x Beep pendek
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
    tone(PIN_BUZZER, 1800, 150);
    Serial.println("[ALARM] Status WASPADA (WARNING) - LED Kuning Aktif!");
  } 
  else if (currentAlarmState == 2) {
    // CRITICAL: LED Merah berkedip + Sirine Buzzer + Servo AUTO-LOCKDOWN (90 derajat)
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    moveServoAngle(90); // Kunci pintu rak server seketika di Edge!
    Serial.println("[ALARM] Status KRITIS (CRITICAL) - LED Merah, Buzzer & SERVO LOCKDOWN (90 deg) Aktif!");
  }
}

void handleCriticalBlink() {
  if (currentAlarmState == 2) {
    if (millis() - lastBlinkTime >= 250) {
      lastBlinkTime = millis();
      redBlinkState = !redBlinkState;
      digitalWrite(PIN_LED_RED, redBlinkState ? HIGH : LOW);
      if (redBlinkState) {
        tone(PIN_BUZZER, 2800);
      } else {
        tone(PIN_BUZZER, 1800);
      }
    }
  }
}

// ============================================================================
// CALLBACK MQTT (TERIMA PERINTAH RESET & UNLOCK SERVO DARI DASHBOARD)
// ============================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.printf("[MQTT IN] Topik: %s | Pesan: %s\n", topic, message.c_str());

  if (message.indexOf("SAFE") >= 0 || message.indexOf("RESET") >= 0 || message.indexOf("UNLOCK") >= 0) {
    setAlarmState(0);
  }
}

// ============================================================================
// FUNGSI PQC: ENKRIPSI & TANDA TANGAN (ML-KEM-512 + AES-256-GCM + ML-DSA-44)
// Dijalankan di FreeRTOS Task terpisah (stack 56 KB) agar aman dari Stack Overflow
// ============================================================================
struct PqcJob {
  String plaintextJson;
  String outEnvelope;
  bool success;
  SemaphoreHandle_t doneSem;
};

String toBase64(const uint8_t* data, size_t len) {
  size_t outLen = 0;
  mbedtls_base64_encode(NULL, 0, &outLen, data, len);
  char* buf = (char*)malloc(outLen + 1);
  if (!buf) return "";
  mbedtls_base64_encode((unsigned char*)buf, outLen, &outLen, data, len);
  buf[outLen] = '\0';
  String res(buf);
  free(buf);
  return res;
}

void pqcWorkerTask(void* param) {
  PqcJob* job = (PqcJob*)param;
  job->success = false;

  // 1. ML-KEM-512 Encapsulate -> menghasilkan kem_ct (768B) & shared_secret (32B)
  uint8_t kem_ct[PQCLEAN_MLKEM512_CLEAN_CRYPTO_CIPHERTEXTBYTES];
  uint8_t shared_secret[PQCLEAN_MLKEM512_CLEAN_CRYPTO_BYTES];
  if (PQCLEAN_MLKEM512_CLEAN_crypto_kem_enc(kem_ct, shared_secret, SERVER_KEM_PUBLIC_KEY) != 0) {
    xSemaphoreGive(job->doneSem);
    vTaskDelete(NULL);
    return;
  }

  // 2. AES-256-GCM Encrypt -> menggunakan shared_secret sebagai kunci 256-bit
  uint8_t iv[12];
  esp_fill_random(iv, sizeof(iv));
  size_t ptLen = job->plaintextJson.length();
  uint8_t* aes_ct = (uint8_t*)malloc(ptLen > 0 ? ptLen : 1);
  uint8_t tag[16];

  if (!aes_ct) {
    xSemaphoreGive(job->doneSem);
    vTaskDelete(NULL);
    return;
  }

  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, shared_secret, 256);
  int gcmRc = mbedtls_gcm_crypt_and_tag(
    &gcm, MBEDTLS_GCM_ENCRYPT, ptLen,
    iv, sizeof(iv), NULL, 0,
    (const unsigned char*)job->plaintextJson.c_str(), aes_ct,
    sizeof(tag), tag
  );
  mbedtls_gcm_free(&gcm);

  if (gcmRc != 0) {
    free(aes_ct);
    xSemaphoreGive(job->doneSem);
    vTaskDelete(NULL);
    return;
  }

  // 3. ML-DSA-44 Sign -> menandatangani (kem_ct || iv || aes_ct || tag)
  size_t msgLen = sizeof(kem_ct) + sizeof(iv) + ptLen + sizeof(tag);
  uint8_t* msgToSign = (uint8_t*)malloc(msgLen);
  uint8_t sig[PQCLEAN_MLDSA44_CLEAN_CRYPTO_BYTES];
  size_t sigLen = 0;

  if (!msgToSign) {
    free(aes_ct);
    xSemaphoreGive(job->doneSem);
    vTaskDelete(NULL);
    return;
  }

  size_t offset = 0;
  memcpy(msgToSign + offset, kem_ct, sizeof(kem_ct)); offset += sizeof(kem_ct);
  memcpy(msgToSign + offset, iv, sizeof(iv));         offset += sizeof(iv);
  memcpy(msgToSign + offset, aes_ct, ptLen);          offset += ptLen;
  memcpy(msgToSign + offset, tag, sizeof(tag));

  int dsaRc = PQCLEAN_MLDSA44_CLEAN_crypto_sign_signature(
    sig, &sigLen, msgToSign, msgLen, ESP32_DSA_SECRET_KEY
  );
  free(msgToSign);

  if (dsaRc == 0) {
    // 4. Bungkus ke JSON Envelope Base64
    job->outEnvelope = "{";
    job->outEnvelope += "\"pqc\":\"ML-KEM-512+ML-DSA-44+AES-256-GCM\",";
    job->outEnvelope += "\"kem_ct\":\"" + toBase64(kem_ct, sizeof(kem_ct)) + "\",";
    job->outEnvelope += "\"iv\":\"" + toBase64(iv, sizeof(iv)) + "\",";
    job->outEnvelope += "\"aes_ct\":\"" + toBase64(aes_ct, ptLen) + "\",";
    job->outEnvelope += "\"tag\":\"" + toBase64(tag, sizeof(tag)) + "\",";
    job->outEnvelope += "\"sig\":\"" + toBase64(sig, sigLen) + "\"";
    job->outEnvelope += "}";
    job->success = true;
  }

  free(aes_ct);
  xSemaphoreGive(job->doneSem);
  vTaskDelete(NULL);
}

// ============================================================================
// FUNGSI PUBLISH KE EMQX ONLINE (TERENKRIPSI PQC)
// ============================================================================
void publishIntrusion(String attackerIp, int targetPort, String rawPayload) {
  rawPayload.replace("\r", " ");
  rawPayload.replace("\n", " ");
  rawPayload.trim();
  if (rawPayload.length() == 0) {
    rawPayload = "TCP SYN / Connection Probe (No Payload)";
  }
  if (rawPayload.length() > 180) {
    rawPayload = rawPayload.substring(0, 180) + "...";
  }

  // Keputusan Otonom di Edge (Lapis 1: LED + Buzzer + Servo Lockdown)
  // Port 22 (SSH), Port 80 (HTTP), atau Port 999 (Sensor Gerak Fisik PIR) -> CRITICAL + SERVO LOCK
  if (targetPort == 22 || targetPort == 80 || targetPort == 999) {
    setAlarmState(2); // CRITICAL + AUTO-LOCKDOWN SERVO 90° (Tetap bekerja meski offline!)
  } else {
    setAlarmState(1); // WARNING (Port 21 / 23 / 998 Overheat DHT)
  }

  // Buat JSON asli sebelum dienkripsi
  StaticJsonDocument<384> doc;
  doc["attacker_ip"] = attackerIp;
  doc["target_port"] = targetPort;
  doc["raw_payload"] = rawPayload;
  doc["sensor_ip"]   = WiFi.localIP().toString();

  String plainJson;
  serializeJson(doc, plainJson);

  Serial.printf("[INTRUSION] %s -> Port %d | Payload: %s\n",
                attackerIp.c_str(), targetPort, rawPayload.c_str());

  if (!mqttClient.connected()) {
    Serial.println("[EDGE MODE] Broker offline — Alarm fisik & Penguncian Servo tetap aktif di lokasi!");
    return;
  }

  // Jalankan enkripsi ML-KEM-512 + AES-256-GCM + ML-DSA-44 di FreeRTOS Task
  Serial.printf("[PQC] Mengenkripsi & menandatangani paket (Free heap: %u bytes)...\n", ESP.getFreeHeap());
  PqcJob job;
  job.plaintextJson = plainJson;
  job.success = false;
  job.doneSem = xSemaphoreCreateBinary();

  BaseType_t created = xTaskCreate(pqcWorkerTask, "pqc_task", 57344, &job, 1, NULL);
  if (created == pdPASS) {
    while (xSemaphoreTake(job.doneSem, pdMS_TO_TICKS(100)) != pdTRUE) {
      esp_task_wdt_reset();
    }
  }
  vSemaphoreDelete(job.doneSem);

  if (job.success) {
    bool ok = mqttClient.publish(TOPIC_INTRUSION, job.outEnvelope.c_str());
    Serial.printf("[MQTT+PQC] Terkirim (%u bytes): %s\n",
                  job.outEnvelope.length(), ok ? "SUKSES!" : "GAGAL!");
  } else {
    Serial.println("[PQC] Gagal membuat amplop PQC (cek memori heap).");
  }
}

// ============================================================================
// PEMANTAUAN SENSOR FISIK (PIR MOTION & SUHU RAK SERVER)
// ============================================================================
void checkPhysicalSensors() {
  // 1. Baca suhu rak server setiap 5 detik
  if (millis() - lastDhtReadTime > 5000) {
    lastDhtReadTime = millis();
    updateRackTemperature();

    // Jika suhu rak server melebihi 35°C (dan sudah lewat cooldown 20 detik)
    if (dhtHardwareDetected && rackTempC >= TEMP_WARNING_THRESHOLD && (millis() - lastThermalAlertTime > 20000)) {
      lastThermalAlertTime = millis();
      String thermalMsg = "THERMAL ANOMALY: Suhu Rak Server mencapai " + String(rackTempC, 1) +
                          "C (RH: " + String(rackHumidity, 0) + "%)";
      publishIntrusion("SENSOR-DHT", 998, thermalMsg);
    }
  }

  // 2. Cek Sensor Gerak PIR (GPIO 32) dengan cooldown 8 detik agar tidak spam
  // (Abaikan 5 detik pertama saat boot untuk kalibrasi awal sensor PIR)
  if (millis() > 5000 && digitalRead(PIN_PIR) == HIGH && (millis() - lastPirTriggerTime > 8000)) {
    lastPirTriggerTime = millis();
    Serial.println("\n[PHYSICAL BREACH] Sensor Gerak PIR mendeteksi penyusup di dekat Rak Server!");
    String pirMsg = "PHYSICAL BREACH: Motion detected at Server Rack -> Servo LOCKED [90 deg] | Temp: " +
                    String(rackTempC, 1) + "C";
    publishIntrusion("PHYSICAL-PIR", 999, pirMsg);
  }
}

// ============================================================================
// HANDLER KONEKSI PENYERANG PADA TIAP PORT JEBAKAN
// ============================================================================
void handleDecoyClient(WiFiServer &server, int port, const char* fakeBanner, const char* fakeReply) {
  WiFiClient client = server.available();
  if (!client) return;

  String attackerIp = client.remoteIP().toString();
  Serial.printf("\n[DECOY] Koneksi masuk dari %s ke Port %d\n", attackerIp.c_str(), port);

  if (strlen(fakeBanner) > 0) {
    client.print(fakeBanner);
  }

  unsigned long startWait = millis();
  String capturedPayload = "";
  while (client.connected() && (millis() - startWait < 1500)) {
    esp_task_wdt_reset();
    while (client.available()) {
      char c = client.read();
      if (capturedPayload.length() < 200) {
        capturedPayload += c;
      }
    }
    if (capturedPayload.indexOf('\n') >= 0) break;
    delay(10);
  }

  if (strlen(fakeReply) > 0) {
    client.print(fakeReply);
  }
  delay(50);
  client.stop();

  // Tambahkan konteks status fisik rak server pada log telemetri
  String enrichedPayload = capturedPayload + " [RackTemp:" + String(rackTempC, 1) + "C]";
  publishIntrusion(attackerIp, port, enrichedPayload);
}

// ============================================================================
// KONEKSI WIFI & RECONNECT EMQX
// ============================================================================
void setupWiFi() {
  Serial.printf("\n[WIFI] Menghubungkan ke %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt < 12000)) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
    // Tetap pantau sensor gerak PIR meski Wi-Fi sedang putus/mencari sinyal (Edge Offline Mode)
    if (millis() > 5000 && digitalRead(PIN_PIR) == HIGH && currentAlarmState < 2) {
      Serial.println("\n[OFFLINE GUARD] Penyusup fisik terdeteksi saat offline! Mengunci Servo!");
      setAlarmState(2);
    }
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Terhubung!");
    Serial.print("[WIFI] IP Honeypot ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Belum terhubung — Berjalan dalam Mode Edge Offline (PIR + Servo Aktif).");
  }
}

void reconnectMQTT() {
  if (mqttClient.connected() || WiFi.status() != WL_CONNECTED) return;

  Serial.print("[MQTT] Menghubungkan ke EMQX Online...");
  String clientId = "HoneyTrap-ESP32-" + String(random(0xffff), HEX);

  if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println(" TERHUBUNG!");
    mqttClient.subscribe(TOPIC_COMMAND);
  } else {
    Serial.printf(" GAGAL (rc=%d). Coba lagi dalam 3 detik.\n", mqttClient.state());
  }
}

// ============================================================================
// SETUP & LOOP UTAMA
// ============================================================================
void setup() {
  Serial.begin(115200);

  // Inisialisasi Pin Aktuator & Sensor Fisik
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_SERVO, OUTPUT);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_BTN_RESET, INPUT_PULLUP);

  // Inisialisasi Watchdog Timer (Sesuai PRD Bab 5)
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    esp_task_wdt_config_t wdt_config = {
      .timeout_ms = WDT_TIMEOUT_SEC * 1000,
      .idle_core_mask = 0,
      .trigger_panic = true
    };
    esp_task_wdt_reconfigure(&wdt_config);
  #else
    esp_task_wdt_init(WDT_TIMEOUT_SEC, true);
  #endif
  esp_task_wdt_add(NULL);

  setAlarmState(0); // Mulai dalam kondisi SAFE (LED Hijau & Servo 0° UNLOCKED)
  updateRackTemperature();

  setupWiFi();

  espTlsClient.setInsecure();
  espTlsClient.setTimeout(5);
  mqttClient.setBufferSize(8192);
  mqttClient.setSocketTimeout(5);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  ftpServer.begin();
  sshServer.begin();
  telnetServer.begin();
  httpServer.begin();

  Serial.println("[HONEYTRAP] Cyber-Physical Guard Aktif (Port 21, 22, 23, 80 + PIR D32 + Servo D13 + DHT D4).");
}

unsigned long lastMqttRetry = 0;

void loop() {
  // 1. Reset Watchdog Timer di setiap siklus loop
  esp_task_wdt_reset();

  // 2. Cek tombol fisik BOOT di ESP32 untuk mematikan alarm & membuka kunci servo secara manual
  if (digitalRead(PIN_BTN_RESET) == LOW) {
    setAlarmState(0);
    delay(300);
  }

  // 3. Pantau Sensor Fisik (Gerakan PIR & Suhu Rak Server DHT) di Edge
  checkPhysicalSensors();

  // 4. Jaga koneksi Wi-Fi & EMQX Online
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastMqttRetry > 10000) {
      lastMqttRetry = millis();
      setupWiFi();
    }
  } else if (!mqttClient.connected()) {
    if (millis() - lastMqttRetry > 3000) {
      lastMqttRetry = millis();
      reconnectMQTT();
    }
  } else {
    mqttClient.loop();
  }

  // 5. Jalankan animasi kedip LED Merah + Sirine Buzzer jika status CRITICAL
  handleCriticalBlink();

  // 6. Pantau keempat Port Jebakan dengan Banner Umpan HVAC Ruang Server
  handleDecoyClient(
    ftpServer, 21,
    "220 (vsFTPd 3.0.3 - ServerRack-Telemetry-Node)\r\n",
    "530 Login incorrect.\r\n"
  );

  handleDecoyClient(
    sshServer, 22,
    "SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.5\r\n",
    "Permission denied (publickey,password).\r\n"
  );

  String telnetBanner = "Ubuntu 20.04.6 LTS [Rack HVAC Node | Temp: " + String(rackTempC, 1) +
                        "C | Lock: " + String(currentServoAngle >= 90 ? "LOCKED" : "OPEN") +
                        "]\r\nhoneytrap-iot login: ";
  handleDecoyClient(
    telnetServer, 23,
    telnetBanner.c_str(),
    "\r\nLogin incorrect\r\n"
  );

  handleDecoyClient(
    httpServer, 80,
    "",
    "HTTP/1.1 401 Unauthorized\r\nServer: Apache/2.4.41 (Ubuntu-RackGuard)\r\nWWW-Authenticate: Basic realm=\"Server Room HVAC & Lock Controller\"\r\nContent-Length: 0\r\n\r\n"
  );

  delay(5);
}
