<?php

namespace App\Command;

use Psr\Log\LoggerInterface;
use Sentry\Logs\Logs;
use Sentry\State\HubInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Sends one log line and one test issue to Sentry and reports whether they were accepted.
 */
#[AsCommand(name: 'app:sentry-test', description: 'Send a test log and a test issue to Sentry')]
final class SentryTestCommand extends Command
{
    public function __construct(
        private readonly HubInterface $hub,
        private readonly LoggerInterface $logger,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $client = $this->hub->getClient();
        $options = $client?->getOptions();

        if (null === $options?->getDsn()) {
            $io->error('SENTRY_DSN is empty in this container - Sentry is disabled.');

            return Command::FAILURE;
        }

        $dsn = $options->getDsn();
        $io->definitionList(
            ['DSN host' => $dsn->getHost()],
            ['Project' => $dsn->getProjectId()],
            ['Environment' => (string) $options->getEnvironment()],
            ['Logs enabled' => $options->getEnableLogs() ? 'yes' : 'NO'],
        );

        $marker = 'sentry-test-'.date('His');
        $this->logger->info('Sentry test log {marker} from Warden Tracker', ['marker' => $marker]);
        $logEventId = Logs::getInstance()->flush();

        // The HTTP transport sends synchronously; a null id means Sentry did not accept the event.
        $issueEventId = $this->hub->captureMessage("Sentry test issue {$marker} from Warden Tracker");

        $io->definitionList(
            ['Log envelope' => null !== $logEventId ? 'sent ('.$logEventId.')' : 'NOT sent (no log was buffered)'],
            ['Issue' => null !== $issueEventId ? 'accepted ('.$issueEventId.')' : 'NOT accepted (network, DSN or rate limit problem)'],
        );

        if (null === $logEventId || null === $issueEventId) {
            return Command::FAILURE;
        }

        $io->success("Look for \"{$marker}\" in Sentry: Explore -> Logs and Issues.");

        return Command::SUCCESS;
    }
}
