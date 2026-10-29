<?php

namespace App\Service;

/**
 * Reduces user input to plain text: removes markup (including the contents of
 * script/style blocks), control characters and angle brackets, and collapses
 * whitespace. Clients still escape on output; this is defence in depth.
 */
final class PlainTextSanitizer
{
    /**
     * Single line: every run of whitespace, including newlines, becomes one space.
     */
    public static function sanitize(string $input): string
    {
        $text = preg_replace('/\s+/u', ' ', self::stripMarkup($input)) ?? '';

        return trim($text);
    }

    /**
     * Multi-line: keeps line breaks (at most one empty line in a row), collapses other whitespace.
     */
    public static function sanitizeMultiline(string $input): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $input);
        $lines = array_map(
            static fn (string $line): string => trim(preg_replace('/[^\S\n]+/u', ' ', $line) ?? ''),
            explode("\n", self::stripMarkup($text, keepNewlines: true)),
        );
        $text = preg_replace("/\n{3,}/", "\n\n", implode("\n", $lines)) ?? '';

        return trim($text);
    }

    private static function stripMarkup(string $input, bool $keepNewlines = false): string
    {
        $text = preg_replace('#<(script|style)\b[^>]*>.*?</\1\s*>#is', ' ', $input) ?? '';
        $text = strip_tags($text);
        $text = html_entity_decode($text, \ENT_QUOTES | \ENT_HTML5, 'UTF-8');
        $text = str_replace(['<', '>'], '', $text);
        $controls = $keepNewlines ? '/[^\P{Cc}\n]|\p{Cf}/u' : '/[\p{Cc}\p{Cf}]+/u';

        return preg_replace($controls, ' ', $text) ?? '';
    }
}
