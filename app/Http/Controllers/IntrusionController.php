<?php

namespace App\Http\Controllers;

use App\Models\Intrusion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class IntrusionController extends Controller
{
    // Akun Teknisi / Admin untuk Mode Perbaikan & Akses Log Forensik
    private array $authorizedUsers = [
        'admin'   => 'admin123',
        'teknisi' => 'server123',
        'gopi'    => '1234',
    ];

    public function index()
    {
        // Hanya tampilkan serangan honeypot & fisik (kecuali paket rutin suhu port 997)
        $intrusions = Intrusion::where('target_port', '!=', 997)
            ->orderBy('created_at', 'desc')
            ->take(100)
            ->get();

        return response()->json($intrusions, 200);
    }

    public function temperatures()
    {
        // Hapus otomatis data suhu yang lebih tua dari 3 jam terakhir
        DB::table('server_temperatures')
            ->where('created_at', '<', now()->subHours(3))
            ->delete();

        $temps = DB::table('server_temperatures')
            ->orderBy('created_at', 'desc')
            ->take(60)
            ->get();

        // Jika belum ada data suhu sama sekali, buat 1 sampel awal ruang server
        if ($temps->isEmpty()) {
            DB::table('server_temperatures')->insert([
                'temperature' => 26.5,
                'humidity'    => 54.0,
                'sensor_ip'   => '10.249.50.35',
                'created_at'  => now(),
                'updated_at'  => now(),
            ]);
            $temps = DB::table('server_temperatures')->orderBy('created_at', 'desc')->get();
        }

        return response()->json([
            'maintenance_mode' => (bool) Cache::get('honeytrap_maintenance_mode', false),
            'maintenance_user' => Cache::get('honeytrap_maintenance_user', null),
            'retention_policy' => '3 Hours Rolling Window',
            'latest'           => $temps->first(),
            'history_3h'       => $temps,
        ], 200);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'attacker_ip' => 'required|string',
            'target_port' => 'required|numeric',
            'raw_payload' => 'nullable|string',
            'sensor_ip'   => 'nullable|string',
        ]);

        $port = (int) $validated['target_port'];
        $payload = $validated['raw_payload'] ?? '';

        // 1. Ekstrak data suhu jika ada di dalam payload (format "TEMP:26.5|HUM:54.0" atau "[RackTemp:26.5C]")
        $extractedTemp = null;
        $extractedHum  = 54.0;
        if (preg_match('/TEMP:([0-9.]+)\|HUM:([0-9.]+)/i', $payload, $m)) {
            $extractedTemp = (float) $m[1];
            $extractedHum  = (float) $m[2];
        } elseif (preg_match('/Temp:\s*([0-9.]+)C/i', $payload, $m)) {
            $extractedTemp = (float) $m[1];
        }

        if ($extractedTemp !== null) {
            // Simpan suhu baru & bersihkan data suhu yang lewat dari 3 jam terakhir
            DB::table('server_temperatures')
                ->where('created_at', '<', now()->subHours(3))
                ->delete();

            DB::table('server_temperatures')->insert([
                'temperature' => $extractedTemp,
                'humidity'    => $extractedHum,
                'sensor_ip'   => $request->input('sensor_ip', $validated['attacker_ip']),
                'created_at'  => now(),
                'updated_at'  => now(),
            ]);
        }

        // Jika paket ini hanya laporan telemetri suhu rutin (Port 997), cukup simpan di tabel suhu 3 jam
        if ($port === 997) {
            return response()->json([
                'success' => true,
                'message' => 'Server room temperature logged (3-hour retention).',
            ], 201);
        }

        // 2. Jika Mode Perbaikan sedang AKTIF, abaikan trigger sensor gerak fisik PIR (Port 999)
        $isMaintenance = (bool) Cache::get('honeytrap_maintenance_mode', false);
        if ($isMaintenance && $port === 999) {
            return response()->json([
                'success' => true,
                'ignored' => true,
                'message' => 'PIR motion ignored because Server Room is in Maintenance Mode.',
            ], 200);
        }

        // 3. Simpan serangan Honeypot & Fisik ke tabel intrusions
        $intrusion = Intrusion::create([
            'attacker_ip' => $validated['attacker_ip'],
            'target_port' => $port,
            'raw_payload' => $payload,
        ]);

        $this->sendTelegramAlert($intrusion);

        return response()->json([
            'success' => true,
            'message' => 'Intrusion logged successfully.',
            'data'    => $intrusion
        ], 201);
    }

    public function toggleMaintenance(Request $request)
    {
        $username = trim((string) $request->input('username', ''));
        $password = (string) $request->input('password', '');
        $notes    = trim((string) $request->input('notes', 'Perbaikan rutin ruang server'));

        if (!isset($this->authorizedUsers[$username]) || $this->authorizedUsers[$username] !== $password) {
            return response()->json([
                'success' => false,
                'message' => 'Autentikasi gagal: Username atau Password teknisi salah!',
            ], 401);
        }

        $currentMode = (bool) Cache::get('honeytrap_maintenance_mode', false);
        $newMode     = !$currentMode;
        $action      = $newMode ? 'START_MAINTENANCE' : 'END_MAINTENANCE';

        if ($newMode) {
            Cache::put('honeytrap_maintenance_mode', true, now()->addHours(12));
            Cache::put('honeytrap_maintenance_user', $username, now()->addHours(12));
        } else {
            Cache::forget('honeytrap_maintenance_mode');
            Cache::forget('honeytrap_maintenance_user');
        }

        DB::table('maintenance_logs')->insert([
            'username'   => $username,
            'action'     => $action,
            'notes'      => $notes,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mqttCommand = $newMode ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF';

        // Kirim perintah langsung ke ESP32 melalui PQC Gateway -> EMQX Cloud
        try {
            Http::timeout(3)->post('http://127.0.0.1:3005/api/pqc/command', [
                'command' => $mqttCommand,
            ]);
        } catch (\Exception $e) {
            Log::warning('Gagal meneruskan perintah maintenance ke PQC Gateway: ' . $e->getMessage());
        }

        return response()->json([
            'success'          => true,
            'maintenance_mode' => $newMode,
            'maintenance_user' => $newMode ? $username : null,
            'action'           => $action,
            'mqtt_command'     => $mqttCommand,
            'message'          => $newMode
                ? "Mode Perbaikan AKTIF oleh {$username}. Sensor Gerak PIR dinonaktifkan sementara."
                : "Mode Perbaikan SELESAI oleh {$username}. Sensor Gerak PIR aktif kembali.",
        ], 200);
    }

    public function verifyAndGetLogs(Request $request)
    {
        $username = trim((string) $request->input('username', 'admin'));
        $password = (string) $request->input('password', '');

        // Cek password terhadap akun yang terdaftar
        $valid = false;
        if (isset($this->authorizedUsers[$username]) && $this->authorizedUsers[$username] === $password) {
            $valid = true;
        } else {
            // Izinkan juga jika hanya mengisi password yang cocok dengan salah satu akun
            foreach ($this->authorizedUsers as $u => $p) {
                if ($p === $password && $password !== '') {
                    $valid = true;
                    $username = $u;
                    break;
                }
            }
        }

        if (!$valid) {
            return response()->json([
                'success' => false,
                'message' => 'Password salah! Akses log forensik & perbaikan ditolak.',
            ], 401);
        }

        $maintenanceLogs = DB::table('maintenance_logs')
            ->orderBy('created_at', 'desc')
            ->take(100)
            ->get();

        $intrusions = Intrusion::where('target_port', '!=', 997)
            ->orderBy('created_at', 'desc')
            ->take(200)
            ->get();

        return response()->json([
            'success'          => true,
            'verified_user'    => $username,
            'maintenance_logs' => $maintenanceLogs,
            'intrusions'       => $intrusions,
        ], 200);
    }

    private function sendTelegramAlert(Intrusion $intrusion)
    {
        $botToken = env('TELEGRAM_BOT_TOKEN');
        $chatId   = env('TELEGRAM_CHAT_ID');

        if (!$botToken || !$chatId) {
            Log::warning('Telegram bot token or chat ID is not configured.');
            return;
        }

        $payloadText = $intrusion->raw_payload ?? 'N/A';
        $typeLabel = $intrusion->target_port == 999 ? "🏃 PHYSICAL PIR BREACH" : "🚨 HONEYTRAP CYBER ALERT";
        $message = "{$typeLabel}\n"
                 . "Source: {$intrusion->attacker_ip}\n"
                 . "Port/Sensor: {$intrusion->target_port}\n"
                 . "Detail: {$payloadText}";

        $url = "https://api.telegram.org/bot{$botToken}/sendMessage";

        try {
            Http::post($url, [
                'chat_id' => $chatId,
                'text'    => $message,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to send Telegram alert: ' . $e->getMessage());
        }
    }
}
