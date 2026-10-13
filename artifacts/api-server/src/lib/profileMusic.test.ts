import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {}, pool: { query: vi.fn() } }));

import { configuredProvider, parseStoredSong, songFromAppleMusic } from "./profileMusic";

const resource = {
  id: "1440833098",
  attributes: {
    name: "blue", artistName: "yung kai",
    artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg" },
    previews: [{ url: "https://audio-ssl.itunes.apple.com/preview.m4a" }],
    url: "https://music.apple.com/us/song/blue/1440833098",
  },
};

describe("songFromAppleMusic", () => {
  it("maps a song with a preview", () => {
    expect(songFromAppleMusic(resource)).toEqual({
      provider: "apple_music", id: "1440833098", title: "blue", artist: "yung kai",
      artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/x/120x120bb.jpg",
      previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a",
      url: "https://music.apple.com/us/song/blue/1440833098",
    });
  });
  it("drops a song without a preview or with a non-https preview", () => {
    expect(songFromAppleMusic({ ...resource, attributes: { ...resource.attributes, previews: [] } })).toBeNull();
    expect(songFromAppleMusic({ ...resource, attributes: { ...resource.attributes, previews: [{ url: "http://x" }] } })).toBeNull();
    expect(songFromAppleMusic(null)).toBeNull();
  });
});

describe("configuredProvider", () => {
  it("is off with nothing set", () => {
    expect(configuredProvider({})).toBeNull();
  });
  it("is off with the provider named but no token", () => {
    expect(configuredProvider({ PROFILE_MUSIC_PROVIDER: "apple_music" })).toBeNull();
    expect(configuredProvider({ PROFILE_MUSIC_PROVIDER: "apple_music", APPLE_MUSIC_DEVELOPER_TOKEN: "  " })).toBeNull();
  });
  it("is off for an unknown provider", () => {
    expect(configuredProvider({ PROFILE_MUSIC_PROVIDER: "spotify", APPLE_MUSIC_DEVELOPER_TOKEN: "t" })).toBeNull();
  });
  it("is on with both set", () => {
    expect(configuredProvider({ PROFILE_MUSIC_PROVIDER: "apple_music", APPLE_MUSIC_DEVELOPER_TOKEN: "t" })).not.toBeNull();
  });
});

describe("parseStoredSong", () => {
  it("round-trips a mapped song", () => {
    const song = songFromAppleMusic(resource)!;
    expect(parseStoredSong(JSON.parse(JSON.stringify(song)))).toEqual(song);
  });
  it("rejects anything else", () => {
    expect(parseStoredSong(null)).toBeNull();
    expect(parseStoredSong({ provider: "other", id: "1" })).toBeNull();
  });
});
