<?php

namespace App\Tests\Functional;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\User;
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
        self::assertSame([['id' => $character->getId()->toRfc4122(), 'name' => 'Sir Tester', 'server_name' => 'Monza']], $row['characters']);
        self::assertFalse($row['blocked']);
        self::assertFalse($row['is_admin']);
        self::assertTrue($data['users'][1]['is_admin']);
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

    public function testBlockedPlayerCannotLogInUseTheApiReportOrBePinged(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '333333333333333333');
        $player->setPassword(static::getContainer()->get('security.user_password_hasher')->hashPassword($player, 'secret-pass'));
        $this->createCharacter($player, 'Sir Tester', 'Monza');
        $monster = $this->createMonster();
        $spawn = new WardenSpawn($monster, 'Monza', 'Hydra cave', $admin);
        $this->em->persist($spawn);
        $this->em->flush();
        [$adminToken, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];
        $this->grantAdmins();

        $row = $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/block', $player->getId()), null, $adminToken);
        self::assertResponseIsSuccessful();
        self::assertTrue($row['blocked']);

        // The session in use stops working (401: the web app logs out).
        $data = $this->requestJson('GET', '/api/v1/characters', null, $playerToken);
        self::assertResponseStatusCodeSame(401);
        self::assertSame('account_blocked', $data['code']);
        // No new session, by password...
        $data = $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'player@example.com', 'password' => 'secret-pass']);
        self::assertResponseStatusCodeSame(403);
        self::assertSame('account_blocked', $data['code']);
        // ...nor through the bot (/report, Killed).
        $this->requestJson('POST', '/api/v1/warden-spawns', ['monster_id' => $monster->getId(), 'server_name' => 'Monza', 'location_description' => 'Hydra cave'], self::BOT_TOKEN, ['X-Discord-User-Id' => '333333333333333333']);
        self::assertResponseStatusCodeSame(401);
        // And the bot does not ping them.
        $recipients = $this->requestJson('GET', \sprintf('/api/v1/internal/warden-spawns/%s/recipients', $spawn->getId()), null, self::BOT_TOKEN);
        self::assertSame([], $recipients['recipients']);

        $row = $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/unblock', $player->getId()), null, $adminToken);
        self::assertFalse($row['blocked']);
        $this->requestJson('GET', '/api/v1/characters', null, $playerToken);
        self::assertResponseIsSuccessful();
    }

    public function testAdminsAndTheirOwnAccountAreProtected(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $otherAdmin = $this->createUser('admin2@example.com', '444444444444444444');
        $token = $this->tokenFor($admin);
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID.',444444444444444444'));

        foreach ([$admin, $otherAdmin] as $target) {
            foreach (['POST /block', 'POST /unlink-discord', 'DELETE '] as $call) {
                [$method, $suffix] = explode(' ', $call);
                $this->requestJson($method, \sprintf('/api/v1/admin/users/%d%s', $target->getId(), $suffix), null, $token);
                self::assertResponseStatusCodeSame(403, "$call on {$target->getEmail()}");
            }
        }
        self::assertNotNull($this->em->find(User::class, $otherAdmin->getId()));
    }

    public function testPlayersCannotUseTheAdminActions(): void
    {
        $player = $this->createUser('player@example.com', '222222222222222222');
        $victim = $this->createUser('victim@example.com');
        $token = $this->tokenFor($player);
        $this->grantAdmins();

        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/block', $victim->getId()), null, $token);
        self::assertResponseStatusCodeSame(403);
        $this->requestJson('DELETE', \sprintf('/api/v1/admin/users/%d', $victim->getId()), null, $token);
        self::assertResponseStatusCodeSame(403);
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/characters', $victim->getId()), ['name' => 'Evil', 'server_name' => 'Monza'], $token);
        self::assertResponseStatusCodeSame(403);
    }

    public function testUnlinksDiscordButNotOfABlockedAccount(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '333333333333333333');
        $token = $this->tokenFor($admin);
        $this->grantAdmins();

        $row = $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/unlink-discord', $player->getId()), null, $token);
        self::assertResponseIsSuccessful();
        self::assertFalse($row['discord_linked']);
        self::assertNull($row['discord_username']);

        $other = $this->createUser('other@example.com', '555555555555555555');
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/block', $other->getId()), null, $token);
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/unlink-discord', $other->getId()), null, $token);
        self::assertResponseStatusCodeSame(409);
    }

    public function testDeletesAnAccountButKeepsItsReportsInTheStats(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '333333333333333333');
        $character = $this->createCharacter($player, 'Sir Tester', 'Monza');
        $monster = $this->createMonster();
        $spawn = new WardenSpawn($monster, 'Monza', 'Hydra cave', $player);
        $this->em->persist($spawn);
        $this->em->persist(new CharacterKilledMonster($character, $monster));
        $this->em->flush();
        [$spawnId, $playerId] = [$spawn->getId(), $player->getId()];
        $playerToken = $this->tokenFor($player);
        $token = $this->tokenFor($admin);
        $this->grantAdmins();

        $this->requestJson('DELETE', \sprintf('/api/v1/admin/users/%d', $playerId), null, $token);
        self::assertResponseStatusCodeSame(204);

        $this->em->clear();
        self::assertNull($this->em->find(User::class, $playerId));
        self::assertSame(0, $this->em->getRepository(Character::class)->count([]));
        $kept = $this->em->find(WardenSpawn::class, $spawnId);
        self::assertNotNull($kept);
        self::assertNull($kept->getReportedBy());
        self::assertSame(1, $this->requestJson('GET', '/api/v1/stats?period=all', null, $token)['totals']['reports']);
        $this->requestJson('GET', '/api/v1/me', null, $playerToken);
        self::assertResponseStatusCodeSame(401);
    }

    public function testManagesAnotherPlayersCharacters(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        $taken = $this->createCharacter($admin, 'Taken Name', 'Monza');
        $token = $this->tokenFor($admin);
        $this->grantAdmins();
        $url = \sprintf('/api/v1/admin/users/%d/characters', $player->getId());

        $row = $this->requestJson('POST', $url, ['name' => 'Typo Fixed', 'server_name' => 'secura'], $token);
        self::assertResponseIsSuccessful();
        self::assertSame([['name' => 'Typo Fixed', 'server_name' => 'Secura']], array_map(static fn (array $c): array => ['name' => $c['name'], 'server_name' => $c['server_name']], $row['characters']));

        $this->requestJson('POST', $url, ['name' => 'Taken Name', 'server_name' => 'Monza'], $token);
        self::assertResponseStatusCodeSame(409);
        $data = $this->requestJson('POST', $url, ['name' => 'X', 'server_name' => 'Nowhere'], $token);
        self::assertResponseStatusCodeSame(422);
        self::assertNotEmpty($data['violations']);

        // Someone else's character cannot be deleted through this player.
        $this->requestJson('DELETE', $url.'/'.$taken->getId(), null, $token);
        self::assertResponseStatusCodeSame(404);

        $row = $this->requestJson('DELETE', $url.'/'.$row['characters'][0]['id'], null, $token);
        self::assertResponseIsSuccessful();
        self::assertSame([], $row['characters']);
    }

    /** The real list comes from ADMIN_DISCORD_IDS; the kernel is kept so the replacement survives requests. */
    private function grantAdmins(): void
    {
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID));
    }
}
