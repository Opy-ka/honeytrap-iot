<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\IntrusionController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/honeypot/log', [IntrusionController::class, 'store']);
Route::get('/honeypot/history', [IntrusionController::class, 'index']);
Route::get('/honeypot/temperatures', [IntrusionController::class, 'temperatures']);
Route::post('/honeypot/maintenance', [IntrusionController::class, 'toggleMaintenance']);
Route::post('/honeypot/verify-logs', [IntrusionController::class, 'verifyAndGetLogs']);
