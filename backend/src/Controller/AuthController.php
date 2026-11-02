<?php

namespace App\Controller;

use App\Dto\CredentialsRequest;
use App\Entity\User;
use App\Http\Problem;
use App\Security\ApiTokenIssuer;
use App\Repository\UserRepository;
use App\Service\LoginThrottle;
use Symfony\Component\HttpFoundation\Request;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/v1/auth')]
final class AuthController extends AbstractController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserRepository $users,
        private readonly UserPasswordHasherInterface $hasher,
        private readonly ClockInterface $clock,
    ) {
    }

    #[Route('/register', name: 'api_auth_register', methods: ['POST'])]
    public function register(#[MapRequestPayload] CredentialsRequest $payload): JsonResponse
    {
        if (null !== $this->users->findOneByEmail((string) $payload->email)) {
            return Problem::response(409, 'An account with this e-mail address already exists.');
        }

        $user = new User((string) $payload->email);
        $user->setPassword($this->hasher->hashPassword($user, (string) $payload->password));
        $this->em->persist($user);

        return $this->issueToken($user, 201);
    }

    #[Route('/login', name: 'api_auth_login', methods: ['POST'])]
    public function login(#[MapRequestPayload] CredentialsRequest $payload, Request $request, LoginThrottle $throttle): JsonResponse
    {
        $email = (string) $payload->email;
        $ip = (string) $request->getClientIp();
        $now = $this->clock->now();
        if (null !== $retryAfter = $throttle->retryAfter($email, $ip, $now)) {
            return self::tooManyAttempts($retryAfter);
        }

        $user = $this->users->findOneByEmail($email);
        if (null === $user || !$this->hasher->isPasswordValid($user, (string) $payload->password)) {
            $throttle->recordFailure($email, $ip, $now);

            return Problem::response(401, 'Invalid e-mail or password.');
        }
        $throttle->clear($email);
        if ($user->isBlocked()) {
            return Problem::accountBlocked();
        }

        return $this->issueToken($user, 200);
    }

    public static function tooManyAttempts(int $retryAfter): JsonResponse
    {
        $response = Problem::response(429, \sprintf(
            'Too many wrong passwords. Try again in %s.',
            $retryAfter >= 60 ? \sprintf('%d min', (int) ceil($retryAfter / 60)) : \sprintf('%d s', $retryAfter),
        ), ['code' => 'login_limit']);
        $response->headers->set('Retry-After', (string) $retryAfter);

        return $response;
    }

    private function issueToken(User $user, int $status): JsonResponse
    {
        return $this->json(ApiTokenIssuer::issue($this->em, $this->clock, $user), $status);
    }
}
