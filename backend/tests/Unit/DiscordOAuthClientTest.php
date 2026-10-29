<?php

namespace App\Tests\Unit;

use App\Service\DiscordOAuthClient;
use App\Service\DiscordOAuthException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\JsonMockResponse;

final class DiscordOAuthClientTest extends TestCase
{
    #[DataProvider('failures')]
    public function testFailureMessageNamesTheCause(string $secret, int $status, string $error, string $expected): void
    {
        $http = new MockHttpClient(new JsonMockResponse(['error' => $error], ['http_code' => $status]), 'https://discord.com/api/v10/');
        $client = new DiscordOAuthClient($http, '1565384765216129044', $secret, 'http://localhost:5173/auth/discord/callback');

        try {
            $client->fetchUser('code');
            self::fail('Expected DiscordOAuthException');
        } catch (DiscordOAuthException $e) {
            self::assertStringContainsString($expected, $e->getMessage());
        }
    }

    public static function failures(): iterable
    {
        yield 'bot token used as secret' => ['MTU2NTM4.GabcDe.xyz123', 401, 'invalid_client', 'looks like the bot token'];
        yield 'wrong secret' => ['abcdefghijklmnopqrstuvwxyz123456', 401, 'invalid_client', 'Check DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET'];
        yield 'expired code' => ['abcdefghijklmnopqrstuvwxyz123456', 400, 'invalid_grant', 'redirect URI does not match'];
    }
}
