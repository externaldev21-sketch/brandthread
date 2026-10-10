import { describe, expect, it } from "vitest";

const { isApiRootPath } = require("./serve.js") as { isApiRootPath: (pathname: string) => boolean };

describe("store website paths (brandthread.app/@handle)", () => {
  it("forwards the store website, its product pages, link buttons and preview card to the API", () => {
    for (const path of ["/@maison", "/@maison/", "/@maison/p/0f8fad5b-d9cb-469f-a165-70867728950e", "/@maison/go/0f8fad5b-d9cb-469f-a165-70867728950e", "/@maison/og.png"]) {
      expect(isApiRootPath(path), path).toBe(true);
    }
  });
  it("leaves everything else to the app", () => {
    for (const path of ["/@", "/@maison/settings", "/@maison/p", "/maison", "/u@maison", "/store/maison"]) {
      expect(isApiRootPath(path), path).toBe(false);
    }
  });
});
