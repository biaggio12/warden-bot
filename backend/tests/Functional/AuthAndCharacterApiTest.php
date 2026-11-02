<?php

namespace App\Tests\Functional;

final class AuthAndCharacterApiTest extends ApiTestCase
{
    public function testRegisterLoginAndManageCharacters(): void
    {
        $registered = $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'New@Example.com', 'password' => 'secret-pass']);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('new@example.com', $registered['user']['email']);

        $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'new@example.com', 'password' => 'secret-pass']);
        self::assertResponseStatusCodeSame(409);

        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'new@example.com', 'password' => 'wrong-pass']);
        self::assertResponseStatusCodeSame(401);

        $token = $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'new@example.com', 'password' => 'secret-pass'])['token'];
        self::assertResponseIsSuccessful();

        $created = $this->requestJson('POST', '/api/v1/characters', ['name' => 'Knight Fresh', 'server_name' => 'secura'], $token);
        self::assertResponseStatusCodeSame(201);
        self::assertSame('Secura', $created['server_name']);

        $this->requestJson('POST', '/api/v1/characters', ['name' => 'knight fresh', 'server_name' => 'Monza'], $token);
        self::assertResponseStatusCodeSame(409);

        $list = $this->requestJson('GET', '/api/v1/characters', token: $token);
        self::assertSame([$created], $list['characters']);

        $this->requestJson('DELETE', '/api/v1/characters/'.$created['id'], token: $token);
        self::assertResponseStatusCodeSame(204);
    }

    public function testLimitsWrongPasswordsPerEmail(): void
    {
        $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'target@example.com', 'password' => 'secret-pass']);

        for ($i = 0; $i < 10; ++$i) {
            $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'Target@example.com', 'password' => "guess-$i-xx"]);
            self::assertResponseStatusCodeSame(401);
        }
        // Even the right password waits now, so guessing cannot go on.
        $data = $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'target@example.com', 'password' => 'secret-pass']);
        self::assertResponseStatusCodeSame(429);
        self::assertSame('login_limit', $data['code']);
        self::assertStringStartsWith('Too many wrong passwords. Try again in 15 min', $data['detail']);
        self::assertGreaterThan(890, (int) $this->client->getResponse()->headers->get('Retry-After'));

        // Another account is not affected.
        $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'other@example.com', 'password' => 'secret-pass']);
        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'other@example.com', 'password' => 'secret-pass']);
        self::assertResponseIsSuccessful();
    }

    public function testLimitsWrongPasswordsPerAddress(): void
    {
        for ($i = 0; $i < 30; ++$i) {
            $this->requestJson('POST', '/api/v1/auth/login', ['email' => "user$i@example.com", 'password' => 'guess-pass']);
        }
        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'fresh@example.com', 'password' => 'guess-pass']);
        self::assertResponseStatusCodeSame(429);
    }

    public function testASuccessfulLoginClearsTheCount(): void
    {
        $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'me@example.com', 'password' => 'secret-pass']);
        for ($round = 0; $round < 2; ++$round) {
            for ($i = 0; $i < 9; ++$i) {
                $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'typo-pass']);
            }
            $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'secret-pass']);
            self::assertResponseIsSuccessful();
        }
    }

    public function testChangesOwnPasswordAndLogsOutOtherSessions(): void
    {
        $this->requestJson('POST', '/api/v1/auth/register', ['email' => 'me@example.com', 'password' => 'secret-pass']);
        $other = $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'secret-pass'])['token'];
        $token = $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'secret-pass'])['token'];

        $data = $this->requestJson('PUT', '/api/v1/me/password', ['current_password' => 'wrong-pass', 'new_password' => 'new-secret-pass'], $token);
        self::assertResponseStatusCodeSame(422);
        self::assertSame('current_password', $data['violations'][0]['property_path']);
        $this->requestJson('PUT', '/api/v1/me/password', ['current_password' => 'secret-pass', 'new_password' => 'short'], $token);
        self::assertResponseStatusCodeSame(422);

        $this->requestJson('PUT', '/api/v1/me/password', ['current_password' => 'secret-pass', 'new_password' => 'new-secret-pass'], $token);
        self::assertResponseStatusCodeSame(204);

        $this->requestJson('GET', '/api/v1/me', token: $token);
        self::assertResponseIsSuccessful();
        $this->requestJson('GET', '/api/v1/me', token: $other);
        self::assertResponseStatusCodeSame(401);
        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'secret-pass']);
        self::assertResponseStatusCodeSame(401);
        $this->requestJson('POST', '/api/v1/auth/login', ['email' => 'me@example.com', 'password' => 'new-secret-pass']);
        self::assertResponseIsSuccessful();
    }

    public function testOldWrongPasswordsArePurged(): void
    {
        $throttle = static::getContainer()->get(\App\Service\LoginThrottle::class);
        $now = new \DateTimeImmutable();
        $throttle->recordFailure('a@example.com', '10.0.0.1', $now->modify('-2 days'));
        $throttle->recordFailure('a@example.com', '10.0.0.1', $now->modify('-1 hour'));

        $handler = static::getContainer()->get(\App\MessageHandler\PurgeLoginFailuresHandler::class);
        self::assertSame(1, $handler(new \App\Message\PurgeLoginFailures()));
        self::assertSame(1, (int) static::getContainer()->get('doctrine.dbal.default_connection')->fetchOne('SELECT COUNT(*) FROM login_failures'));
    }
}
