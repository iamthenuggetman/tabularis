import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSystemIsDark,
  subscribeSystemTheme,
} from "../../src/utils/systemTheme";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

let mediaListeners: Array<(e: { matches: boolean }) => void> = [];
let matchMediaReads: number[] = [];

const stubMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        mediaListeners.push(cb);
      },
      removeEventListener: (
        _: string,
        cb: (e: { matches: boolean }) => void,
      ) => {
        mediaListeners = mediaListeners.filter((l) => l !== cb);
      },
      dispatchEvent: vi.fn(),
    }),
  });
};

const fireMediaChange = (matches: boolean) => {
  mediaListeners.forEach((l) => l({ matches }));
};

describe("systemTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaListeners = [];
    matchMediaReads = [];
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getSystemIsDark", () => {
    it("reports dark when the portal command returns dark", async () => {
      invokeMock.mockResolvedValue("dark");

      await expect(getSystemIsDark()).resolves.toBe(true);
      expect(invokeMock).toHaveBeenCalledWith("get_system_color_scheme");
    });

    it("reports light when the portal command returns light", async () => {
      invokeMock.mockResolvedValue("light");

      await expect(getSystemIsDark()).resolves.toBe(false);
    });

    it("falls back to a dark media query when the command rejects", async () => {
      invokeMock.mockRejectedValue(new Error("unsupported platform"));
      stubMatchMedia(true);

      await expect(getSystemIsDark()).resolves.toBe(true);
    });

    it("falls back to a light media query when the command rejects", async () => {
      invokeMock.mockRejectedValue(new Error("unsupported platform"));
      stubMatchMedia(false);

      await expect(getSystemIsDark()).resolves.toBe(false);
    });
  });

  describe("subscribeSystemTheme", () => {
    it("notifies on portal color-scheme events", async () => {
      let eventHandler: (event: { payload: string }) => void = () => {};
      const unlisten = vi.fn();
      listenMock.mockImplementation(
        async (_event: string, handler: (event: { payload: string }) => void) => {
          eventHandler = handler;
          return unlisten;
        },
      );

      const changes: boolean[] = [];
      const unsubscribe = await subscribeSystemTheme((isDark) =>
        changes.push(isDark),
      );

      eventHandler({ payload: "dark" });
      eventHandler({ payload: "light" });

      expect(changes).toEqual([true, false]);

      unsubscribe();
      expect(unlisten).toHaveBeenCalled();
    });

    it("notifies on media-query changes when portal events never arrive", async () => {
      listenMock.mockRejectedValue(new Error("no portal"));

      const changes: boolean[] = [];
      const unsubscribe = await subscribeSystemTheme((isDark) =>
        changes.push(isDark),
      );

      fireMediaChange(true);
      fireMediaChange(false);

      expect(changes).toEqual([true, false]);

      unsubscribe();
      expect(mediaListeners).toHaveLength(0);
    });

    it("cleans up portal and media-query listeners on unsubscribe", async () => {
      let eventHandler: (event: { payload: string }) => void = () => {};
      const unlisten = vi.fn();
      listenMock.mockImplementation(
        async (_event: string, handler: (event: { payload: string }) => void) => {
          eventHandler = handler;
          return unlisten;
        },
      );

      const changes: boolean[] = [];
      const unsubscribe = await subscribeSystemTheme((isDark) =>
        changes.push(isDark),
      );
      unsubscribe();

      fireMediaChange(true);

      expect(changes).toEqual([]);
      expect(unlisten).toHaveBeenCalled();
      expect(mediaListeners).toHaveLength(0);
    });
  });
});
