<?php

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\HttpExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Discord OAuth2 authorization code flow ("Log in with Discord").
 * Enabled only when DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set.
 */
final readonly class DiscordOAuthClient
{
    private const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
    private const SCOPES = 'identify email';

    public function __construct(
        #[Autowire(service: 'discord.client')]
        private HttpClientInterface $discord,
        #[Autowire('%env(default::DISCORD_CLIENT_ID)%')]
        private ?string $clientId,
        #[Autowire('%env(default::DISCORD_CLIENT_SECRET)%')]
        private ?string $clientSecret,
        #[Autowire('%env(DISCORD_OAUTH_REDIRECT_URI)%')]
        private string $redirectUri,
    ) {
    }

    public function isEnabled(): bool
    {
        return '' !== (string) $this->clientId && '' !== (string) $this->clientSecret;
    }

    /** Without "state": the frontend adds its own CSRF state before redirecting. */
    public function authorizeUrl(): string
    {
        return self::AUTHORIZE_URL.'?'.http_build_query([
            'client_id' => $this->clientId,
            'redirect_uri' => $this->redirectUri,
            'response_type' => 'code',
            'scope' => self::SCOPES,
        ], '', '&', \PHP_QUERY_RFC3986);
    }

    /**
     * Exchanges the authorization code and returns the Discord account behind it.
     *
     * @throws DiscordOAuthException when the code is invalid or Discord cannot be reached
     */
    public function fetchUser(string $code): DiscordUser
    {
        try {
            $token = $this->discord->request('POST', 'oauth2/token', [
                'auth_basic' => [(string) $this->clientId, (string) $this->clientSecret],
                'body' => [
                    'grant_type' => 'authorization_code',
                    'code' => $code,
                    'redirect_uri' => $this->redirectUri,
                ],
            ])->toArray();

            $user = $this->discord->request('GET', 'users/@me', [
                'auth_bearer' => $token['access_token'] ?? '',
            ])->toArray();
        } catch (ExceptionInterface $e) {
            throw new DiscordOAuthException($this->describeFailure($e), previous: $e);
        }

        if (!isset($user['id'])) {
            throw new DiscordOAuthException('Discord returned no user id.');
        }

        return new DiscordUser(
            id: (string) $user['id'],
            username: (string) ($user['global_name'] ?? $user['username'] ?? ''),
            verifiedEmail: ($user['verified'] ?? false) && isset($user['email']) ? (string) $user['email'] : null,
        );
    }

    /**
     * Discord's own error code (invalid_client, invalid_grant, ...) plus a hint for the
     * most common misconfiguration, so the log says what to fix.
     */
    private function describeFailure(ExceptionInterface $e): string
    {
        $error = null;
        if ($e instanceof HttpExceptionInterface) {
            $body = json_decode($e->getResponse()->getContent(false), true);
            $error = \is_array($body) ? ($body['error'] ?? $body['message'] ?? null) : null;
        }
        $message = \sprintf('Discord rejected the login (%s).', $error ?? $e->getMessage());

        if ('invalid_client' === $error && 1 === preg_match('/^[\w-]+\.[\w-]+\.[\w-]+$/', (string) $this->clientSecret)) {
            $message .= ' DISCORD_CLIENT_SECRET looks like the bot token; use the Client Secret from Developer Portal -> OAuth2.';
        } elseif ('invalid_client' === $error) {
            $message .= ' Check DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET.';
        } elseif ('invalid_grant' === $error) {
            $message .= ' The code expired or was already used, or the redirect URI does not match the one registered in Discord.';
        }

        return $message;
    }
}
