<?php

namespace App\Controller;

use App\Dto\BotBackOnlineRequest;
use App\Dto\BotMaintenanceRequest;
use App\Entity\AdminAction;
use App\Entity\User;
use App\Http\Problem;
use App\Message\BotBackOnlineEvent;
use App\Message\BotMaintenanceEvent;
use App\Security\AdminPolicy;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

/**
 * Admins (not moderators): before a deploy, the bot posts "down for a moment" in every
 * alert channel on every Discord server, and after it "back". The same notices as the bot's
 * /maintenance start and /maintenance end.
 */
final class BotMaintenanceController extends AbstractController
{
    public function __construct(
        private readonly AdminPolicy $admins,
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('/api/v1/admin/bot-maintenance', name: 'api_admin_bot_maintenance', methods: ['POST'])]
    public function announce(
        #[CurrentUser] User $admin,
        MessageBusInterface $bus,
        #[MapRequestPayload] BotMaintenanceRequest $payload = new BotMaintenanceRequest(),
    ): JsonResponse {
        if (!$this->admins->isAdmin($admin)) {
            return Problem::response(403, 'Admins only.');
        }
        $now = $this->clock->now();
        $backAt = null === $payload->minutes ? null : $now->modify(\sprintf('+%d minutes', $payload->minutes));
        $note = self::note($payload->message);

        $details = null === $payload->minutes ? 'no time given' : \sprintf('back in about %d min', $payload->minutes);
        $this->em->persist(new AdminAction($admin, null, 'bot_maintenance', $details, $now, target: 'Discord'));
        $this->em->flush();
        $bus->dispatch(new BotMaintenanceEvent($backAt, $note, $admin->getDisplayName()));
        $this->logger->info('Admin {admin}: posted the bot maintenance notice ({details}).', ['admin' => $admin->getDisplayName(), 'details' => $details]);

        return $this->json(['back_at' => $backAt?->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z')], Response::HTTP_ACCEPTED);
    }

    #[Route('/api/v1/admin/bot-back-online', name: 'api_admin_bot_back_online', methods: ['POST'])]
    public function backOnline(
        #[CurrentUser] User $admin,
        MessageBusInterface $bus,
        #[MapRequestPayload] BotBackOnlineRequest $payload = new BotBackOnlineRequest(),
    ): JsonResponse {
        if (!$this->admins->isAdmin($admin)) {
            return Problem::response(403, 'Admins only.');
        }
        $this->em->persist(new AdminAction($admin, null, 'bot_back_online', null, $this->clock->now(), target: 'Discord'));
        $this->em->flush();
        $bus->dispatch(new BotBackOnlineEvent(self::note($payload->message), $admin->getDisplayName()));
        $this->logger->info('Admin {admin}: posted the "bot is back" notice.', ['admin' => $admin->getDisplayName()]);

        return $this->json([], Response::HTTP_ACCEPTED);
    }

    private static function note(?string $message): ?string
    {
        $note = trim((string) $message);

        return '' === $note ? null : $note;
    }
}
