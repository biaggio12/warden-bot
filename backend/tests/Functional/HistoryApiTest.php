<?php

namespace App\Tests\Functional;

use App\Entity\Monster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;

final class HistoryApiTest extends ApiTestCase
{
    /** @var array<string, Monster> */
    private array $monsters = [];

    /** Created oldest first: report ids (UUIDv7) follow the order they are made in. */
    private function spawn(User $reporter, string $monster, string $ago, string $world = 'Monza', bool $killed = false): WardenSpawn
    {
        $this->monsters[$monster] ??= $this->createMonster($monster);
        $spawn = new WardenSpawn($this->monsters[$monster], $world, 'Somewhere', $reporter, 8, new \DateTimeImmutable($ago), 'Thais');
        if ($killed) {
            $spawn->markKilled();
        }
        $this->em->persist($spawn);
        $this->em->flush();

        return $spawn;
    }

    public function testListsPastReportsNewestFirstPageByPage(): void
    {
        $me = $this->createUser('me@example.com');
        $me->linkDiscord('555000', 'meDiscord');
        $this->createCharacter($me, 'My Knight');
        $old = $this->spawn($me, 'Dragon', '-3 days', killed: true);
        $this->spawn($me, 'Hydra', '-2 days', 'Antica');
        $recent = $this->spawn($me, 'Hydra', '-1 hour');
        $presence = new WardenSpawnPresence($recent, '123456789012345678', new \DateTimeImmutable());
        $presence->replace(['100000000000000001', '100000000000000002'], ['100000000000000002', '100000000000000003'], new \DateTimeImmutable());
        $this->em->persist($presence);
        $this->em->flush();
        $token = $this->tokenFor($me);

        $first = $this->requestJson('GET', '/api/v1/warden-spawns/history?server_name=Monza', token: $token);

        self::assertResponseIsSuccessful();
        self::assertSame([$recent->getId()->toRfc4122(), $old->getId()->toRfc4122()], array_column($first['warden_spawns'], 'id'));
        self::assertSame('EXPIRED', $first['warden_spawns'][0]['status'], 'overdue reports show as expired');
        self::assertSame(3, $first['warden_spawns'][0]['responded'], 'three players went, counted once each');
        self::assertSame(['characters' => ['My Knight'], 'discord_name' => 'meDiscord'], $first['warden_spawns'][0]['reported_by']);
        self::assertSame('KILLED', $first['warden_spawns'][1]['status']);
        self::assertNull($first['next_before']);

        $all = $this->requestJson('GET', '/api/v1/warden-spawns/history', token: $token);
        self::assertCount(3, $all['warden_spawns']);
        $hydras = $this->requestJson('GET', '/api/v1/warden-spawns/history?monster_id='.$this->monsters['Hydra']->getId(), token: $token);
        self::assertCount(2, $hydras['warden_spawns']);

        $this->requestJson('GET', '/api/v1/warden-spawns/history?before=nope', token: $token);
        self::assertResponseStatusCodeSame(400);
    }

    public function testPagesWithTheIdOfTheLastReport(): void
    {
        $me = $this->createUser();
        for ($i = 35; $i >= 1; --$i) {
            $this->spawn($me, 'Dragon', "-$i hours");
        }
        $token = $this->tokenFor($me);

        $first = $this->requestJson('GET', '/api/v1/warden-spawns/history', token: $token);
        self::assertCount(30, $first['warden_spawns']);
        self::assertNotNull($first['next_before']);

        $second = $this->requestJson('GET', '/api/v1/warden-spawns/history?before='.$first['next_before'], token: $token);
        self::assertCount(5, $second['warden_spawns']);
        self::assertNull($second['next_before']);
        self::assertSame([], array_intersect(array_column($first['warden_spawns'], 'id'), array_column($second['warden_spawns'], 'id')));
    }

    public function testSummarisesTheLast24HoursPerWorldForTheBot(): void
    {
        $me = $this->createUser('me@example.com');
        $this->createCharacter($me, 'My Knight');
        $rival = $this->createUser('rival@example.com', '777000');
        $rival->linkDiscord('777000', 'Rival');
        $this->spawn($me, 'Dragon', '-30 hours'); // too old
        $this->spawn($rival, 'Hydra', '-20 hours', killed: true);
        $this->spawn($me, 'Dragon', '-10 hours');
        $this->spawn($me, 'Dragon', '-5 hours', killed: true);
        $this->spawn($me, 'Hydra', '-3 hours', 'Antica');
        $live = $this->spawn($rival, 'Dragon', '-1 minute');
        $presence = new WardenSpawnPresence($live, '123456789012345678', new \DateTimeImmutable());
        $presence->replace(['100000000000000001'], [], new \DateTimeImmutable());
        $this->em->persist($presence);
        $this->em->flush();
        $myToken = $this->tokenFor($me);

        $data = $this->requestJson('GET', '/api/v1/internal/daily-summary', token: self::BOT_TOKEN);

        self::assertResponseIsSuccessful();
        self::assertSame(['Monza', 'Antica'], array_column($data['worlds'], 'server_name'));
        self::assertSame([
            'server_name' => 'Monza', 'reports' => 4, 'killed' => 2, 'expired' => 1, 'active' => 1, 'responded' => 1,
            'monsters' => [['name' => 'Dragon', 'reports' => 3], ['name' => 'Hydra', 'reports' => 1]],
            'reporters' => [['name' => 'My Knight', 'reports' => 2], ['name' => 'Rival', 'reports' => 2]],
        ], $data['worlds'][0]);

        $earlier = $this->requestJson('GET', '/api/v1/internal/daily-summary?until='.urlencode((new \DateTimeImmutable('-12 hours'))->format(\DATE_ATOM)), token: self::BOT_TOKEN);
        self::assertSame(2, $earlier['worlds'][0]['reports'], 'the Dragon from 30 h and the Hydra from 20 h ago');

        $week = $this->requestJson('GET', '/api/v1/internal/daily-summary?'.http_build_query([
            'since' => (new \DateTimeImmutable('-7 days'))->format(\DATE_ATOM),
            'until' => (new \DateTimeImmutable())->format(\DATE_ATOM),
        ]), token: self::BOT_TOKEN);
        self::assertSame(5, $week['worlds'][0]['reports'], 'the 30 h old Dragon counts in the week');

        $this->requestJson('GET', '/api/v1/internal/daily-summary?'.http_build_query([
            'since' => (new \DateTimeImmutable('-40 days'))->format(\DATE_ATOM),
        ]), token: self::BOT_TOKEN);
        self::assertResponseStatusCodeSame(400);

        $this->requestJson('GET', '/api/v1/internal/daily-summary', token: $myToken);
        self::assertResponseStatusCodeSame(403);
    }
}
