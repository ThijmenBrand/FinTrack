import { describe, it, expect } from "vitest";
import { isBlockedAddress, normalizeDomain, parseLogoInput, pickDomain } from "@/lib/merchant-logo";

describe("parseLogoInput", () => {
  it("reads a bare domain or a page link as the site to take the icon from", () => {
    expect(parseLogoInput("hbomax.com")).toEqual({ kind: "site", domain: "hbomax.com" });
    expect(parseLogoInput(" https://www.HBOMax.com/nl/account ")).toEqual({ kind: "site", domain: "hbomax.com" });
    expect(parseLogoInput("http://ziggo.nl")).toEqual({ kind: "site", domain: "ziggo.nl" });
  });

  it("reads a link ending in an image extension as that image, fetched over https", () => {
    const target = parseLogoInput("http://cdn.example.com/brand/logo.PNG?x=1");
    expect(target).toMatchObject({ kind: "image", domain: "cdn.example.com" });
    expect(target?.kind === "image" && target.url.toString()).toBe("https://cdn.example.com/brand/logo.PNG?x=1");
  });

  it("reads words without a dot as a company name to look up", () => {
    expect(parseLogoInput("HBO Max")).toEqual({ kind: "name", name: "HBO Max" });
    expect(parseLogoInput("Netflix")).toEqual({ kind: "name", name: "Netflix" });
    expect(parseLogoInput("Basic-Fit B.V.")).toEqual({ kind: "name", name: "Basic-Fit B.V." });
  });

  it("refuses other schemes, IP literals, and nothing at all", () => {
    expect(parseLogoInput("")).toBeNull();
    expect(parseLogoInput("   ")).toBeNull();
    expect(parseLogoInput("file:///etc/passwd")).toBeNull();
    expect(parseLogoInput("javascript:alert(1)")).toBeNull();
    expect(parseLogoInput("http://127.0.0.1/logo.png")).toBeNull();
    expect(parseLogoInput("169.254.169.254")).toBeNull();
    expect(parseLogoInput("https://[::1]/logo.png")).toBeNull();
    expect(parseLogoInput(`https://example.com/${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("lowercases and drops www and a trailing dot", () => {
    expect(normalizeDomain("WWW.Netflix.com.")).toBe("netflix.com");
  });
  it("rejects what can't be a public hostname", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
    expect(normalizeDomain("a b.com")).toBeNull();
  });
});

describe("pickDomain", () => {
  it("takes the top hit when its company name is the plan name", () => {
    expect(
      pickDomain("Netflix", [
        { name: "Netflix", domain: "netflix.com" },
        { name: "Netflix Life", domain: "netflixlife.com" },
      ]),
    ).toBe("netflix.com");
    expect(pickDomain("HBO Max", [{ name: "HBO Max", domain: "hbomax.com" }])).toBe("hbomax.com");
    expect(pickDomain("Albert Heijn", [{ name: "Albert Heijn", domain: "ah.nl" }])).toBe("ah.nl");
    expect(pickDomain("basic fit", [{ name: "Basic-Fit", domain: "basic-fit.com" }])).toBe("basic-fit.com");
    expect(pickDomain("Disney+", [{ name: "Disney+", domain: "disneyplus.com" }])).toBe("disneyplus.com");
  });

  // Real autocomplete answers for plain Dutch plan names.
  it("leaves generic words alone — a wrong logo is worse than none", () => {
    expect(pickDomain("Huur", [{ name: "Huurwoningen", domain: "huurwoningen.nl" }])).toBeNull();
    expect(
      pickDomain("Salaris", [
        { name: "Salaris Compleet", domain: "salariscompleet.nl" },
        { name: "Salaris", domain: "salaris.de" },
      ]),
    ).toBeNull();
    expect(pickDomain("Mobiel", [{ name: "Mobiel.nl", domain: "mobiel.nl" }])).toBeNull();
    expect(pickDomain("Energie en water", [{ name: "Energieen Water", domain: "energieenwater.net" }])).toBeNull();
    expect(pickDomain("Internet en TV", [{ name: "InternetenTV", domain: "internetentv.info" }])).toBeNull();
  });

  it("survives a malformed response", () => {
    expect(pickDomain("Netflix", null)).toBeNull();
    expect(pickDomain("Netflix", { domain: "netflix.com" })).toBeNull();
    expect(pickDomain("Netflix", [null])).toBeNull();
    expect(pickDomain("Netflix", [{ name: "Netflix", domain: 5 }])).toBeNull();
    expect(pickDomain("Netflix", [{ name: "Netflix", domain: "not a domain" }])).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::7f00:1",
    "2002:7f00:1::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["142.250.179.164", "2a00:1450:400e:80f::2004"])("allows public %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
