<?php

namespace App\Tests\Functional;

use App\Entity\CharacterKilledMonster;
use App\Entity\User;
use App\Entity\WardenSpawn;

final class StatsApiTest extends ApiTestCase
{
    private function spawn(User $reporter, string $monsterName, string $ago, ?string $city = 'Venore', string $world = 'Monza'): void
    {
        static $monsters = [];
        $monsters[$monsterName] ??= $this->createMonster($monsterName);
        $this->em->persist(new WardenSpawn($monsters[$monsterName], $world, 'Somewhere', $reporter, 7, new \DateTimeImmutable($ago), $city));
        $this->em->flush();
    }

    public function testAggregatesLeaderboardAndOwnStats(): void
    {
        $me = $this->createUser('me@example.com');
        $rival = $this->createUser('rival@example.com', '777000');
        $rival->linkDiscord('777000', 'Rival');
        $quiet = $this->createUser('quiet@example.com');
        $this->createCharacter($me, 'My Knight');

        $this->spawn($me, 'Dragon', '-1 minute');
        $this->spawn($me, 'Dragon', '-2 days', 'Thais');
        $this->spawn($rival, 'Hydra', '-3 hours', null, 'Secura');
        $this->spawn($rival, 'Hydra', '-4 hours');
        $this->spawn($rival, 'Dragon', '-5 hours');
        $this->spawn($quiet, 'Hydra', '-20 days');

        $week = $this->requestJson('GET', '/api/v1/stats?period=7d', token: $this->tokenFor($me));

        self::assertResponseIsSuccessful();
        self::assertSame(['reports' => 5, 'reporters' => 2, 'monsters' => 2, 'active_now' => 1], $week['totals']);
        self::assertCount(7, $week['reports_per_day']);
        self::assertSame(5, array_sum(array_column($week['reports_per_day'], 'count')));
        self::assertSame([['label' => 'Dragon', 'count' => 3], ['label' => 'Hydra', 'count' => 2]], $week['top_monsters']);
        self::assertSame([['label' => 'Venore', 'count' => 3], ['label' => 'Thais', 'count' => 1]], $week['top_cities']);
        self::assertSame([
            ['rank' => 1, 'player' => 'Rival', 'reports' => 3, 'is_you' => false],
            ['rank' => 2, 'player' => 'me…', 'reports' => 2, 'is_you' => true],
        ], $week['leaderboard']);
        self::assertSame(2, $week['you']['rank']);
        self::assertSame(2, $week['you']['reports_all_time']);
        self::assertSame('My Knight', $week['you']['characters'][0]['name']);

        $all = $this->requestJson('GET', '/api/v1/stats?period=all', token: $this->tokenFor($me));
        self::assertSame(6, $all['totals']['reports']);
        self::assertCount(90, $all['reports_per_day']);
        self::assertSame('qu…', $all['leaderboard'][2]['player'], 'e-mail addresses are never shown in full');
    }

    public function testRanksCharactersByBestiaryProgress(): void
    {
        $me = $this->createUser('me@example.com');
        $rival = $this->createUser('rival@example.com');
        $mine = $this->createCharacter($me, 'My Knight');
        $theirs = $this->createCharacter($rival, 'Rival Druid', 'Secura');
        $this->createCharacter($rival, 'Empty Alt');
        $monsters = [$this->createMonster('Dragon'), $this->createMonster('Hydra'), $this->createMonster('Behemoth')];
        foreach ($monsters as $monster) {
            $this->em->persist(new CharacterKilledMonster($theirs, $monster, new \DateTimeImmutable('-1 year')));
        }
        $this->em->persist(new CharacterKilledMonster($mine, $monsters[0]));
        $this->em->flush();

        $stats = $this->requestJson('GET', '/api/v1/stats?period=7d', token: $this->tokenFor($me));

        self::assertSame([
            ['rank' => 1, 'character' => 'Rival Druid', 'server_name' => 'Secura', 'killed' => 3, 'total' => 3, 'is_you' => false],
            ['rank' => 2, 'character' => 'My Knight', 'server_name' => 'Monza', 'killed' => 1, 'total' => 3, 'is_you' => true],
        ], $stats['bestiary_leaderboard'], 'all-time progress, whatever the period; characters with nothing marked are left out');
    }

    public function testRejectsUnknownPeriodAndAnonymousUsers(): void
    {
        $this->requestJson('GET', '/api/v1/stats?period=year', token: $this->tokenFor($this->createUser()));
        self::assertResponseStatusCodeSame(400);

        $this->requestJson('GET', '/api/v1/stats');
        self::assertResponseStatusCodeSame(401);
    }
}
