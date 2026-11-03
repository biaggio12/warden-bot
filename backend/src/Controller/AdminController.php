<?php

namespace App\Controller;

use App\Dto\CreateCharacterRequest;
use App\Entity\AdminAction;
use App\Entity\Character;
use App\Entity\User;
use App\Http\Problem;
use App\Repository\ApiTokenRepository;
use App\Repository\CharacterRepository;
use App\Repository\UserRepository;
use App\Repository\WardenSpawnRepository;
use App\Message\WardenDeletedEvent;
use App\Security\AdminPolicy;
use App\Service\ReporterStats;
use App\Service\UserDirectory;
use App\Service\WorldRegistry;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * The Players tab: every account, and what staff may do to another player's account.
 * Admins (and the admin's own account) cannot be blocked, deleted or unlinked here:
 * admin rights follow the Discord account, so that would lock an admin out.
 *
 * Moderators (granted here by an admin) see the tab, report stats and history, delete
 * reports, block / unblock and manage characters, but only of players who are not staff.
 * Unlinking Discord, resetting passwords, deleting accounts and the moderator rank stay
 * with the admins.
 */
#[Route('/api/v1/admin')]
final class AdminController extends AbstractController
{
    private const ADMINS = 'admins';
    private const STAFF = 'staff';

    /** Extra words for the history entry of the action in progress (e.g. which character). */
    private ?string $details = null;

    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly UserRepository $users,
        private readonly UserDirectory $directory,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
        private readonly ClockInterface $clock,
    ) {
    }

    /** The newest admin actions, for the history in the Players tab. */
    #[Route('/actions', name: 'api_admin_actions', methods: ['GET'])]
    public function actions(#[CurrentUser] User $admin): JsonResponse
    {
        if ($denied = $this->notAllowed($admin, self::STAFF)) {
            return $denied;
        }
        $actions = $this->em->getRepository(AdminAction::class)->findBy([], ['createdAt' => 'DESC', 'id' => 'DESC'], 50);

        return $this->json(['actions' => array_map(static fn (AdminAction $a): array => ['created_at' => \App\Http\Json::date($a->toArray()['created_at'])] + $a->toArray(), $actions)]);
    }

    /**
     * A new random password for an e-mail account, shown to the admin once (they pass it
     * on). The player's sessions are logged out; they change it in the Characters tab.
     */
    #[Route('/users/{id<\d+>}/reset-password', name: 'api_admin_user_reset_password', methods: ['POST'])]
    public function resetPassword(int $id, #[CurrentUser] User $admin, UserPasswordHasherInterface $hasher, ApiTokenRepository $tokens): JsonResponse
    {
        $password = null;
        $response = $this->onPlayer($admin, $id, true, static function (User $player) use ($hasher, $tokens, &$password): ?JsonResponse {
            if (null === $player->getEmail()) {
                return Problem::response(409, 'This account logs in with Discord only and has no password.');
            }
            $password = self::temporaryPassword();
            $player->setPassword($hasher->hashPassword($player, $password));
            $tokens->deleteAllOf($player);

            return null;
        }, 'reset_password', self::ADMINS);

        if (null === $password) {
            return $response;
        }

        return $this->json(['password' => $password, 'user' => json_decode((string) $response->getContent(), true)]);
    }

    #[Route('/users', name: 'api_admin_users', methods: ['GET'])]
    public function users(#[CurrentUser] User $admin): JsonResponse
    {
        if ($denied = $this->notAllowed($admin, self::STAFF)) {
            return $denied;
        }

        return $this->json(['users' => $this->directory->all()]);
    }

    /** How often and what one player has reported: for the Reports panel in the Players tab. */
    #[Route('/users/{id<\d+>}/reports', name: 'api_admin_user_reports', methods: ['GET'])]
    public function reports(int $id, #[CurrentUser] User $admin, ReporterStats $stats): JsonResponse
    {
        if ($denied = $this->notAllowed($admin, self::STAFF)) {
            return $denied;
        }
        if (null === $this->users->find($id)) {
            throw $this->createNotFoundException('Player not found.');
        }

        return $this->json($stats->of($id));
    }

    /**
     * Deletes a report (false or duplicate) so it leaves the stats; the bot deletes its alerts
     * on Discord. Answers with the reporter's updated row (null when their account is gone).
     */
    #[Route('/reports/{spawnId}', name: 'api_admin_report_delete', methods: ['DELETE'])]
    public function deleteReport(string $spawnId, #[CurrentUser] User $admin, WardenSpawnRepository $spawns, MessageBusInterface $bus): JsonResponse
    {
        if ($denied = $this->notAllowed($admin, self::STAFF)) {
            return $denied;
        }
        $spawn = $spawns->findByIdString($spawnId) ?? throw $this->createNotFoundException('Report not found.');
        $reporter = $spawn->getReportedBy();
        $event = new WardenDeletedEvent($spawn->getId()->toRfc4122(), $spawn->getServerName());
        $details = \sprintf('%s on %s, %s UTC', $spawn->getMonster()->getName(), $spawn->getServerName(), $spawn->getCreatedAt()->setTimezone(new \DateTimeZone('UTC'))->format('j M H:i'));

        $this->em->remove($spawn);
        $this->em->persist(new AdminAction($admin, $reporter, 'delete_report', $details, $this->clock->now()));
        $this->em->flush();
        $bus->dispatch($event);
        $this->logger->info('Admin {admin}: deleted report {spawn} ({details}).', ['admin' => $admin->getDisplayName(), 'spawn' => $event->spawnId, 'details' => $details]);

        return $this->json(['user' => null === $reporter ? null : $this->directory->one((int) $reporter->getId())]);
    }

    /** Admins only: the Players tab for another player, without the admin-only actions. */
    #[Route('/users/{id<\d+>}/moderator', name: 'api_admin_user_moderator_grant', methods: ['POST'])]
    public function grantModerator(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, static function (User $player): ?JsonResponse {
            if ($player->isBlocked()) {
                return Problem::response(409, 'Unblock the account first.');
            }
            if ($player->isModerator()) {
                return Problem::response(409, 'This player is already a moderator.');
            }
            $player->setModerator(true);

            return null;
        }, 'grant_moderator', self::ADMINS);
    }

    #[Route('/users/{id<\d+>}/moderator', name: 'api_admin_user_moderator_revoke', methods: ['DELETE'])]
    public function revokeModerator(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, static function (User $player): ?JsonResponse {
            if (!$player->isModerator()) {
                return Problem::response(409, 'This player is not a moderator.');
            }
            $player->setModerator(false);

            return null;
        }, 'revoke_moderator', self::ADMINS);
    }

    /** Can no longer log in, report or be pinged; their sessions stop working at once. */
    #[Route('/users/{id<\d+>}/block', name: 'api_admin_user_block', methods: ['POST'])]
    public function block(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, function (User $player): void {
            $player->block($this->clock->now());
        }, 'block');
    }

    #[Route('/users/{id<\d+>}/unblock', name: 'api_admin_user_unblock', methods: ['POST'])]
    public function unblock(int $id, #[CurrentUser] User $admin): JsonResponse
    {
        return $this->onPlayer($admin, $id, true, static fn (User $player) => $player->unblock(), 'unblock');
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
        }, 'unlink_discord', self::ADMINS);
    }

    /** Characters, bestiary and sessions go with it; the reports stay in the stats without a reporter. */
    #[Route('/users/{id<\d+>}', name: 'api_admin_user_delete', methods: ['DELETE'])]
    public function delete(int $id, #[CurrentUser] User $admin): Response
    {
        if ($denied = $this->notAllowed($admin, self::ADMINS)) {
            return $denied;
        }
        $player = $this->users->find($id) ?? throw $this->createNotFoundException('Player not found.');
        if ($denied = $this->protectedAccount($admin, $player, true)) {
            return $denied;
        }

        $label = $player->getDisplayName();
        $this->em->persist(new AdminAction($admin, $player, 'delete', null, $this->clock->now()));
        $this->em->flush();
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
            $world = $worlds->canonicalize((string) $payload->serverName);
            $this->em->persist(new Character($player, $name, $world));
            $this->details = "$name ($world)";

            return null;
        }, 'add_character');
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
            $this->details = \sprintf('%s (%s)', $character->getName(), $character->getServerName());

            return null;
        }, 'delete_character');
    }

    /**
     * Applies `$change` to the player and answers with their updated row. `$change` may
     * answer with a problem instead. `$protect`: refused for admins and one's own account.
     * Moderators never change staff accounts. `$who`: who may do it (STAFF or ADMINS).
     *
     * @param callable(User): (JsonResponse|null|void) $change
     */
    private function onPlayer(User $admin, int $id, bool $protect, callable $change, string $what, string $who = self::STAFF): JsonResponse
    {
        if ($denied = $this->notAllowed($admin, $who)) {
            return $denied;
        }
        $player = $this->users->find($id) ?? throw $this->createNotFoundException('Player not found.');
        if ($denied = $this->protectedAccount($admin, $player, $protect)) {
            return $denied;
        }
        $this->details = null;
        if (($problem = $change($player)) instanceof JsonResponse) {
            return $problem;
        }
        $this->em->persist(new AdminAction($admin, $player, $what, $this->details, $this->clock->now()));
        $this->em->flush();
        $this->logger->info('Admin {admin}: {what} on {player}.', ['admin' => $admin->getDisplayName(), 'player' => $player->getDisplayName(), 'what' => $what]);

        return $this->json($this->directory->one($id));
    }

    /** 12 characters without look-alikes (0/O, 1/l/I), easy to read out on Discord. */
    private static function temporaryPassword(): string
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $password = '';
        for ($i = 0; $i < 12; ++$i) {
            $password .= $alphabet[random_int(0, \strlen($alphabet) - 1)];
        }

        return $password;
    }

    private function protectedAccount(User $actor, User $player, bool $protect): ?JsonResponse
    {
        if ($protect && $player->getId() === $actor->getId()) {
            return Problem::response(403, 'You cannot do this to your own account.');
        }
        if ($protect && $this->admins->isAdmin($player)) {
            return Problem::response(403, 'Admin accounts cannot be changed here. Remove them from ADMIN_DISCORD_IDS first.');
        }
        if (!$this->admins->isAdmin($actor) && $this->admins->isStaff($player)) {
            return Problem::response(403, 'Moderators cannot change admin or moderator accounts.');
        }

        return null;
    }

    private function notAllowed(User $actor, string $who): ?JsonResponse
    {
        if ($this->admins->isAdmin($actor)) {
            return null;
        }
        if (self::STAFF === $who && $this->admins->isStaff($actor)) {
            return null;
        }

        return Problem::response(403, self::STAFF === $who ? 'Admins and moderators only.' : 'Admins only.');
    }
}
