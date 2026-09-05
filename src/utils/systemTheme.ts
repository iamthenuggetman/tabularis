import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const COLOR_SCHEME_COMMAND = "get_system_color_scheme";
const COLOR_SCHEME_EVENT = "system-color-scheme-changed";

export type SystemColorScheme = "light" | "dark";

export type UnsubscribeSystemTheme = () => void;

/**
 * Returns whether the OS is currently in dark mode.
 *
 * Prefers the backend's XDG Settings portal read (correct on GNOME/KDE,
 * where the CSS media query lies because WebKitGTK derives it from the
 * legacy `gtk-theme-name` setting), falling back to the media query on
 * other platforms and in the browser build.
 */
export async function getSystemIsDark(): Promise<boolean> {
  try {
    const scheme = await invoke<SystemColorScheme>(COLOR_SCHEME_COMMAND);
    return scheme === "dark";
  } catch {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
}

/**
 * Subscribes to OS appearance changes.
 *
 * Listens to the backend's portal-driven event and, in parallel, the CSS
 * media query. On each platform only one of the two ever fires, so no
 * deduplication is needed. Returns an unsubscribe function.
 */
export async function subscribeSystemTheme(
  onSchemeChange: (systemIsDark: boolean) => void,
): Promise<UnsubscribeSystemTheme> {
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<SystemColorScheme>(
      COLOR_SCHEME_EVENT,
      (event) => {
        onSchemeChange(event.payload === "dark");
      },
    );
  } catch {
    // Portal events unavailable; the media-query listener below still
    // covers platforms where it works.
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = (event: MediaQueryListEvent) =>
    onSchemeChange(event.matches);
  mediaQuery.addEventListener("change", handleChange);

  return () => {
    mediaQuery.removeEventListener("change", handleChange);
    unlisten?.();
  };
}
