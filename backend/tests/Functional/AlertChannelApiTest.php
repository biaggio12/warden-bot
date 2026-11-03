<?php

namespace App\Tests\Functional;

use App\Entity\AdminAction;
use App\Entity\AlertChannel;
use App\Security\AdminPolicy;

final class AlertChannelApiTest extends ApiTestCase
{
    private const ADMIN_DISCORD_ID = '111111111111111111';
    private const PLAYER_DISCORD_ID = '123456789012345678';
    private const GUILD = '100000000000000001';
    private const OTHER_GUILD = '100000000000000002';

    public function testAdminSeesServersChannelsWorldsAndChoices(): void
    {
        $token = $this->adminToken();
        $this->fakeServers();
        $this->em->persist(new AlertChannel(self::GUILD, 'Monza', self::channelIdOf(self::GUILD, 1), new \DateTimeImmutable()));
        $this->em->flush();

        $data = $this->requestJson('GET', '/api/v1/admin/alert-channels', null, $token);

        self::assertResponseIsSuccessful();
        self::assertTrue($data['enabled']);
        self::assertSame('wardens-', $data['prefix']);
        self::assertContains('Monza', $data['worlds']);
        self::assertSame(['Alpha', 'Zeta'], array_column($data['servers'], 'name'));
        self::assertSame(
            [['id' => self::channelIdOf(self::GUILD, 0), 'name' => 'general', 'category' => null], ['id' => self::channelIdOf(self::GUILD, 1), 'name' => 'monza-alerts', 'category' => null]],
            $data['servers'][0]['channels'],
        );
        self::assertSame([['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 1)]], $data['assignments']);
    }

    public function testOnlyAdminsManageChannels(): void
    {
        $token = $this->tokenFor($this->createUser('player@example.com', self::PLAYER_DISCORD_ID));
        $this->grantAdmins();

        $this->requestJson('GET', '/api/v1/admin/alert-channels', null, $token);
        self::assertResponseStatusCodeSame(403);
        $this->requestJson('PUT', '/api/v1/admin/alert-channels', ['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 1)], $token);
        self::assertResponseStatusCodeSame(403);
    }

    public function testAdminAssignsAChannelByIdAndChangesIt(): void
    {
        $token = $this->adminToken();
        $this->fakeServers();

        $data = $this->requestJson('PUT', '/api/v1/admin/alert-channels', ['guild_id' => self::GUILD, 'server_name' => 'monza', 'channel_id' => self::channelIdOf(self::GUILD, 1)], $token);

        self::assertResponseIsSuccessful();
        self::assertSame([['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 1)]], $data['assignments']);
        $entry = $this->em->getRepository(AdminAction::class)->findOneBy([])->toArray();
        self::assertSame(['set_alert_channel', 'Alpha', 'Monza → #monza-alerts'], [$entry['action'], $entry['player'], $entry['details']]);

        $data = $this->requestJson('PUT', '/api/v1/admin/alert-channels', ['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 0)], $token);

        self::assertResponseIsSuccessful();
        self::assertSame([self::channelIdOf(self::GUILD, 0)], array_column($data['assignments'], 'channel_id'));
    }

    public function testChoicesAreChecked(): void
    {
        $token = $this->adminToken();
        $this->fakeServers();
        $this->em->persist(new AlertChannel(self::GUILD, 'Secura', self::channelIdOf(self::GUILD, 1), new \DateTimeImmutable()));
        $this->em->flush();

        $cases = [
            'unknown world' => [['server_name' => 'Atlantis'], 'server_name'],
            'bot not on the server' => [['guild_id' => '100000000000000009'], 'guild_id'],
            'channel of another server' => [['channel_id' => self::channelIdOf(self::OTHER_GUILD, 0)], 'channel_id'],
            'channel taken by another world' => [['channel_id' => self::channelIdOf(self::GUILD, 1)], 'channel_id'],
        ];
        foreach ($cases as $case => [$override, $field]) {
            $data = $this->requestJson('PUT', '/api/v1/admin/alert-channels', $override + ['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 0)], $token);

            self::assertResponseStatusCodeSame(422, $case);
            self::assertSame($field, $data['violations'][0]['property_path'], $case);
        }
    }

    public function testAdminResetsAChoice(): void
    {
        $token = $this->adminToken();
        $this->fakeServers();
        $this->em->persist(new AlertChannel(self::GUILD, 'Monza', self::channelIdOf(self::GUILD, 1), new \DateTimeImmutable()));
        $this->em->flush();

        $data = $this->requestJson('DELETE', '/api/v1/admin/alert-channels/'.self::GUILD.'/Monza', null, $token);

        self::assertResponseIsSuccessful();
        self::assertSame([], $data['assignments']);
        $this->requestJson('DELETE', '/api/v1/admin/alert-channels/'.self::GUILD.'/Monza', null, $token);
        self::assertResponseStatusCodeSame(404);
    }

    public function testBotReadsTheChoices(): void
    {
        $this->em->persist(new AlertChannel(self::GUILD, 'Monza', self::channelIdOf(self::GUILD, 1), new \DateTimeImmutable()));
        $this->em->flush();

        $data = $this->requestJson('GET', '/api/v1/internal/alert-channels', token: self::BOT_TOKEN);

        self::assertResponseIsSuccessful();
        self::assertSame([['guild_id' => self::GUILD, 'server_name' => 'Monza', 'channel_id' => self::channelIdOf(self::GUILD, 1)]], $data['alert_channels']);
    }

    public function testWebReportFormOffersServersWithAChosenChannel(): void
    {
        $token = $this->tokenFor($this->createUser('player@example.com', self::PLAYER_DISCORD_ID));
        $this->fakeServers();
        // Alpha has no #wardens-monza, but a chosen channel; Zeta still goes by the name.
        $this->em->persist(new AlertChannel(self::GUILD, 'Monza', self::channelIdOf(self::GUILD, 1), new \DateTimeImmutable()));
        $this->em->flush();

        $data = $this->requestJson('GET', '/api/v1/discord-guilds?server_name=Monza', null, $token);

        self::assertResponseIsSuccessful();
        self::assertSame(['Alpha', 'Zeta'], array_column($data['guilds'], 'name'));
    }

    public function testAChosenChannelThatWasDeletedOffersNothing(): void
    {
        $token = $this->tokenFor($this->createUser('player@example.com', self::PLAYER_DISCORD_ID));
        $this->fakeServers();
        $this->em->persist(new AlertChannel(self::OTHER_GUILD, 'Monza', '999999999999999999', new \DateTimeImmutable()));
        $this->em->flush();

        $data = $this->requestJson('GET', '/api/v1/discord-guilds?server_name=Monza', null, $token);

        self::assertSame([], $data['guilds']);
    }

    private function fakeServers(): void
    {
        $this->fakeDiscordGuilds([
            ['id' => self::GUILD, 'name' => 'Alpha', 'channels' => ['general', 'monza-alerts'], 'members' => [self::PLAYER_DISCORD_ID]],
            ['id' => self::OTHER_GUILD, 'name' => 'Zeta', 'channels' => ['wardens-monza'], 'members' => [self::PLAYER_DISCORD_ID]],
        ]);
    }

    private function adminToken(): string
    {
        $token = $this->tokenFor($this->createUser('admin@example.com', self::ADMIN_DISCORD_ID));
        $this->grantAdmins();

        return $token;
    }

    private function grantAdmins(): void
    {
        $this->client->disableReboot();
        static::getContainer()->set(AdminPolicy::class, new AdminPolicy(self::ADMIN_DISCORD_ID));
    }
}
