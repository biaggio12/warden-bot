<?php

namespace App\Tests\Unit;

use App\Service\ReportScoring;
use PHPUnit\Framework\TestCase;

final class ReportScoringTest extends TestCase
{
    public function testPointsFollowTheBestiaryDifficulty(): void
    {
        // Charm points stand for the difficulty: Harmless 1, Trivial 5, Easy 15, Medium 25, Hard 50, Challenging 100.
        self::assertSame([1, 2, 3, 4, 10, 25], array_map(ReportScoring::pointsFor(...), [1, 5, 15, 25, 50, 100]));
        self::assertSame(1, ReportScoring::pointsFor(42), 'off the scale: the minimum');
    }
}
