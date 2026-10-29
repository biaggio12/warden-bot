<?php

namespace App\Enum;

enum WardenSpawnStatus: string
{
    case Active = 'ACTIVE';
    case Killed = 'KILLED';
    case Expired = 'EXPIRED';
}
