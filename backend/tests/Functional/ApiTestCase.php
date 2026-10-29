<?php

namespace App\Tests\Functional;

use App\Entity\ApiToken;
use App\Entity\Character;
use App\Entity\Monster;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

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
