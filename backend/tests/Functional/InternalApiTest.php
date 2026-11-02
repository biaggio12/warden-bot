<?php

namespace App\Tests\Functional;

use App\Entity\CharacterKilledMonster;
use App\Entity\User;
use App\Entity\WardenSpawn;

final class InternalApiTest extends ApiTestCase
{
    public function testRecipientsExcludePlayersWhoAlreadyKilledTheMonster(): void
    {
        $monster = $this->createMonster();

        $hunter = $this->createUser('hunter@example.com', '100000000000000001');
        $hunterChar = $this->createCharacter($hunter, 'Hunter One', 'Monza');

        $veteran = $this->createUser('veteran@example.com', '100000000000000002');
        $veteranChar = $this->createCharacter($veteran, 'Veteran One', 'Monza');
        $this->em->persist(new CharacterKilledMonster($veteranChar, $monster));

        $mixed = $this->createUser('mixed@example.com', '100000000000000003');
        $this->em->persist(new CharacterKilledMonster($this->createCharacter($mixed, 'Mixed Done', 'Monza'), $monster));
        $mixedTodo = $this->createCharacter($mixed, 'Mixed Todo', 'Monza');

        $otherWorld = $this->createUser('elsewhere@example.com', '100000000000000004');
        $this->createCharacter($otherWorld, 'Far Away', 'Secura');

        $unlinked = $this->createUser('unlinked@example.com');
        $this->createCharacter($unlinked, 'No Discord', 'Monza');

        $spawn = new WardenSpawn($monster, 'Monza', 'Venore', $hunter);
        $this->em->persist($spawn);
        $this->em->flush();

        $data = $this->requestJson('GET', \sprintf('/api/v1/internal/warden-spawns/%s/recipients', $spawn->getId()), token: self::BOT_TOKEN);

        self::assertResponseIsSuccessful();
        self::assertSame([
            ['discord_user_id' => '100000000000000001', 'characters' => [['id' => $hunterChar->getId()->toRfc4122(), 'name' => 'Hunter One']]],
            ['discord_user_id' => '100000000000000003', 'characters' => [['id' => $mixedTodo->getId()->toRfc4122(), 'name' => 'Mixed Todo']]],
        ], $data['recipients']);
    }

    public function testInternalEndpointsRequireBotToken(): void
    {
        $user = $this->createUser();

        $this->requestJson('GET', '/api/v1/internal/warden-spawns/01890000-0000-7000-8000-000000000000/recipients', token: $this->tokenFor($user));
        self::assertResponseStatusCodeSame(403);

        $this->requestJson('GET', '/api/v1/internal/warden-spawns/01890000-0000-7000-8000-000000000000/recipients');
        self::assertResponseStatusCodeSame(401);
    }

    public function testLinkDiscordWithOneTimeCode(): void
    {
        $user = $this->createUser();
        $token = $this->tokenFor($user);

        $code = $this->requestJson('POST', '/api/v1/me/discord-link-code', token: $token)['code'];
        self::assertResponseStatusCodeSame(201);

        $this->requestJson('POST', '/api/v1/internal/discord-links', ['code' => strtolower($code), 'discord_user_id' => '123456789012345678'], self::BOT_TOKEN);
        self::assertResponseIsSuccessful();

        $this->em->clear();
        self::assertSame('123456789012345678', $this->em->getRepository(User::class)->find($user->getId())->getDiscordUserId());

        $this->requestJson('POST', '/api/v1/internal/discord-links', ['code' => $code, 'discord_user_id' => '123456789012345678'], self::BOT_TOKEN);
        self::assertResponseStatusCodeSame(404, 'a code can be used only once');
    }

    public function testKeepsTheFullPresenceListsOfEachAlert(): void
    {
        $user = $this->createUser(discordUserId: '100000000000000001');
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Venore', $user);
        $this->em->persist($spawn);
        $this->em->flush();
        $url = \sprintf('/api/v1/internal/warden-spawns/%s/presence/', $spawn->getId());
        $ids = array_map(static fn (int $i): string => (string) (200000000000000000 + $i), range(1, 15));

        self::assertSame(['on_my_way' => [], 'on_site' => []], $this->requestJson('GET', $url.'1111111111111111111', token: self::BOT_TOKEN));

        // Click order is kept; a player on both lists stays on the first only.
        $this->requestJson('PUT', $url.'1111111111111111111', ['on_my_way' => $ids, 'on_site' => ['300000000000000001', $ids[0]]], self::BOT_TOKEN);
        self::assertResponseIsSuccessful();
        $this->requestJson('PUT', $url.'2222222222222222222', ['on_my_way' => ['300000000000000002']], self::BOT_TOKEN);

        self::assertSame(['on_my_way' => $ids, 'on_site' => ['300000000000000001']], $this->requestJson('GET', $url.'1111111111111111111', token: self::BOT_TOKEN));
        self::assertSame(['on_my_way' => ['300000000000000002'], 'on_site' => []], $this->requestJson('GET', $url.'2222222222222222222', token: self::BOT_TOKEN));

        $this->requestJson('PUT', $url.'1111111111111111111', ['on_my_way' => array_slice($ids, 1)], self::BOT_TOKEN);
        self::assertSame(array_slice($ids, 1), $this->requestJson('GET', $url.'1111111111111111111', token: self::BOT_TOKEN)['on_my_way']);
    }

    public function testRejectsBadPresenceAndPlayers(): void
    {
        $user = $this->createUser(discordUserId: '100000000000000001');
        $spawn = new WardenSpawn($this->createMonster(), 'Monza', 'Venore', $user);
        $this->em->persist($spawn);
        $this->em->flush();
        $url = \sprintf('/api/v1/internal/warden-spawns/%s/presence/1111111111111111111', $spawn->getId());

        $data = $this->requestJson('PUT', $url, ['on_my_way' => ['<@1>']], self::BOT_TOKEN);
        self::assertResponseStatusCodeSame(422);
        self::assertSame('on_my_way[0]', $data['violations'][0]['property_path']);

        $this->requestJson('GET', $url, token: $this->tokenFor($user));
        self::assertResponseStatusCodeSame(403);

        $this->requestJson('GET', '/api/v1/internal/warden-spawns/00000000-0000-0000-0000-000000000000/presence/1111111111111111111', token: self::BOT_TOKEN);
        self::assertResponseStatusCodeSame(404);
    }
}
