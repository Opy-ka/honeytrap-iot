# Panduan Perakitan Hardware (Wiring Guide) — HoneyTrap IoT (Cyber-Physical Guard v2.1)

Dokumen ini merupakan panduan langkah demi langkah untuk merangkai komponen fisik **Cyber-Physical Server Room Guard** pada mikrokontroler **ESP32** sesuai dengan konfigurasi pin pada firmware [`esp32_honeytrap.ino`](file:///c:/laragon/www/honeytrap-iot/esp32_honeytrap/esp32_honeytrap.ino) dan simulasi Wokwi [`diagram.json`](file:///c:/laragon/www/honeytrap-iot/esp32_honeytrap/diagram.json).

---

## 1. Daftar Komponen yang Dibutuhkan (Bill of Materials)

| No | Nama Komponen | Jumlah | Spesifikasi / Peran di Sistem |
| :-: | :--- | :-: | :--- |
| 1 | **ESP32 Development Board** | 1 unit | ESP32-WROOM-32 (30 Pin atau 38 Pin) |
| 2 | **Breadboard** | 1 buah | Ukuran 400 titik atau 830 titik |
| 3 | **Sensor Gerak PIR (`HC-SR501`)** | 1 buah | **Deteksi Penyusup Fisik** di dekat Rak Server (Mode Online & Offline) |
| 4 | **Motor Servo (`SG90`)** | 1 buah | **Aktuator Mekanik Pengunci Pintu Rak Server** (`0°` Terbuka, `90°` Lockdown) |
| 5 | **Sensor Suhu (`DHT11` / `DHT22`)** | 1 buah | **Pemantau Suhu Rak Server** & Data Umpan Honeypot *(Opsional / Auto-Fallback)* |
| 6 | **LED Hijau, Kuning, Merah** | 3 buah | Indikator Status **SAFE (`D25`)**, **WARNING (`D26`)**, **CRITICAL (`D27`)** |
| 7 | **Resistor 220 Ω (atau 330 Ω)** | 3 buah | Pembatas arus untuk masing-masing LED |
| 8 | **Passive Buzzer** | 1 buah | Sirine alarm 2 nada (`2800 Hz` / `1800 Hz`) pada **`D14`** |
| 9 | **Kabel Jumper** | ~16 helai | Male-to-Male & Male-to-Female untuk menghubungkan sensor & aktuator |

> **Keunggulan Firmware v2.1:** Driver PWM untuk **Servo SG90** dan pembaca 1-Wire untuk **DHT11/DHT22** sudah ditulis *built-in* di dalam [`esp32_honeytrap.ino`](file:///c:/laragon/www/honeytrap-iot/esp32_honeytrap/esp32_honeytrap.ino), sehingga Anda **TIDAK PERLU meng-install library tambahan** di Arduino IDE!

---

## 2. Tabel Pemetaan Pin (Pinout Mapping Lengkap)

| Komponen | Pin Sinyal / Data | Pin VCC / Positif (+) | Pin GND / Negatif (-) | Fungsi pada Sistem |
| :--- | :--- | :--- | :--- | :--- |
| **Sensor Gerak PIR (`HC-SR501`)** | **`GPIO 32` (`D32`)** | **`VIN` (`5V`)** | **`GND`** | Mendeteksi gerakan penyusup fisik ➔ Memicu **CRITICAL + Servo Lockdown** |
| **Motor Servo (`SG90`)** | **`GPIO 13` (`D13`)** *(Kabel Oranye/Kuning)* | **`VIN` (`5V`)** *(Kabel Merah)* | **`GND`** *(Kabel Cokelat/Hitam)* | `0°` = Pintu Terbuka (`SAFE`), `90°` = Pintu Terkunci (`CRITICAL`) |
| **Sensor Suhu (`DHT11`/`DHT22`)** | **`GPIO 4` (`D4`)** | **`3V3` (`3.3V`)** | **`GND`** | Membaca suhu rak server (>35°C = `WARNING`) & mengisi banner jebakan |
| **LED Hijau** | **`GPIO 25` (`D25`)** *(via Resistor 220Ω)* | — | **`GND`** | Menyala terus saat jaringan & ruangan **SAFE** |
| **LED Kuning** | **`GPIO 26` (`D26`)** *(via Resistor 220Ω)* | — | **`GND`** | Menyala saat probe **Port 21/23** atau **Overheat Suhu > 35°C** |
| **LED Merah** | **`GPIO 27` (`D27`)** *(via Resistor 220Ω)* | — | **`GND`** | Berkedip cepat (250ms) saat serangan **Port 22/80** atau **Gerakan PIR** |
| **Passive Buzzer** | **`GPIO 14` (`D14`)** | — | **`GND`** | Beep 1x saat `WARNING`, Sirine 2 Nada saat `CRITICAL` |
| **Tombol Reset & Unlock** | **`GPIO 0` (`BOOT`)** | — | **`GND`** *(Internal)* | Mematikan sirine & membuka kembali kunci **Servo ke `0°`** |

---

## 3. Diagram Visual Tata Letak Kabel

```text
   +-----------------------------------+
   |            ESP32 BOARD            |
   |                                   |
   |  [D32] <---- (OUT) 🏃 SENSOR PIR  | (VCC -> VIN 5V,  GND -> GND)
   |  [D13] ----> (PWM) 🔒 SERVO SG90  | (V+  -> VIN 5V,  GND -> GND)
   |  [D4]  <---> (SDA) 🌡️ SENSOR DHT  | (VCC -> 3V3,     GND -> GND)
   |                                   |
   |  [D25] ----[220Ω]---> 🟢 LED HIJAU  (-) ---> GND
   |  [D26] ----[220Ω]---> 🟡 LED KUNING (-) ---> GND
   |  [D27] ----[220Ω]---> 🔴 LED MERAH  (-) ---> GND
   |  [D14] -------------> 🔊 BUZZER     (-) ---> GND
   |                                   |
   |  [BOOT (GPIO 0)]                  | <-- Tekan (atau klik "Unlock Servo" di Web) untuk buka Servo ke 0°
   +-----------------------------------+
```

---

## 4. Cara Merangkai 3 Komponen Baru

1. **Pasang Motor Servo (`SG90`) — Pengunci Rak Server:**
   * Servo memiliki 3 kabel yang menempel:
     * **Kabel Oranye / Kuning (Sinyal PWM)** ➔ hubungkan ke pin **`D13` (`GPIO 13`)**.
     * **Kabel Merah (`VCC / +`)** ➔ hubungkan ke jalur **`VIN` (5V)** ESP32.
     * **Kabel Cokelat / Hitam (`GND / -`)** ➔ hubungkan ke jalur **`GND`**.
2. **Pasang Sensor Gerak PIR (`HC-SR501`):**
   * Buka/lihat tulisan di bawah kubah putih PIR (atau di samping 3 kakinya):
     * **`VCC`** ➔ hubungkan ke jalur **`VIN` (5V)** ESP32.
     * **`OUT` (Kaki Tengah)** ➔ hubungkan ke pin **`D32` (`GPIO 32`)**.
     * **`GND`** ➔ hubungkan ke jalur **`GND`**.
3. **Pasang Sensor Suhu (`DHT11` / `DHT22`) — *Opsional*:**
   * **`VCC` (`+`)** ➔ hubungkan ke pin **`3V3`** ESP32.
   * **`DATA` / `OUT` / `SDA`** ➔ hubungkan ke pin **`D4` (`GPIO 4`)**.
   * **`GND` (`-`)** ➔ hubungkan ke jalur **`GND`**.
   * *(Catatan: Jika Anda belum memasang sensor DHT fisik, ESP32 akan otomatis mengenali bahwa pin `D4` kosong dan menggunakan mode Auto-Fallback `26.5°C` sehingga sistem tetap berjalan 100% normal).*

---

## 5. Skenario Uji Coba (Demo ke Dosen Penguji)

1. **Kondisi Awal (`SAFE`):**
   * Saat ESP32 baru dinyalakan, **LED Hijau menyala** dan **Servo otomatis bergerak ke posisi `0°` (`UNLOCKED`)**.
2. **Uji Deteksi Penyusup Fisik (`PIR Motion -> Auto-Lockdown`):**
   * Lambaikan tangan di depan **Sensor PIR (`D32`)**.
   * **Seketika di Edge (bahkan tanpa menunggu internet):** **Servo langsung berputar ke `90°` (`LOCKED`)**, **LED Merah berkedip**, dan **Sirine Buzzer berbunyi**!
   * ESP32 mengirim paket terenkripsi **ML-KEM-512 + ML-DSA-44 + AES-256-GCM** ke EMQX Cloud ➔ PQC Gateway ➔ Laravel.
   * Di **Dashboard Web**, layar berubah **Merah (`CRITICAL`)**, muncul badge **`🔒 Rack Servo: LOCKED (90°)`**, dan di tabel muncul **`PHYSICAL-PIR (:999 PIR Motion)`**.
3. **Uji Serangan Siber (`Port 22 SSH / Port 80 HTTP -> Auto-Lockdown`):**
   * Saat hacker menyerang Port 22 atau Port 80, **Servo juga otomatis mengunci ke `90°` (`LOCKED`)**.
4. **Uji Buka Kunci Jarak Jauh (`Remote Unlock`):**
   * Klik tombol **`Acknowledge & Unlock Servo`** di pojok kanan atas Dashboard Web.
   * Perintah `"SAFE"` dikirim lewat EMQX ke ESP32 ➔ **Servo langsung berputar kembali ke `0°` (`UNLOCKED`)**, Buzzer mati, dan LED Hijau menyala!
