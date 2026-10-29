<?php

namespace App\Security;

use App\Entity\ApiToken;
use App\Entity\User;
use App\Http\Json;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;

/**
 * Creates a login token and the response body shared by every way of logging in.
 */
final class ApiTokenIssuer
{
    /**
     * @return array{token: string, expires_at: string, user: array<string, mixed>}
     */
    public static function issue(EntityManagerInterface $em, ClockInterface $clock, User $user): array
    {
        [$token, $plain] = ApiToken::issue($user, $clock->now());
        $em->persist($token);
        $em->flush();

        return [
            'token' => $plain,
            'expires_at' => Json::date($token->getExpiresAt()),
            'user' => Json::user($user),
        ];
    }
}
