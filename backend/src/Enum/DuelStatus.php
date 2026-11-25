<?php

namespace App\Enum;

enum DuelStatus: string
{
    /** Sent, waiting for the opponent to accept. */
    case Pending = 'PENDING';
    /** Accepted: both players' reports between starts_at and ends_at count. */
    case Active = 'ACTIVE';
    /** Time is up and the scores are in. */
    case Finished = 'FINISHED';
    /** The opponent said no, or the challenger took the challenge back. */
    case Declined = 'DECLINED';
    /** Nobody accepted in time. */
    case Expired = 'EXPIRED';

    public function isOpen(): bool
    {
        return self::Pending === $this || self::Active === $this;
    }
}
