<?php

namespace App\Http;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * RFC 7807 "Problem Details for HTTP APIs" responses.
 */
final class Problem
{
    public const CONTENT_TYPE = 'application/problem+json';

    /** The same answer wherever a blocked account tries to get in. */
    public static function accountBlocked(): JsonResponse
    {
        return self::response(403, 'This account has been blocked by an admin.', ['code' => 'account_blocked']);
    }

    /**
     * @param array<string, mixed> $extra additional members (e.g. "violations")
     */
    public static function response(int $status, ?string $detail = null, array $extra = []): JsonResponse
    {
        $body = [
            'type' => $extra['type'] ?? 'about:blank',
            'title' => Response::$statusTexts[$status] ?? 'Error',
            'status' => $status,
        ];
        if (null !== $detail && '' !== $detail) {
            $body['detail'] = $detail;
        }
        unset($extra['type']);

        $response = new JsonResponse($body + $extra, $status, ['Content-Type' => self::CONTENT_TYPE]);
        $response->setEncodingOptions($response->getEncodingOptions() | \JSON_UNESCAPED_UNICODE | \JSON_UNESCAPED_SLASHES);

        return $response;
    }
}
