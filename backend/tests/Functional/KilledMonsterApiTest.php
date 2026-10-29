<?php

namespace App\Tests\Functional;

use App\Entity\CharacterKilledMonster;

final class KilledMonsterApiTest extends ApiTestCase
{
    public function testFirstMarkCreatesAndRepeatIsIdempotent(): void
    {
        $user = $this->createUser();
        $token = $this->tokenFor($user);
        $character = $this->createCharacter($user);
        $monster = $this->createMonster();
        $uri = \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId());

        $first = $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], $token);
        self::assertResponseStatusCodeSame(201);
        self::assertSame($monster->getId(), $first['monster_id']);

        $second = $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], $token);
        self::assertResponseStatusCodeSame(200);
        self::assertSame($first['killed_at'], $second['killed_at']);

        $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], $token);
        self::assertResponseStatusCodeSame(200);

        self::assertSame(1, $this->em->getRepository(CharacterKilledMonster::class)->count(['character' => $character]));
    }

    public function testForeignCharacterIsForbidden(): void
    {
        $owner = $this->createUser('owner@example.com');
        $intruder = $this->createUser('intruder@example.com');
        $character = $this->createCharacter($owner);
        $monster = $this->createMonster();

        $data = $this->requestJson(
            'POST',
            \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId()),
            ['monster_id' => $monster->getId()],
            $this->tokenFor($intruder),
        );

        self::assertResponseStatusCodeSame(403);
        self::assertResponseHeaderSame('Content-Type', 'application/problem+json');
        self::assertSame(403, $data['status']);
        self::assertSame(0, $this->em->getRepository(CharacterKilledMonster::class)->count([]));
    }

    public function testUnknownCharacterOrMonsterIsNotFound(): void
    {
        $user = $this->createUser();
        $token = $this->tokenFor($user);
        $character = $this->createCharacter($user);
        $monster = $this->createMonster();

        $this->requestJson('POST', '/api/v1/characters/01890000-0000-7000-8000-000000000000/killed-monsters', ['monster_id' => $monster->getId()], $token);
        self::assertResponseStatusCodeSame(404);

        $this->requestJson('POST', '/api/v1/characters/not-a-uuid/killed-monsters', ['monster_id' => $monster->getId()], $token);
        self::assertResponseStatusCodeSame(404);

        $this->requestJson('POST', \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId()), ['monster_id' => 999999], $token);
        self::assertResponseStatusCodeSame(404);
    }

    public function testRequiresAuthentication(): void
    {
        $owner = $this->createUser();
        $character = $this->createCharacter($owner);

        $this->requestJson('POST', \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId()), ['monster_id' => 1]);

        self::assertResponseStatusCodeSame(401);
    }

    public function testBulkAddAndRemove(): void
    {
        $user = $this->createUser();
        $token = $this->tokenFor($user);
        $character = $this->createCharacter($user);
        $a = $this->createMonster('Dragon', 'Dragons', 25);
        $b = $this->createMonster('Dragon Lord', 'Dragons', 50);
        $c = $this->createMonster('Hydra', 'Dragons', 50);
        $uri = \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId());

        $data = $this->requestJson('PUT', $uri, ['add' => [$a->getId(), $b->getId(), $c->getId()]], $token);
        self::assertResponseStatusCodeSame(200);
        self::assertSame([$a->getId(), $b->getId(), $c->getId()], $data['monster_ids']);

        $data = $this->requestJson('PUT', $uri, ['add' => [$a->getId()], 'remove' => [$b->getId()]], $token);
        self::assertResponseStatusCodeSame(200);
        self::assertSame([$a->getId(), $c->getId()], $data['monster_ids']);

        $data = $this->requestJson('GET', $uri, token: $token);
        self::assertSame([$a->getId(), $c->getId()], $data['monster_ids']);

        $this->requestJson('PUT', $uri, ['add' => [999999]], $token);
        self::assertResponseStatusCodeSame(404);
    }

    public function testBulkOnForeignCharacterIsForbidden(): void
    {
        $owner = $this->createUser('owner@example.com');
        $character = $this->createCharacter($owner);
        $monster = $this->createMonster();

        $this->requestJson(
            'PUT',
            \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId()),
            ['add' => [$monster->getId()]],
            $this->tokenFor($this->createUser('intruder@example.com')),
        );

        self::assertResponseStatusCodeSame(403);
    }

    public function testBotCanActOnBehalfOfLinkedPlayer(): void
    {
        $user = $this->createUser(discordUserId: '111111111111111111');
        $character = $this->createCharacter($user);
        $monster = $this->createMonster();
        $uri = \sprintf('/api/v1/characters/%s/killed-monsters', $character->getId());

        $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], self::BOT_TOKEN, ['X-Discord-User-Id' => '111111111111111111']);
        self::assertResponseStatusCodeSame(201);

        $this->createUser('other@example.com', '222222222222222222');
        $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], self::BOT_TOKEN, ['X-Discord-User-Id' => '222222222222222222']);
        self::assertResponseStatusCodeSame(403);

        $data = $this->requestJson('POST', $uri, ['monster_id' => $monster->getId()], self::BOT_TOKEN, ['X-Discord-User-Id' => '333333333333333333']);
        self::assertResponseStatusCodeSame(401);
        self::assertSame('discord_not_linked', $data['code']);
    }
}
