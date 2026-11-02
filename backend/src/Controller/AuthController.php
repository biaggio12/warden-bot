<?php

namespace App\Controller;

use App\Dto\CredentialsRequest;
use App\Entity\User;
use App\Http\Problem;
use App\Security\ApiTokenIssuer;
use App\Repository\UserRepository;
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
    public function login(#[MapRequestPayload] CredentialsRequest $payload): JsonResponse
    {
        $user = $this->users->findOneByEmail((string) $payload->email);
        if (null === $user || !$this->hasher->isPasswordValid($user, (string) $payload->password)) {
            return Problem::response(401, 'Invalid e-mail or password.');
        }
        if ($user->isBlocked()) {
            return Problem::accountBlocked();
        }

        return $this->issueToken($user, 200);
    }

    private function issueToken(User $user, int $status): JsonResponse
    {
        return $this->json(ApiTokenIssuer::issue($this->em, $this->clock, $user), $status);
    }
}
