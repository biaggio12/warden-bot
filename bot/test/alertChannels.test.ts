import { describe, expect, it, vi } from "vitest";
import { AlertChannels, selectAlertChannels } from "../src/alertChannels.js";

const channel = (id: string, name: string, guild: string) => ({
  id,
  name,
  guild: { id: guild },
});

const channels = [
  channel("a1", "wardens-monza", "guild-a"),
  channel("a2", "monza-alerts", "guild-a"),
  channel("a3", "general", "guild-a"),
  channel("b1", "wardens-monza", "guild-b"),
  channel("b2", "wardens-secura", "guild-b"),
];

describe("selectAlertChannels", () => {
  it("goes by the channel name when no channel was chosen", () => {
    expect(
      selectAlertChannels(channels, [], "wardens-", "Monza").map((c) => c.id),
    ).toEqual(["a1", "b1"]);
  });

  it("uses the chosen channel instead of the named one on that server only", () => {
    const chosen = [
      { guild_id: "guild-a", server_name: "Monza", channel_id: "a2" },
    ];

    expect(
      selectAlertChannels(channels, chosen, "wardens-", "monza").map(
        (c) => c.id,
      ),
    ).toEqual(["a2", "b1"]);
    expect(
      selectAlertChannels(channels, chosen, "wardens-", "Secura").map(
        (c) => c.id,
      ),
    ).toEqual(["b2"]);
  });

  it("posts nowhere on a server whose chosen channel is gone", () => {
    const chosen = [
      { guild_id: "guild-a", server_name: "Monza", channel_id: "deleted" },
    ];

    expect(
      selectAlertChannels(channels, chosen, "wardens-", "Monza").map(
        (c) => c.id,
      ),
    ).toEqual(["b1"]);
  });

  it("lists every channel that may hold alerts for the startup sweep", () => {
    const chosen = [
      { guild_id: "guild-a", server_name: "Monza", channel_id: "a3" },
    ];

    expect(
      selectAlertChannels(channels, chosen, "wardens-").map((c) => c.id),
    ).toEqual(["a1", "a3", "b1", "b2"]);
  });
});

describe("AlertChannels", () => {
  const worlds = ["Monza", "Secura"];

  it("tells the world of a chosen channel, else of a named one", async () => {
    const alerts = new AlertChannels(
      async () => [
        { guild_id: "guild-a", server_name: "Secura", channel_id: "a3" },
      ],
      "wardens-",
    );

    expect(
      await alerts.worldOf(channel("a3", "general", "guild-a"), worlds),
    ).toBe("Secura");
    expect(
      await alerts.worldOf(channel("b1", "wardens-monza", "guild-b"), worlds),
    ).toBe("Monza");
    expect(
      await alerts.worldOf(channel("x", "wardens-atlantis", "guild-b"), worlds),
    ).toBeNull();
    expect(
      await alerts.worldOf(channel("x", "chat", "guild-b"), worlds),
    ).toBeNull();
  });

  it("names the chosen channel as a mention, else the channel name", async () => {
    const alerts = new AlertChannels(
      async () => [
        { guild_id: "guild-a", server_name: "Monza", channel_id: "a2" },
      ],
      "wardens-",
    );

    expect(await alerts.describe("guild-a", "Monza")).toBe("<#a2>");
    expect(await alerts.describe("guild-b", "Monza")).toBe("#wardens-monza");
  });

  it("keeps the last choices when the backend cannot be reached", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([
        { guild_id: "guild-a", server_name: "Monza", channel_id: "a2" },
      ])
      .mockRejectedValue(new Error("down"));
    const alerts = new AlertChannels(load, "wardens-", -1);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await alerts.select(channels, "Monza");
    expect((await alerts.select(channels, "Monza")).map((c) => c.id)).toEqual([
      "a2",
      "b1",
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
