<?php

namespace App\Tests\Unit;

use App\Service\PlainTextSanitizer;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PlainTextSanitizerTest extends TestCase
{
    #[DataProvider('cases')]
    public function testSanitize(string $input, string $expected): void
    {
        self::assertSame($expected, PlainTextSanitizer::sanitize($input));
    }

    public function testMultilineKeepsLineBreaks(): void
    {
        self::assertSame(
            "Respi co 2 min\n\nUważaj na PK",
            PlainTextSanitizer::sanitizeMultiline("  Respi   co 2 min \r\n\n\n\n<b>Uważaj</b> na PK \x07"),
        );
    }

    public static function cases(): iterable
    {
        yield 'plain text untouched' => ['Venore Dragon Lair -2, przy bramce', 'Venore Dragon Lair -2, przy bramce'];
        yield 'script removed with content' => ['Lair <script>alert(1)</script>-2', 'Lair -2'];
        yield 'tags stripped' => ['<b onclick="x()">Lair</b> <img src=x onerror=alert(1)>', 'Lair'];
        yield 'encoded brackets do not survive' => ['&lt;script&gt;alert(1)&lt;/script&gt;', 'scriptalert(1)/script'];
        yield 'entities decoded' => ['Tom &amp; Jerry', 'Tom & Jerry'];
        yield 'whitespace collapsed' => ["  Lair\n\t-2  ", 'Lair -2'];
        yield 'unicode kept' => ['Żółta brama', 'Żółta brama'];
    }
}
