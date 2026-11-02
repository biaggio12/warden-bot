<?php

namespace App\Security;

use App\Http\Problem;
use App\Repository\ApiTokenRepository;
use App\Repository\UserRepository;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\EntryPoint\AuthenticationEntryPointInterface;

/**
 * Two kinds of Bearer tokens are accepted:
 *  - a player's API token issued by /auth/login,
 *  - the bot's shared BOT_API_TOKEN, optionally with X-Discord-User-Id to act as the
 *    player linked to that Discord account (so ownership checks still apply).
 */
final class ApiTokenAuthenticator extends AbstractAuthenticator implements AuthenticationEntryPointInterface
{
    public const DISCORD_USER_HEADER = 'X-Discord-User-Id';

    public function __construct(
        private readonly ApiTokenRepository $tokens,
        private readonly UserRepository $users,
        private readonly ClockInterface $clock,
        #[Autowire('%env(BOT_API_TOKEN)%')]
        private readonly string $botToken,
    ) {
    }

    public function supports(Request $request): ?bool
    {
        return str_starts_with((string) $request->headers->get('Authorization'), 'Bearer ');
    }

    public function authenticate(Request $request): Passport
    {
        $plain = trim(substr((string) $request->headers->get('Authorization'), 7));
        if ('' === $plain) {
            throw new CustomUserMessageAuthenticationException('The token is missing.');
        }

        if ('' !== $this->botToken && hash_equals($this->botToken, $plain)) {
            return $this->authenticateBot($request);
        }

        $token = $this->tokens->findOneByPlainToken($plain);
        if (null === $token || !$token->isValid($this->clock->now())) {
            throw new CustomUserMessageAuthenticationException('The token is invalid or has expired.');
        }

        $user = $token->getUser();
        if ($user->isBlocked()) {
            throw new CustomUserMessageAuthenticationException('account_blocked');
        }

        return new SelfValidatingPassport(new UserBadge($user->getUserIdentifier(), static fn () => $user));
    }

    private function authenticateBot(Request $request): Passport
    {
        $discordUserId = $request->headers->get(self::DISCORD_USER_HEADER);
        if (null === $discordUserId || '' === $discordUserId) {
            return new SelfValidatingPassport(new UserBadge('discord-bot', static fn () => new BotUser()));
        }

        $user = $this->users->findOneByDiscordUserId($discordUserId);
        if (null === $user) {
            throw new CustomUserMessageAuthenticationException('discord_not_linked');
        }
        if ($user->isBlocked()) {
            throw new CustomUserMessageAuthenticationException('account_blocked');
        }

        return new SelfValidatingPassport(new UserBadge($user->getUserIdentifier(), static fn () => $user));
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        return null;
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): ?Response
    {
        $message = $exception->getMessageKey();
        if ('discord_not_linked' === $message) {
            return Problem::response(401, 'This Discord account is not linked to a Warden Tracker account.', ['code' => 'discord_not_linked']);
        }

        if ('account_blocked' === $message) {
            // 401: the web app drops the session and shows the login page.
            return Problem::response(401, 'This account has been blocked by an admin.', ['code' => 'account_blocked']);
        }

        return Problem::response(401, strtr($message, $exception->getMessageData()));
    }

    public function start(Request $request, ?AuthenticationException $authException = null): Response
    {
        return Problem::response(401, 'An Authorization: Bearer <token> header is required.');
    }
}
