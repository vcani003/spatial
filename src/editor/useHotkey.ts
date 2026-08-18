import { useEffect } from "react";

/**
 * A single application shortcut.
 *
 * ── WHY THE MODIFIER IS "MOD" AND NOT META OR CTRL ──────────────────────────
 *
 * ⌘ on a Mac, Ctrl everywhere else. Hardcoding either one makes the app feel
 * foreign on the other platform, and checking `metaKey || ctrlKey` is worse
 * than it looks: on Windows it would fire for ⊞+B as well, and on a Mac it
 * makes Ctrl+B a second, undocumented binding that collides with the terminal
 * habit of Ctrl+B meaning something else entirely.
 *
 * ── IT DOES NOT FIRE WHILE YOU ARE TYPING ───────────────────────────────────
 *
 * A canvas has text nodes, and the moment one is being edited the keyboard
 * belongs to the text — ⌘B is bold there, not "toggle a panel". This checks
 * the active element rather than asking callers to remember, because the one
 * place that will reliably be forgotten is the one that matters.
 *
 * ── AND IT DOES NOT SWALLOW WHAT IT DOES NOT HANDLE ─────────────────────────
 *
 * `preventDefault` is called ONLY when a binding actually matches. A listener
 * that pre-emptively cancels every ⌘-anything breaks Find, Reload and Copy,
 * and it does so invisibly.
 */

export interface Hotkey {
  /** Lower-case `event.key`, e.g. "m", "b". */
  readonly key: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  readonly mod?: boolean;
  readonly shift?: boolean;
}

const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Whether the keyboard currently belongs to a text field rather than the app. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useHotkey(hotkey: Hotkey, run: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;

      const mod = isMac() ? event.metaKey : event.ctrlKey;
      const wrongMod = isMac() ? event.ctrlKey : event.metaKey;

      if (event.key.toLowerCase() !== hotkey.key) return;
      if (mod !== (hotkey.mod ?? false)) return;
      if (wrongMod) return;
      if (event.shiftKey !== (hotkey.shift ?? false)) return;
      /* A key repeat from a held-down chord should not flap a panel open and
         shut sixty times a second. */
      if (event.repeat) return;

      event.preventDefault();
      run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hotkey.key, hotkey.mod, hotkey.shift, run]);
}

/** Rendered into the UI so a shortcut is discoverable rather than folklore. */
export const modLabel = (): string => (isMac() ? "⌘" : "Ctrl");
