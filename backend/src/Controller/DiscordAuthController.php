<?php

namespace App\Controller;

use App\Dto\DiscordLoginRequest;
use App\Entity\User;
use App\Http\Json;
use App\Http\Problem;
use App\Repository\UserRepository;
use App\Security\ApiTokenIssuer;
use App\Service\DiscordOAuthClient;
use App\Service\DiscordOAuthException;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;

/**
 * "Log in with Discord". The frontend sends the user to Discord, gets the code back on
 * /auth/discord/callback (after checking its own state parameter) and posts it here.
 */
#[Route('/api/v1/auth/discord')]
final class DiscordAuthController extends AbstractController
{
    public function __construct(
        private readonly DiscordOAuthClient $discord,
        private readonly UserRepository $users,
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('', name: 'api_auth_discord_config', methods: ['GET'])]
    public function config(): JsonResponse
    {
        return $this->json([
            'enabled' => $this->discord->isEnabled(),
            'authorize_url' => $this->discord->isEnabled() ? $this->discord->authorizeUrl() : null,
        ]);
    }

    /**
     * Anonymous request: log in (an account is created on the first visit).
     * With a player's Bearer token: link this Discord account to the logged-in player.
     */
    #[Route('', name: 'api_auth_discord_login', methods: ['POST'])]
    public function login(#[MapRequestPayload] DiscordLoginRequest $payload): JsonResponse
    {
        if (!$this->discord->isEnabled()) {
            return Problem::response(503, 'Logging in with Discord is not configured.');
        }

        try {
            $discordUser = $this->discord->fetchUser((string) $payload->code);
        } catch (DiscordOAuthException $e) {
            $this->logger->warning('Discord OAuth failed: {message}', ['message' => $e->getMessage(), 'exception' => $e]);

            return Problem::response(401, 'Logging in with Discord failed. Please try again.');
        }

        $owner = $this->users->findOneByDiscordUserId($discordUser->id);
        $current = $this->getUser();

        if ($current instanceof User) {
            if (null !== $owner && $owner !== $current) {
                return Problem::response(409, 'This Discord account is already linked to another account.');
            }
            $current->linkDiscord($discordUser->id, $discordUser->username);
            $this->em->flush();

            return $this->json(['user' => Json::user($current)]);
        }

        if (null !== $owner) {
            $owner->linkDiscord($discordUser->id, $discordUser->username);

            return $this->json(ApiTokenIssuer::issue($this->em, $this->clock, $owner));
        }

        // Never attach to an existing account by e-mail: that would let anyone who controls
        // a Discord account with the same address take over the password account.
        $email = $discordUser->verifiedEmail;
        if (null !== $email && null !== $this->users->findOneByEmail($email)) {
            return Problem::response(409, \sprintf(
                'An account with the address %s already exists. Log in with your password and link Discord on the Characters tab.',
                $email,
            ), ['code' => 'email_exists']);
        }

        $user = new User($email);
        $user->linkDiscord($discordUser->id, $discordUser->username);
        $this->em->persist($user);

        return $this->json(ApiTokenIssuer::issue($this->em, $this->clock, $user), 201);
    }
}
