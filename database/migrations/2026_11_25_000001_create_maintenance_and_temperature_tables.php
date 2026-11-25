<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('server_temperatures', function (Blueprint $table) {
            $table->id();
            $table->float('temperature');
            $table->float('humidity')->nullable();
            $table->string('sensor_ip')->nullable();
            $table->timestamps();
        });

        Schema::create('maintenance_logs', function (Blueprint $table) {
            $table->id();
            $table->string('username');
            $table->string('action'); // START_MAINTENANCE | END_MAINTENANCE
            $table->string('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('server_temperatures');
        Schema::dropIfExists('maintenance_logs');
    }
};
