<?php

namespace App\Controller;

use App\Dto\ChangePasswordRequest;
use App\Entity\User;
use App\Http\Problem;
use App\Repository\ApiTokenRepository;
use App\Service\LoginThrottle;
use App\Http\Json;
use App\Security\AdminPolicy;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/v1/me')]
final class AccountController extends AbstractController
{
    private const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    #[Route('', name: 'api_me', methods: ['GET'])]
    public function me(#[CurrentUser] User $user, AdminPolicy $admins): JsonResponse
    {
        return $this->json(Json::user($user) + ['is_admin' => $admins->isAdmin($user)]);
    }

    /**
     * E-mail accounts change their password (e.g. the temporary one an admin set). Other
     * sessions are logged out; this one stays. Wrong current passwords count towards the
     * login limit, so this is no way around it.
     */
    #[Route('/password', name: 'api_me_password', methods: ['PUT'])]
    public function changePassword(
        #[CurrentUser] User $user,
        #[MapRequestPayload] ChangePasswordRequest $payload,
        Request $request,
        UserPasswordHasherInterface $hasher,
        LoginThrottle $throttle,
        ApiTokenRepository $tokens,
        EntityManagerInterface $em,
        ClockInterface $clock,
    ): Response {
        $email = $user->getEmail();
        if (null === $email) {
            return Problem::response(409, 'This account logs in with Discord and has no password.');
        }
        $ip = (string) $request->getClientIp();
        if (null !== $retryAfter = $throttle->retryAfter($email, $ip, $clock->now())) {
            return AuthController::tooManyAttempts($retryAfter);
        }
        if (!$hasher->isPasswordValid($user, (string) $payload->currentPassword)) {
            $throttle->recordFailure($email, $ip, $clock->now());

            return Problem::response(422, 'The submitted data is invalid.', [
                'type' => 'https://datatracker.ietf.org/doc/html/rfc4918#section-11.2',
                'violations' => [['property_path' => 'current_password', 'title' => 'This is not your current password.']],
            ]);
        }

        $user->setPassword($hasher->hashPassword($user, (string) $payload->newPassword));
        $current = $tokens->findOneByPlainToken(trim(substr((string) $request->headers->get('Authorization'), 7)));
        $tokens->deleteAllOf($user, except: $current);
        $em->flush();

        return new Response(status: 204);
    }

    /**
     * One-time code the player types into the bot's /link command to connect Discord.
     */
    #[Route('/discord-link-code', name: 'api_me_discord_link_code', methods: ['POST'])]
    public function discordLinkCode(#[CurrentUser] User $user, EntityManagerInterface $em, ClockInterface $clock): JsonResponse
    {
        $code = '';
        for ($i = 0; $i < 8; ++$i) {
            $code .= self::LINK_CODE_ALPHABET[random_int(0, \strlen(self::LINK_CODE_ALPHABET) - 1)];
        }

        $user->issueDiscordLinkCode($code, $clock->now()->modify('+10 minutes'));
        $em->flush();

        return $this->json([
            'code' => $code,
            'expires_at' => Json::date($user->getDiscordLinkCodeExpiresAt()),
        ], 201);
    }
}
