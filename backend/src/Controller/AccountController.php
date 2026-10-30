<?php

namespace App\Controller;

use App\Entity\User;
use App\Http\Json;
use App\Security\AdminPolicy;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
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
