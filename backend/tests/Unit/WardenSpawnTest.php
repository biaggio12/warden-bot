<?php

namespace App\Tests\Unit;

use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Enum\WardenSpawnStatus;
use PHPUnit\Framework\TestCase;

final class WardenSpawnTest extends TestCase
{
    public function testExpiresAtIsCreatedAtPlusTtl(): void
    {
        $createdAt = new \DateTimeImmutable('2026-10-29T12:00:00Z');

        $spawn = new WardenSpawn(new Monster('Dragon Warden', 'Dragons', 50), 'Monza', 'Venore', new User('a@b.c'), 7, $createdAt);

        self::assertEquals(new \DateTimeImmutable('2026-10-29T12:07:00Z'), $spawn->getExpiresAt());
        self::assertSame(WardenSpawnStatus::Active, $spawn->getStatus());
    }
}
