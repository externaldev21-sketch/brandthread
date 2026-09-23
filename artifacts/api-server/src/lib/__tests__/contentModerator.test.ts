import { describe, expect, it } from "vitest";
import {
  classifyText,
  evaluateContent,
  matchesMutedWords,
  moderateMessage,
  normalizeMutedPhrase,
} from "../contentModerator";

describe("content filter — public surfaces (comments, captions, live chat)", () => {
  it("allows ordinary commerce chatter", () => {
    for (const text of [
      "Obsessed with this colorway 🔥",
      "What size should I get? I'm usually a medium",
      "This drop is badass, copping two",
      "Damn, that stitching is clean",
      "Cocktail dress season is here",
      "Is the fabric flame retardant?",
      "Shipping to Scunthorpe?",
      "Only $20 for the tee, class act",
    ]) {
      expect(evaluateContent(text, "public"), text).toEqual({ action: "allow" });
    }
  });

  it("holds profanity for review instead of publishing it", () => {
    const decision = evaluateContent("this is fucking fire", "public");
    expect(decision).toMatchObject({ action: "hold", category: "profanity" });
  });

  it("holds directed abuse and insults", () => {
    expect(evaluateContent("you're such a loser lol", "public"))
      .toMatchObject({ action: "hold", category: "abuse" });
    expect(evaluateContent("nobody likes you", "public"))
      .toMatchObject({ action: "hold", category: "abuse" });
  });

  it("holds scams and off-platform payment steering", () => {
    expect(evaluateContent("Pay me on Zelle instead, cheaper", "public"))
      .toMatchObject({ action: "hold", category: "spam_scam" });
    expect(evaluateContent("Claim your prize at bit.ly/abc", "public"))
      .toMatchObject({ action: "hold", category: "spam_scam" });
  });

  it("rejects slurs outright", () => {
    expect(evaluateContent("what a faggot", "public"))
      .toMatchObject({ action: "reject", category: "hate_speech" });
    expect(evaluateContent("you retard", "public"))
      .toMatchObject({ action: "reject", category: "hate_speech" });
  });

  it("rejects threats and doxxing outright", () => {
    expect(evaluateContent("I'm going to kill you", "public"))
      .toMatchObject({ action: "reject", category: "harassment" });
    expect(evaluateContent("i know where you live", "public"))
      .toMatchObject({ action: "reject", category: "harassment" });
    expect(evaluateContent("kys", "public"))
      .toMatchObject({ action: "reject", category: "harassment" });
  });

  it("sees through common evasion", () => {
    expect(evaluateContent("f u c k this", "public")).toMatchObject({ action: "hold" });
    expect(evaluateContent("fuuuuuck", "public")).toMatchObject({ action: "hold" });
    expect(evaluateContent("sh1t quality", "public")).toMatchObject({ action: "hold" });
    expect(evaluateContent("f@gg0t", "public")).toMatchObject({ action: "reject" });
    expect(evaluateContent("fa​ggot", "public")).toMatchObject({ action: "reject" });
    expect(evaluateContent("k i l l your self", "public")).toMatchObject({ action: "reject" });
  });

  it("does not rewrite prices into letters", () => {
    expect(classifyText("Earn $500 per day from home").categories).toContain("spam_scam");
    expect(evaluateContent("Retail was $150, selling for $120", "public")).toEqual({ action: "allow" });
  });
});

describe("content filter — DMs", () => {
  it("allows cussing between people in private messages", () => {
    expect(evaluateContent("holy shit this hoodie is sick, fuck yes", "dm")).toEqual({ action: "allow" });
    expect(moderateMessage("damn bitch you look good in that").blocked).toBe(false);
    expect(moderateMessage("you're an idiot lol").blocked).toBe(false);
  });

  it("still filters slurs and threats in DMs", () => {
    expect(moderateMessage("shut up you f4ggot")).toMatchObject({ blocked: true, category: "hate_speech" });
    expect(moderateMessage("I will find you")).toMatchObject({ blocked: true, category: "harassment" });
    expect(moderateMessage("i'll stab you")).toMatchObject({ blocked: true, category: "harassment" });
  });

  it("filters scams and sexual solicitation in DMs", () => {
    expect(moderateMessage("send me your nudes")).toMatchObject({ blocked: true, category: "explicit_sexual" });
    expect(moderateMessage("send 0.5 bitcoin to my wallet address")).toMatchObject({ blocked: true, category: "spam_scam" });
  });
});

describe("muted words", () => {
  it("normalizes phrases and rejects unusable input", () => {
    expect(normalizeMutedPhrase("  Spoilers  ")).toBe("spoilers");
    expect(normalizeMutedPhrase("#FYP")).toBe("#fyp");
    expect(normalizeMutedPhrase("")).toBeNull();
    expect(normalizeMutedPhrase("!!!")).toBeNull();
    expect(normalizeMutedPhrase("x".repeat(61))).toBeNull();
    expect(normalizeMutedPhrase(42)).toBeNull();
  });

  it("matches whole words and phrases only", () => {
    expect(matchesMutedWords("New art drop tonight", ["art"])).toBe(true);
    expect(matchesMutedWords("Party at the store", ["art"])).toBe(false);
    expect(matchesMutedWords("Restock on FRIDAY", ["friday"])).toBe(true);
    expect(matchesMutedWords("the resale market is wild", ["resale market"])).toBe(true);
    expect(matchesMutedWords("drop #fyp", ["#fyp"])).toBe(true);
    expect(matchesMutedWords("Café collab", ["cafe"])).toBe(true);
    expect(matchesMutedWords(null, ["art"])).toBe(false);
    expect(matchesMutedWords("anything", [])).toBe(false);
  });
});
