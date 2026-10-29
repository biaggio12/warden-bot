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
}
