<?php

namespace App\Tests\Functional;

use App\Entity\CharacterKilledMonster;
use App\Entity\WardenSpawn;
use App\Security\AdminPolicy;

final class AdminApiTest extends ApiTestCase
{
    private const ADMIN_DISCORD_ID = '111111111111111111';

    public function testAdminSeesEveryAccountNewestFirst(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        $character = $this->createCharacter($player, 'Sir Tester', 'Monza');
        $monster = $this->createMonster();
        $this->em->persist(new WardenSpawn($monster, 'Monza', 'Hydra cave', $player));
        $this->em->persist(new CharacterKilledMonster($character, $monster));
        $this->em->flush();
        $token = $this->tokenFor($admin);

        $this->grantAdmins();
        $data = $this->requestJson('GET', '/api/v1/admin/users', null, $token);

        self::assertResponseIsSuccessful();
        self::assertSame(['player@example.com', 'admin@example.com'], array_column($data['users'], 'email'));
        $row = $data['users'][0];
        self::assertFalse($row['discord_linked']);
        self::assertSame([['name' => 'Sir Tester', 'server_name' => 'Monza']], $row['characters']);
        self::assertSame(1, $row['reports']);
        self::assertNotNull($row['last_report_at']);
        self::assertSame(1, $row['bestiary_marks']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $row['created_at']);
        self::assertTrue($data['users'][1]['discord_linked']);
    }

    public function testOtherPlayersAreRefused(): void
    {
        $player = $this->createUser('player@example.com', '222222222222222222');
        $token = $this->tokenFor($player);

        $this->grantAdmins();
        $data = $this->requestJson('GET', '/api/v1/admin/users', null, $token);

        self::assertResponseStatusCodeSame(403);
        self::assertArrayNotHasKey('users', $data);
    }

    public function testMeTellsWhetherTheAccountIsAdmin(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        [$adminToken, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];

        $this->grantAdmins();
        self::assertTrue($this->requestJson('GET', '/api/v1/me', null, $adminToken)['is_admin']);
        self::assertFalse($this->requestJson('GET', '/api/v1/me', null, $playerToken)['is_admin']);
    }

    public function testIgnoresMalformedIds(): void
    {
        $policy = new AdminPolicy(' 111111111111111111 , not-an-id,,');
        $user = $this->createUser('x@example.com', '111111111111111111');

        self::assertTrue($policy->isAdmin($user));
        self::assertFalse((new AdminPolicy(''))->isAdmin($user));
        self::assertFalse((new AdminPolicy(null))->isAdmin($this->createUser('y@example.com')));
    }

    /** The real list comes from ADMIN_DISCORD_IDS; the kernel is kept so the replacement survives requests. */
    private function grantAdmins(): void
    {
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID));
    }
}
