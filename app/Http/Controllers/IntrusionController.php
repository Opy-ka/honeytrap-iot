<?php

namespace App\Http\Controllers;

use App\Models\Intrusion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class IntrusionController extends Controller
{
    public function index()
    {
        $intrusions = Intrusion::orderBy('created_at', 'desc')->take(100)->get();
        return response()->json($intrusions, 200);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'attacker_ip' => 'required|string',
            'target_port' => 'required|numeric',
            'raw_payload' => 'nullable|string',
        ]);

        $intrusion = Intrusion::create($validated);
        $this->sendTelegramAlert($intrusion);

        return response()->json([
            'success' => true,
            'message' => 'Intrusion logged successfully.',
            'data'    => $intrusion
        ], 201);
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
        $message = "🚨 HONEYTRAP ALERT 🚨\n"
                 . "IP: {$intrusion->attacker_ip}\n"
                 . "Port: {$intrusion->target_port}\n"
                 . "Payload: {$payloadText}";

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
