<?php

namespace App\Tests\Functional;

use App\Entity\ApiToken;
use App\Entity\Character;
use App\Entity\Monster;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\JsonMockResponse;

/**
 * Each test runs inside a transaction rolled back by DAMADoctrineTestBundle.
 */
abstract class ApiTestCase extends WebTestCase
{
    protected const BOT_TOKEN = 'test-bot-token';

    protected KernelBrowser $client;
    protected EntityManagerInterface $em;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
    }

    protected function createUser(string $email = 'player@example.com', ?string $discordUserId = null): User
    {
        $user = new User($email);
        $user->setPassword('not-used');
        if (null !== $discordUserId) {
            $user->linkDiscord($discordUserId);
        }
        $this->em->persist($user);
        $this->em->flush();

        return $user;
    }

    protected function tokenFor(User $user): string
    {
        [$token, $plain] = ApiToken::issue($user);
        $this->em->persist($token);
        $this->em->flush();

        return $plain;
    }

    protected function createMonster(string $name = 'Dragon Warden', string $category = 'Dragons', int $charmPoints = 50): Monster
    {
        $monster = new Monster($name, $category, $charmPoints);
        $this->em->persist($monster);
        $this->em->flush();

        return $monster;
    }

    protected function createCharacter(User $owner, string $name = 'Sir Tester', string $server = 'Monza'): Character
    {
        $character = new Character($owner, $name, $server);
        $this->em->persist($character);
        $this->em->flush();

        return $character;
    }

    /**
     * Replaces the Discord API (bot calls) with these servers. Disables kernel reboots so
     * the fake stays in place for every request of the test.
     *
     * Channels given by name get an id made of the server id and their position, see channelIdOf().
     *
     * @param list<array{id: string, name: string, channels: list<string>, members: list<string>}> $guilds
     */
    protected function fakeDiscordGuilds(array $guilds): void
    {
        $this->client->disableReboot();
        $byId = array_column($guilds, null, 'id');
        $notFound = static fn (): JsonMockResponse => new JsonMockResponse(['message' => 'Unknown'], ['http_code' => 404]);

        static::getContainer()->set('discord.client', new MockHttpClient(static function (string $method, string $url) use ($guilds, $byId, $notFound) {
            $path = substr((string) parse_url($url, \PHP_URL_PATH), \strlen('/api/v10/'));
            if ('users/@me/guilds' === $path) {
                return new JsonMockResponse(array_map(static fn (array $g): array => ['id' => $g['id'], 'name' => $g['name']], $guilds));
            }
            if (1 === preg_match('#^guilds/(\d+)/channels$#', $path, $m)) {
                return isset($byId[$m[1]])
                    ? new JsonMockResponse(array_map(
                        static fn (string $name, int $i): array => ['id' => self::channelIdOf($m[1], $i), 'name' => $name, 'type' => 0, 'position' => $i],
                        $byId[$m[1]]['channels'],
                        array_keys($byId[$m[1]]['channels']),
                    ))
                    : $notFound();
            }
            if (1 === preg_match('#^guilds/(\d+)/members/(\d+)$#', $path, $m)) {
                return \in_array($m[2], $byId[$m[1]]['members'] ?? [], true) ? new JsonMockResponse(['user' => ['id' => $m[2]]]) : $notFound();
            }

            return $notFound();
        }, 'https://discord.com/api/v10/'));
    }

    /** The id fakeDiscordGuilds() gives the channel at `$position` of a server. */
    protected static function channelIdOf(string $guildId, int $position): string
    {
        return substr($guildId, 0, 15).substr($guildId, -2).$position;
    }

    /**
     * @param array<string, mixed>|null $body
     * @param array<string, string>     $headers
     */
    protected function requestJson(string $method, string $uri, ?array $body = null, ?string $token = null, array $headers = []): array
    {
        $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        if (null !== $token) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }
        foreach ($headers as $name => $value) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
        }

        $this->client->request($method, $uri, server: $server, content: null === $body ? null : json_encode($body, \JSON_THROW_ON_ERROR));
        $content = (string) $this->client->getResponse()->getContent();

        return '' === $content ? [] : json_decode($content, true, 512, \JSON_THROW_ON_ERROR);
    }
}
