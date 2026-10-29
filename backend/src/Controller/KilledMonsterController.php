<?php

namespace App\Controller;

use App\Dto\BulkKilledMonstersRequest;
use App\Dto\MarkMonsterKilledRequest;
use App\Entity\Character;
use App\Http\Json;
use App\Http\Problem;
use App\Repository\CharacterKilledMonsterRepository;
use App\Repository\CharacterRepository;
use App\Repository\MonsterRepository;
use App\Security\CharacterVoter;
use Psr\Clock\ClockInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/v1/characters/{character_id}/killed-monsters')]
final class KilledMonsterController extends AbstractController
{
    public function __construct(
        private readonly CharacterRepository $characters,
        private readonly MonsterRepository $monsters,
        private readonly CharacterKilledMonsterRepository $kills,
        private readonly ClockInterface $clock,
    ) {
    }

    #[Route('', name: 'api_killed_monsters_list', methods: ['GET'])]
    public function list(string $character_id): JsonResponse
    {
        $character = $this->loadCharacter($character_id, CharacterVoter::VIEW);

        return $this->json([
            'character_id' => $character->getId()->toRfc4122(),
            'monster_ids' => $this->kills->findKilledMonsterIds($character),
        ]);
    }

    /**
     * Idempotent: 201 when the kill is recorded for the first time, 200 when it already was.
     */
    #[Route('', name: 'api_killed_monsters_mark', methods: ['POST'])]
    public function mark(string $character_id, #[MapRequestPayload] MarkMonsterKilledRequest $payload): JsonResponse
    {
        $character = $this->loadCharacter($character_id, CharacterVoter::EDIT);
        $monster = $this->monsters->find((int) $payload->monsterId)
            ?? throw $this->createNotFoundException('Monster not found.');

        $created = $this->kills->markKilled($character, $monster, $this->clock->now());
        $kill = $this->kills->findOneFor($character, $monster);

        return $this->json([
            'character_id' => $character->getId()->toRfc4122(),
            'monster_id' => $monster->getId(),
            'killed_at' => Json::date($kill->getKilledAt()),
        ], $created ? 201 : 200);
    }

    /**
     * Bulk edit used by the bestiary view: one request for a whole category.
     */
    #[Route('', name: 'api_killed_monsters_bulk', methods: ['PUT'])]
    public function bulk(string $character_id, #[MapRequestPayload] BulkKilledMonstersRequest $payload): JsonResponse
    {
        $character = $this->loadCharacter($character_id, CharacterVoter::EDIT);

        $add = array_values(array_unique($payload->add));
        $remove = array_values(array_diff(array_unique($payload->remove), $add));

        $unknown = array_values(array_diff(array_merge($add, $remove), $this->monsters->findExistingIds(array_merge($add, $remove))));
        if ([] !== $unknown) {
            return Problem::response(404, 'Unknown monster ids: '.implode(', ', $unknown).'.', ['unknown_monster_ids' => $unknown]);
        }

        $this->kills->applyBulkChange($character, $add, $remove, $this->clock->now());

        return $this->json([
            'character_id' => $character->getId()->toRfc4122(),
            'monster_ids' => $this->kills->findKilledMonsterIds($character),
        ]);
    }

    private function loadCharacter(string $id, string $attribute): Character
    {
        $character = $this->characters->findByIdString($id)
            ?? throw $this->createNotFoundException('Character not found.');
        $this->denyAccessUnlessGranted($attribute, $character, 'This character does not belong to your account.');

        return $character;
    }
}
