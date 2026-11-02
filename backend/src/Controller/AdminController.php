<?php

namespace App\Controller;

use App\Dto\CreateCharacterRequest;
use App\Entity\Character;
use App\Entity\User;
use App\Http\Problem;
use App\Repository\CharacterRepository;
use App\Repository\UserRepository;
use App\Security\AdminPolicy;
use App\Service\UserDirectory;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The Players tab: every account, and what an admin may do to another player's account.
 * Admins (and the admin's own account) cannot be blocked, deleted or unlinked here:
 * admin rights follow the Discord account, so that would lock an admin out.
 */
#[Route('/api/v1/admin')]
final class AdminController extends AbstractController
{
    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly UserRepository $users,
        private readonly UserDirectory $directory,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('/users', name: 'api_admin_users', methods: ['GET'])]
    public function users(#[CurrentUser] User $admin): JsonResponse
    {
        if (!$this->admins->isAdmin($admin)) {
            return Problem::response(403, 'Admins only.');
        }

        return $this->json(['users' => $this->directory->all()]);
    }

    /** Can no longer log in, report or be pinged; their sessions stop working at once. */
    #[Route('/users/{id<\d+>}/block', name: 'api_admin_user_block', methods: ['POST'])]
    public function block(int $id, #[CurrentUser] User $admin, ClockInterface $clock): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, function (User $player) use ($clock): void {
            $player->block($clock->now());
        }, 'blocked');
    }

    #[Route('/users/{id<\d+>}/unblock', name: 'api_admin_user_unblock', methods: ['POST'])]
    public function unblock(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, static fn (User $player) => $player->unblock(), 'unblocked');
    }

    #[Route('/users/{id<\d+>}/unlink-discord', name: 'api_admin_user_unlink', methods: ['POST'])]
    public function unlinkDiscord(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, static function (User $player): ?JsonResponse {
            // Otherwise "Log in with Discord" would make the blocked player a fresh account.
            if ($player->isBlocked()) {
                return Problem::response(409, 'Unblock the account first: unlinking a blocked account would let them sign up again with Discord.');
            }
            $player->unlinkDiscord();

            return null;
        }, 'unlinked from Discord');
    }

    /** Characters, bestiary and sessions go with it; the reports stay in the stats without a reporter. */
    #[Route('/users/{id<\d+>}', name: 'api_admin_user_delete', methods: ['DELETE'])]
    public function delete(int $id, #[CurrentUser] User $admin): Response
    {
        if (!$this->admins->isAdmin($admin)) {
            return Problem::response(403, 'Admins only.');
        }
        $player = $this->users->find($id) ?? throw $this->createNotFoundException('Player not found.');
        if ($denied = $this->protectedAccount($admin, $player)) {
            return $denied;
        }

        $label = $player->getDisplayName();
        // In SQL, so the database cascades do the rest (characters, bestiary, tokens; reports keep no reporter).
        $this->em->getConnection()->delete('users', ['id' => $id]);
        $this->em->clear();
        $this->logger->info('Admin {admin} deleted the account {player}.', ['admin' => $admin->getDisplayName(), 'player' => $label]);

        return new Response(status: 204);
    }

    #[Route('/users/{id<\d+>}/characters', name: 'api_admin_character_add', methods: ['POST'])]
    public function addCharacter(
        int $id,
        #[CurrentUser] User $admin,
        #[MapRequestPayload] CreateCharacterRequest $payload,
        CharacterRepository $characters,
        WorldRegistry $worlds,
    ): JsonResponse {
        return $this->onPlayer($admin, $id, false, function (User $player) use ($payload, $characters, $worlds): ?JsonResponse {
            $name = trim((string) $payload->name);
            if ($characters->nameExists($name)) {
                return Problem::response(409, \sprintf('Character "%s" is already registered.', $name));
            }
            $this->em->persist(new Character($player, $name, $worlds->canonicalize((string) $payload->serverName)));

            return null;
        }, 'given a character');
    }

    #[Route('/users/{id<\d+>}/characters/{characterId}', name: 'api_admin_character_delete', methods: ['DELETE'])]
    public function deleteCharacter(int $id, string $characterId, #[CurrentUser] User $admin, CharacterRepository $characters): JsonResponse
    {
        return $this->onPlayer($admin, $id, false, function (User $player) use ($characterId, $characters): ?JsonResponse {
            $character = $characters->findByIdString($characterId);
            if (null === $character || $character->getUser()->getId() !== $player->getId()) {
                return Problem::response(404, 'Character not found.');
            }
            $this->em->remove($character);

            return null;
        }, 'had a character deleted');
    }

    /**
     * Applies `$change` to the player and answers with their updated row. `$change` may
     * answer with a problem instead. `$protect`: refused for admins and the admin's own account.
     *
     * @param callable(User): (JsonResponse|null|void) $change
     */
    private function onPlayer(User $admin, int $id, bool $protect, callable $change, string $what): JsonResponse
    {
        if (!$this->admins->isAdmin($admin)) {
            return Problem::response(403, 'Admins only.');
        }
        $player = $this->users->find($id) ?? throw $this->createNotFoundException('Player not found.');
        if ($protect && ($denied = $this->protectedAccount($admin, $player))) {
            return $denied;
        }
        if (($problem = $change($player)) instanceof JsonResponse) {
            return $problem;
        }
        $this->em->flush();
        $this->logger->info('Admin {admin}: {player} {what}.', ['admin' => $admin->getDisplayName(), 'player' => $player->getDisplayName(), 'what' => $what]);

        return $this->json($this->directory->one($id));
    }

    private function protectedAccount(User $admin, User $player): ?JsonResponse
    {
        if ($player->getId() === $admin->getId()) {
            return Problem::response(403, 'You cannot do this to your own account.');
        }
        if ($this->admins->isAdmin($player)) {
            return Problem::response(403, 'Admin accounts cannot be changed here. Remove them from ADMIN_DISCORD_IDS first.');
        }

        return null;
    }
}
