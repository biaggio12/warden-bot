<?php

namespace App\Tests\Functional;

use App\Entity\User;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\JsonMockResponse;

final class DiscordAuthApiTest extends ApiTestCase
{
    /** @var list<array{method: string, url: string, options: array<string, mixed>}> */
    private array $discordRequests = [];

    /**
     * Replaces the Discord API with canned responses: a token exchange and a /users/@me
     * per login, in order. Can be called once per kernel.
     *
     * @param list<array<string, mixed>> $users one entry per expected login
     */
    private function fakeDiscord(array $users, int $tokenStatus = 200): void
    {
        $this->discordRequests = [];
        $responses = [];
        foreach ($users as $user) {
            $responses[] = new JsonMockResponse($tokenStatus < 400 ? ['access_token' => 'discord-access', 'token_type' => 'Bearer'] : ['error' => 401 === $tokenStatus ? 'invalid_client' : 'invalid_grant'], ['http_code' => $tokenStatus]);
            $responses[] = new JsonMockResponse($user);
        }
        $client = new MockHttpClient(function (string $method, string $url, array $options) use (&$responses) {
            $this->discordRequests[] = ['method' => $method, 'url' => $url, 'options' => $options];

            return array_shift($responses);
        }, 'https://discord.com/api/v10/');

        static::getContainer()->set('discord.client', $client);
    }

    public function testConfigExposesAuthorizeUrl(): void
    {
        $data = $this->requestJson('GET', '/api/v1/auth/discord');

        self::assertResponseIsSuccessful();
        self::assertTrue($data['enabled']);
        self::assertStringStartsWith('https://discord.com/oauth2/authorize?client_id=test-client-id', $data['authorize_url']);
        self::assertStringContainsString('redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fdiscord%2Fcallback', $data['authorize_url']);
        self::assertStringContainsString('scope=identify%20email', $data['authorize_url']);
    }

    public function testFirstLoginCreatesAccountAndSecondLoginReusesIt(): void
    {
        $this->client->disableReboot();
        $this->fakeDiscord([
            ['id' => '555000111', 'username' => 'lukasz', 'global_name' => 'Łukasz', 'email' => 'Lukasz@Discord.pl', 'verified' => true],
            ['id' => '555000111', 'username' => 'lukasz', 'global_name' => 'Łukasz', 'email' => 'lukasz@discord.pl', 'verified' => true],
        ]);

        $data = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'abc']);

        self::assertResponseStatusCodeSame(201);
        self::assertNotEmpty($data['token']);
        self::assertSame(['id' => $data['user']['id'], 'email' => 'lukasz@discord.pl', 'display_name' => 'lukasz@discord.pl', 'discord_linked' => true, 'discord_username' => 'Łukasz'], $data['user']);
        self::assertSame('POST', $this->discordRequests[0]['method']);
        self::assertSame('https://discord.com/api/v10/oauth2/token', $this->discordRequests[0]['url']);
        self::assertStringContainsString('code=abc', $this->discordRequests[0]['options']['body']);

        $me = $this->requestJson('GET', '/api/v1/me', token: $data['token']);
        self::assertTrue($me['discord_linked']);

        $again = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'def']);
        self::assertResponseStatusCodeSame(200);
        self::assertSame($data['user']['id'], $again['user']['id']);
        self::assertSame(1, $this->em->getRepository(User::class)->count([]));
    }

    public function testUnverifiedEmailIsNotUsed(): void
    {
        $this->fakeDiscord([['id' => '555000222', 'username' => 'anon', 'email' => 'anon@example.com', 'verified' => false]]);

        $data = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'abc']);

        self::assertResponseStatusCodeSame(201);
        self::assertNull($data['user']['email']);
        self::assertSame('anon', $data['user']['display_name']);
    }

    public function testDoesNotTakeOverAPasswordAccountWithTheSameEmail(): void
    {
        $existing = $this->createUser('owner@example.com');
        $this->fakeDiscord([['id' => '555000333', 'username' => 'attacker', 'email' => 'owner@example.com', 'verified' => true]]);

        $data = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'abc']);

        self::assertResponseStatusCodeSame(409);
        self::assertSame('email_exists', $data['code']);
        $this->em->refresh($existing);
        self::assertNull($existing->getDiscordUserId());
    }

    public function testLoggedInPlayerLinksDiscord(): void
    {
        $user = $this->createUser('player@example.com');
        $this->fakeDiscord([['id' => '555000444', 'username' => 'player', 'email' => 'other@example.com', 'verified' => true]]);

        $data = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'abc'], $this->tokenFor($user));

        self::assertResponseIsSuccessful();
        self::assertArrayNotHasKey('token', $data);
        self::assertTrue($data['user']['discord_linked']);
        $this->em->refresh($user);
        self::assertSame('555000444', $user->getDiscordUserId());
        self::assertSame('player@example.com', $user->getEmail(), 'linking keeps the account e-mail');
    }

    public function testCannotLinkDiscordUsedByAnotherAccount(): void
    {
        $this->createUser('first@example.com', '555000555');
        $second = $this->createUser('second@example.com');
        $this->fakeDiscord([['id' => '555000555', 'username' => 'shared']]);

        $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'abc'], $this->tokenFor($second));

        self::assertResponseStatusCodeSame(409);
    }

    public function testInvalidCodeIsUnauthorized(): void
    {
        $this->fakeDiscord([[]], 400);

        $data = $this->requestJson('POST', '/api/v1/auth/discord', ['code' => 'expired']);

        self::assertResponseStatusCodeSame(401);
        self::assertSame(401, $data['status']);
    }
}
