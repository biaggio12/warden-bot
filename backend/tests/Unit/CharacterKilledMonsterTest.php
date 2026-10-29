<?php

namespace App\Tests\Unit;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\Monster;
use App\Entity\User;
use PHPUnit\Framework\TestCase;

final class CharacterKilledMonsterTest extends TestCase
{
    public function testBindsCharacterAndMonster(): void
    {
        $owner = new User('owner@example.com');
        $character = new Character($owner, 'Sir Tester', 'Monza');
        $monster = new Monster('Dragon Warden', 'Dragons', 50);
        $killedAt = new \DateTimeImmutable('2026-10-29 12:00:00');

        $kill = new CharacterKilledMonster($character, $monster, $killedAt);

        self::assertSame($character, $kill->getCharacter());
        self::assertSame($monster, $kill->getMonster());
        self::assertSame($killedAt, $kill->getKilledAt());
        self::assertSame($owner, $kill->getCharacter()->getUser());
    }

    public function testCharacterOwnership(): void
    {
        $owner = new User('owner@example.com');
        $stranger = new User('stranger@example.com');
        $character = new Character($owner, 'Sir Tester', 'Monza');

        self::assertTrue($character->isOwnedBy($owner));
        self::assertFalse($character->isOwnedBy($stranger));
    }
}
