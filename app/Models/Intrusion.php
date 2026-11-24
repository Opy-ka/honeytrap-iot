<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Intrusion extends Model
{
    use HasFactory;

    protected $fillable = [
        'attacker_ip',
        'target_port',
        'raw_payload',
    ];
}
