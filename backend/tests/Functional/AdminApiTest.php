<?php

namespace App\Tests\Functional;

use App\Entity\Character;
use App\Entity\CharacterKilledMonster;
use App\Entity\User;
use App\Entity\WardenSpawn;
use App\Entity\WardenSpawnPresence;
use App\Message\WardenDeletedEvent;
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

    public function testResetsThePasswordOfAnEmailAccount(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        $discordOnly = new User(null);
        $discordOnly->linkDiscord('666666666666666666');
        $this->em->persist($discordOnly);
        $this->em->flush();
        $playerToken = $this->tokenFor($player);
        $token = $this->tokenFor($admin);
        $this->grantAdmins();

        $data = $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/reset-password', $player->getId()), null, $token);
        self::assertResponseIsSuccessful();
        self::assertMatchesRegularExpression('/^[a-km-zA-HJ-NP-Z2-9]{12}$/', $data['password']);
        self::assertSame('player@example.com', $data['user']['email']);

        // The old sessions are gone, the new password works.
        $this->requestJson('GET', '/api/v1/me', null, $playerToken);
        self::assertResponseStatusCodeSame(401);
        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'player@example.com', 'password' => $data['password']]);
        self::assertResponseIsSuccessful();

        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/reset-password', $discordOnly->getId()), null, $token);
        self::assertResponseStatusCodeSame(409);
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/reset-password', $admin->getId()), null, $token);
        self::assertResponseStatusCodeSame(403);
    }

    public function testKeepsAHistoryOfAdminActions(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        $doomed = $this->createUser('doomed@example.com');
        [$token, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];
        $this->grantAdmins();

        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/characters', $player->getId()), ['name' => 'New Knight', 'server_name' => 'Monza'], $token);
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/block', $player->getId()), null, $token);
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/block', $admin->getId()), null, $token); // refused: not recorded
        $this->requestJson('DELETE', \sprintf('/api/v1/admin/users/%d', $doomed->getId()), null, $token);

        $data = $this->requestJson('GET', '/api/v1/admin/actions', null, $token);
        self::assertResponseIsSuccessful();
        self::assertSame([
            ['admin@example.com', 'doomed@example.com', 'delete', null],
            ['admin@example.com', 'player@example.com', 'block', null],
            ['admin@example.com', 'player@example.com', 'add_character', 'New Knight (Monza)'],
        ], array_map(static fn (array $a): array => [$a['admin'], $a['player'], $a['action'], $a['details']], $data['actions']));
        self::assertMatchesRegularExpression('/Z$/', $data['actions'][0]['created_at']);

        $this->requestJson('GET', '/api/v1/admin/actions', null, $playerToken);
        self::assertResponseStatusCodeSame(401); // blocked
    }

    public function testShowsHowOftenAndWhatAPlayerReported(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '222222222222222222');
        $other = $this->createUser('other@example.com');
        $dragon = $this->createMonster('Dragon Warden');
        $hydra = $this->createMonster('Hydra Warden', 'Hydras');
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $killed = new WardenSpawn($dragon, 'Monza', 'Darashia dragons', $player, createdAt: $now->modify('-1 hour'), city: 'Darashia');
        $killed->markKilled();
        $this->em->persist($killed);
        $this->em->persist(new WardenSpawn($dragon, 'Monza', 'Old one', $player, createdAt: $now->modify('-10 days')));
        $this->em->persist(new WardenSpawn($hydra, 'Antica', 'Older one', $player, createdAt: $now->modify('-40 days')));
        $this->em->persist(new WardenSpawn($hydra, 'Monza', 'Not theirs', $other));
        $this->em->flush();
        [$adminToken, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];

        $this->grantAdmins();
        $data = $this->requestJson('GET', "/api/v1/admin/users/{$player->getId()}/reports", null, $adminToken);

        self::assertResponseIsSuccessful();
        self::assertSame([3, 1, 2], [$data['total'], $data['last_7_days'], $data['last_30_days']]);
        self::assertSame(['active' => 0, 'killed' => 1, 'expired' => 2], $data['by_status']); // past their time, even before the expiry job ran
        self::assertSame([['server_name' => 'Monza', 'reports' => 2], ['server_name' => 'Antica', 'reports' => 1]], $data['worlds']);
        self::assertSame([['Dragon Warden', 2], ['Hydra Warden', 1]], array_map(static fn (array $m): array => [$m['name'], $m['reports']], $data['monsters']));
        self::assertSame(['Darashia dragons', 'Old one', 'Older one'], array_column($data['recent'], 'location'));
        self::assertSame(['KILLED', 'Darashia', 'Monza'], [$data['recent'][0]['status'], $data['recent'][0]['city'], $data['recent'][0]['server_name']]);
        self::assertSame('EXPIRED', $data['recent'][1]['status']);
        self::assertSame($data['recent'][0]['created_at'], $data['last_report_at']);
        self::assertSame($data['recent'][2]['created_at'], $data['first_report_at']);

        $empty = $this->requestJson('GET', "/api/v1/admin/users/{$admin->getId()}/reports", null, $adminToken);
        self::assertSame([0, null, []], [$empty['total'], $empty['last_report_at'], $empty['recent']]);

        $this->requestJson('GET', '/api/v1/admin/users/999999/reports', null, $adminToken);
        self::assertResponseStatusCodeSame(404);
        $this->requestJson('GET', "/api/v1/admin/users/{$player->getId()}/reports", null, $playerToken);
        self::assertResponseStatusCodeSame(403);
    }

    public function testDeletesAReportAndTellsTheBotToTakeItsAlertsDown(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '222222222222222222');
        $monster = $this->createMonster();
        $fake = new WardenSpawn($monster, 'Monza', 'Made up', $player, createdAt: new \DateTimeImmutable('2026-11-02 09:30:00', new \DateTimeZone('UTC')));
        $kept = new WardenSpawn($monster, 'Monza', 'Real one', $player);
        $this->em->persist($fake);
        $this->em->persist($kept);
        $this->em->persist(new WardenSpawnPresence($fake, '123456789012345678', new \DateTimeImmutable()));
        $this->em->flush();
        [$fakeId, $keptId] = [$fake->getId()->toRfc4122(), $kept->getId()->toRfc4122()];
        [$adminToken, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];

        $this->grantAdmins();
        $this->requestJson('DELETE', "/api/v1/admin/reports/$keptId", null, $playerToken);
        self::assertResponseStatusCodeSame(403);

        $data = $this->requestJson('DELETE', "/api/v1/admin/reports/$fakeId", null, $adminToken);

        self::assertResponseIsSuccessful();
        self::assertSame(1, $data['user']['reports']);
        $this->em->clear();
        self::assertNull($this->em->find(WardenSpawn::class, $fake->getId()));
        self::assertNotNull($this->em->find(WardenSpawn::class, $kept->getId()));
        self::assertSame(0, $this->em->getRepository(WardenSpawnPresence::class)->count([]));
        $sent = static::getContainer()->get('messenger.transport.discord_events')->getSent();
        self::assertCount(1, $sent);
        self::assertEquals(new WardenDeletedEvent($fakeId, 'Monza'), $sent[0]->getMessage());
        $history = $this->requestJson('GET', '/api/v1/admin/actions', null, $adminToken);
        self::assertSame(['delete_report', 'player@example.com', 'Dragon Warden on Monza, 2 Nov 09:30 UTC'], [$history['actions'][0]['action'], $history['actions'][0]['player'], $history['actions'][0]['details']]);

        $this->requestJson('DELETE', "/api/v1/admin/reports/$fakeId", null, $adminToken);
        self::assertResponseStatusCodeSame(404);
        $this->requestJson('DELETE', '/api/v1/admin/reports/not-a-uuid', null, $adminToken);
        self::assertResponseStatusCodeSame(404);
    }

    public function testDeletesAReportWhoseReporterIsGone(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com');
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Orphan', $player);
        $this->em->persist($spawn);
        $this->em->flush();
        $id = $spawn->getId()->toRfc4122();
        $this->em->getConnection()->executeStatement('DELETE FROM users WHERE id = ?', [$player->getId()]);
        $this->em->clear();
        $token = $this->tokenFor($this->em->find(User::class, $admin->getId()));

        $this->grantAdmins();
        $data = $this->requestJson('DELETE', "/api/v1/admin/reports/$id", null, $token);

        self::assertResponseIsSuccessful();
        self::assertNull($data['user']);
        self::assertSame('deleted account', $this->requestJson('GET', '/api/v1/admin/actions', null, $token)['actions'][0]['player']);
    }

    public function testAdminGrantsAndRevokesTheModeratorRank(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $player = $this->createUser('player@example.com', '222222222222222222');
        [$adminToken, $playerToken] = [$this->tokenFor($admin), $this->tokenFor($player)];
        $this->grantAdmins();
        $uri = \sprintf('/api/v1/admin/users/%d/moderator', $player->getId());

        self::assertFalse($this->requestJson('GET', '/api/v1/me', null, $playerToken)['is_moderator']);
        $row = $this->requestJson('POST', $uri, null, $adminToken);
        self::assertResponseIsSuccessful();
        self::assertTrue($row['is_moderator']);
        self::assertTrue($this->requestJson('GET', '/api/v1/me', null, $playerToken)['is_moderator']);
        self::assertFalse($this->requestJson('GET', '/api/v1/me', null, $adminToken)['is_moderator']);
        $this->requestJson('POST', $uri, null, $adminToken);
        self::assertResponseStatusCodeSame(409);

        // Admins are never moderators, and nobody ranks themselves.
        $this->requestJson('POST', \sprintf('/api/v1/admin/users/%d/moderator', $admin->getId()), null, $adminToken);
        self::assertResponseStatusCodeSame(403);

        self::assertFalse($this->requestJson('DELETE', $uri, null, $adminToken)['is_moderator']);
        self::assertSame(['revoke_moderator', 'grant_moderator'], array_slice(array_column($this->requestJson('GET', '/api/v1/admin/actions', null, $adminToken)['actions'], 'action'), 0, 2));
        $this->requestJson('GET', '/api/v1/admin/users', null, $playerToken);
        self::assertResponseStatusCodeSame(403);
    }

    public function testModeratorsUseThePlayersTabButNotTheAdminOnlyActions(): void
    {
        $admin = $this->createUser('admin@example.com', self::ADMIN_DISCORD_ID);
        $moderator = $this->createUser('mod@example.com', '222222222222222222');
        $moderator->setModerator(true);
        $otherModerator = $this->createUser('mod2@example.com');
        $otherModerator->setModerator(true);
        $player = $this->createUser('player@example.com');
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Fake', $player);
        $this->em->persist($spawn);
        $this->em->flush();
        $token = $this->tokenFor($moderator);
        $this->grantAdmins();
        $on = static fn (User $u, string $path = ''): string => \sprintf('/api/v1/admin/users/%d%s', $u->getId(), $path);

        // Allowed on a player.
        $users = $this->requestJson('GET', '/api/v1/admin/users', null, $token)['users'];
        self::assertResponseIsSuccessful();
        self::assertSame([true, true], [array_column($users, 'is_moderator', 'email')['mod@example.com'], array_column($users, 'is_admin', 'email')['admin@example.com']]);
        $this->requestJson('GET', '/api/v1/admin/actions', null, $token);
        self::assertResponseIsSuccessful();
        $this->requestJson('GET', $on($player, '/reports'), null, $token);
        self::assertResponseIsSuccessful();
        $this->requestJson('POST', $on($player, '/characters'), ['name' => 'New Knight', 'server_name' => 'Monza'], $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->requestJson('POST', $on($player, '/block'), null, $token)['blocked']);
        self::assertFalse($this->requestJson('POST', $on($player, '/unblock'), null, $token)['blocked']);
        $this->requestJson('DELETE', '/api/v1/admin/reports/'.$spawn->getId()->toRfc4122(), null, $token);
        self::assertResponseIsSuccessful();

        // Admin-only actions.
        foreach ([['POST', $on($player, '/unlink-discord')], ['POST', $on($player, '/reset-password')], ['DELETE', $on($player)], ['POST', $on($player, '/moderator')]] as [$method, $uri]) {
            $data = $this->requestJson($method, $uri, null, $token);
            self::assertResponseStatusCodeSame(403, "$method $uri");
            self::assertSame('Admins only.', $data['detail']);
        }
        // Staff accounts are out of reach, their own included.
        foreach (['Sneaky Admin' => $admin, 'Sneaky Mod' => $otherModerator, 'Sneaky Self' => $moderator] as $name => $staff) {
            $this->requestJson('POST', $on($staff, '/block'), null, $token);
            self::assertResponseStatusCodeSame(403);
            $this->requestJson('POST', $on($staff, '/characters'), ['name' => $name, 'server_name' => 'Monza'], $token);
            self::assertResponseStatusCodeSame(403);
        }
        $this->em->clear();
        self::assertFalse($this->em->find(User::class, $otherModerator->getId())->isBlocked());
    }

    /** The real list comes from ADMIN_DISCORD_IDS; the kernel is kept so the replacement survives requests. */
    private function grantAdmins(): void
    {
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID));
    }
}
