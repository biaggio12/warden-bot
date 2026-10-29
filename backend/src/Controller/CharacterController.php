<?php

namespace App\Controller;

use App\Dto\CreateCharacterRequest;
use App\Entity\Character;
use App\Entity\User;
use App\Http\Json;
use App\Http\Problem;
use App\Repository\CharacterRepository;
use App\Security\CharacterVoter;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapQueryParameter;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

#[Route('/api/v1/characters')]
final class CharacterController extends AbstractController
{
    public function __construct(
        private readonly CharacterRepository $characters,
        private readonly EntityManagerInterface $em,
    ) {
    }

    #[Route('', name: 'api_characters_list', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, #[MapQueryParameter('server_name')] ?string $serverName = null): JsonResponse
    {
        return $this->json([
            'characters' => array_map(Json::character(...), $this->characters->findByUser($user, $serverName)),
        ]);
    }

    #[Route('', name: 'api_characters_create', methods: ['POST'])]
    public function create(#[CurrentUser] User $user, #[MapRequestPayload] CreateCharacterRequest $payload, WorldRegistry $worlds): JsonResponse
    {
        $name = trim((string) $payload->name);
        if ($this->characters->nameExists($name)) {
            return Problem::response(409, \sprintf('Character "%s" is already registered.', $name));
        }

        $character = new Character($user, $name, $worlds->canonicalize((string) $payload->serverName));
        $this->em->persist($character);
        $this->em->flush();

        return $this->json(Json::character($character), 201);
    }

    #[Route('/{character_id}', name: 'api_characters_delete', methods: ['DELETE'])]
    public function delete(string $character_id): Response
    {
        $character = $this->characters->findByIdString($character_id)
            ?? throw $this->createNotFoundException('Character not found.');
        $this->denyAccessUnlessGranted(CharacterVoter::EDIT, $character);

        $this->em->remove($character);
        $this->em->flush();

        return new Response(status: 204);
    }
}
