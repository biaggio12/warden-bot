<?php

namespace App\Security;

use App\Entity\Character;
use App\Entity\User;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Authorization\Voter\Vote;
use Symfony\Component\Security\Core\Authorization\Voter\Voter;

/**
 * @extends Voter<string, Character>
 */
final class CharacterVoter extends Voter
{
    public const VIEW = 'CHARACTER_VIEW';
    public const EDIT = 'CHARACTER_EDIT';

    protected function supports(string $attribute, mixed $subject): bool
    {
        return \in_array($attribute, [self::VIEW, self::EDIT], true) && $subject instanceof Character;
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token, ?Vote $vote = null): bool
    {
        $user = $token->getUser();

        if ($user instanceof User && $subject->isOwnedBy($user)) {
            return true;
        }

        $vote?->addReason('This character does not belong to your account.');

        return false;
    }
}
