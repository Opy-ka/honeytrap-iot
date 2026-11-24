# 🛡️ HoneyTrap IoT — Cyber-Physical Server Room Guard (PQC Edition)

Sistem Honeypot Jaringan & Keamanan Fisik Ruang Server berbasis **ESP32**, **EMQX Cloud (MQTT TLS)**, **Node-RED**, **Laravel 13**, dan **Next.js 16 (Frosted Glassmorphism Dashboard)** yang dilengkapi pengamanan transfer **Post-Quantum Cryptography (ML-KEM-512 + ML-DSA-44 + AES-256-GCM)** serta **Penguncian Rak Server Otomatis (PIR Motion + Servo Auto-Lockdown + DHT Thermal)**.

---

## 📁 Struktur Folder Proyek

```text
honeytrap-iot/
├── esp32_honeytrap/                  # Firmware Arduino IDE untuk ESP32
│   ├── esp32_honeytrap.ino           # Kode utama (Decoy Ports 21/22/23/80 + PIR + Servo + DHT + PQC)
│   ├── pqc_keys.h                    # Header kunci publik ML-KEM-512 & kunci privat ML-DSA-44
│   ├── diagram.json                  # File simulasi rangkaian untuk Wokwi
│   └── src/pqc/                      # Implementasi C murni PQClean (ML-KEM-512 & ML-DSA-44)
├── pqc-gateway/                      # Microservice Node.js Verifikasi & Dekripsi PQC (Port 3005)
│   ├── server.mjs                    # Endpoint POST /api/pqc/verify-decrypt -> teruskan ke Laravel
│   ├── keygen.mjs                    # Generator pasangan kunci baru (keys.json & pqc_keys.h)
│   └── keys.json                     # Pasangan kunci Server & ESP32
├── frontend/                         # Dashboard SOC Next.js 16 — Frosted Glassmorphism (Port 3000)
│   └── src/app/page.tsx              # Halaman utama dashboard, live telemetry, forensic & servo status
├── app/Http/Controllers/
│   └── IntrusionController.php       # Endpoint API Laravel (/api/honeypot/log & /api/honeypot/history)
├── nodered_honeytrap_flow.json       # File Flow Node-RED siap Import (EMQX <-> PQC Gateway <-> Web)
├── PANDUAN_PERAKITAN_HARDWARE.md     # Panduan merangkai kabel ESP32 (LED, Buzzer, PIR, Servo, DHT)
├── LAPORAN_PROYEK_HONEYTRAP_IOT.md   # Dokumentasi laporan lengkap proyek
└── prd.md                            # Product Requirements Document (PRD)
```

---

## 🚀 Panduan Setup untuk Teman Satu Tim (Setelah `git clone`)

Ikuti langkah ini satu kali saja setelah melakukan `git clone`:

### 1. Setup Backend Laravel (Port `8000`)
Di terminal folder utama (`honeytrap-iot/`):
```powershell
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate
```
*(Opsional: Isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` di dalam file `.env` jika ingin mengaktifkan notifikasi Telegram).*

### 2. Setup PQC Security Gateway (Port `3005`)
```powershell
cd pqc-gateway
npm install
cd ..
```
*(Catatan: File kunci `pqc-gateway/keys.json` dan `esp32_honeytrap/pqc_keys.h` sudah disertakan di repo ini agar langsung cocok dengan ESP32. Jangan jalankan `npm run keygen` kecuali ingin mengganti pasangan kunci baru).*

### 3. Setup Frontend Next.js (Port `3000`)
```powershell
cd frontend
npm install
cd ..
```

### 4. Setup Flow Node-RED (Port `1880`)
1. Jalankan `node-red` di terminal, lalu buka `http://127.0.0.1:1880`.
2. Klik menu **☰ (Pojok Kanan Atas) ➔ Import**.
3. Pilih file **`nodered_honeytrap_flow.json`** yang ada di folder utama proyek ini.
4. Klik 2x node ungu **EMQX**, pastikan username (`gopi`) & password (`1234`) sudah terisi di tab *Security*, lalu klik **Deploy**.

---

## ▶️ Cara Menjalankan Seluruh Sistem (4 Terminal)

Untuk menjalankan sistem secara penuh, buka 4 terminal:

1. **Terminal 1 — Laravel Backend API (`http://127.0.0.1:8000`):**
   ```powershell
   php artisan serve --host=127.0.0.1 --port=8000
   ```
2. **Terminal 2 — PQC Security Gateway (`http://127.0.0.1:3005`):**
   ```powershell
   cd pqc-gateway
   npm start
   ```
3. **Terminal 3 — Node-RED (`http://127.0.0.1:1880`):**
   ```powershell
   node-red
   ```
4. **Terminal 4 — Next.js SOC Dashboard (`http://localhost:3000`):**
   ```powershell
   cd frontend
   npm run dev
   ```

---

## 🔌 Firmware ESP32 & Rangkaian Hardware

* Buka file [`esp32_honeytrap/esp32_honeytrap.ino`](esp32_honeytrap/esp32_honeytrap.ino) langsung menggunakan **Arduino IDE**.
* Library yang dibutuhkan di Arduino IDE hanya: **`PubSubClient`** dan **`ArduinoJson`** *(driver Servo SG90, DHT11/22, dan PQC sudah built-in di dalam folder sketch!)*.
* Panduan pemasangan kabel ke Breadboard dapat dilihat di [`PANDUAN_PERAKITAN_HARDWARE.md`](PANDUAN_PERAKITAN_HARDWARE.md).
