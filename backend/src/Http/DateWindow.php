<?php

namespace App\Http;

use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * A `from` / `until` pair from the query string (ISO 8601 date-times; the website sends the
 * viewer's local midnights). Either end may be left out.
 */
final readonly class DateWindow
{
    private function __construct(
        public ?\DateTimeImmutable $from,
        public ?\DateTimeImmutable $until,
    ) {
    }

    /** The window, or a 400 problem response when the dates are not dates or out of order. */
    public static function parse(?string $from, ?string $until, ?int $maxDays = null): self|JsonResponse
    {
        try {
            $start = null === $from || '' === $from ? null : new \DateTimeImmutable($from);
            $end = null === $until || '' === $until ? null : new \DateTimeImmutable($until);
        } catch (\Exception) {
            return Problem::response(400, 'from and until must be dates and times.');
        }
        if (null !== $start && null !== $end && $start >= $end) {
            return Problem::response(400, 'from must be before until.');
        }
        if (null !== $maxDays && null !== $start && null !== $end && $start < $end->modify(\sprintf('-%d days', $maxDays))) {
            return Problem::response(400, \sprintf('from must be before until, at most %d days.', $maxDays));
        }

        return new self($start, $end);
    }

    /**
     * SQL conditions on `$column` and their parameters (UTC, as the database stores times).
     *
     * @return array{list<string>, array<string, string>}
     */
    public function sql(string $column): array
    {
        $utc = new \DateTimeZone('UTC');
        $where = [];
        $params = [];
        if (null !== $this->from) {
            $where[] = "$column >= :window_from";
            $params['window_from'] = $this->from->setTimezone($utc)->format('Y-m-d H:i:s');
        }
        if (null !== $this->until) {
            $where[] = "$column < :window_until";
            $params['window_until'] = $this->until->setTimezone($utc)->format('Y-m-d H:i:s');
        }

        return [$where, $params];
    }
}
