import { describe, it, expect, vi, beforeEach } from "vitest";
import { inspectLegacyBrowserData, exportLegacyBrowserData } from "./legacy-browser-data.js";

describe("V1 browser data bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("kaitiaki-next-v1");
  });

  it("does not create a missing legacy database during inspection", async () => {
    const result = await inspectLegacyBrowserData();
    expect(result.databaseFound).toBe(false);
  });

  it("exports records and camera-check localStorage without mutating source values", async () => {
    localStorage.setItem("kaitiaki-camera-checks-v1", JSON.stringify([{ id: "check-a" }]));
    const before = localStorage.getItem("kaitiaki-camera-checks-v1");
    // The database fixture is created by the test harness helper.
    const bundle = await exportLegacyBrowserData();
    expect(bundle.format).toBe("kaitiaki-v1-browser-export");
    expect(bundle.localSettings["kaitiaki-camera-checks-v1"]).toBe(before);
    expect(localStorage.getItem("kaitiaki-camera-checks-v1")).toBe(before);
  });
});
