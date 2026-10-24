import { useEffect } from "react";

// Track intent without React state: keyboard navigation never pays for decoration.
export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.input = "keyboard";
    const pointer = () => {
      root.dataset.input = "pointer";
    };
    const keyboard = () => {
      root.dataset.input = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, []);
}

// The destination is already mounted and fully opaque. Only its position settles.
// No outgoing snapshot, delayed mount, layout measurement, or animation dependency.
export function settlePage(element: Element | null): (() => void) | undefined {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (
    !element ||
    document.documentElement.dataset.input !== "pointer" ||
    reduced.matches ||
    location.hash
  )
    return;

  const tokens = getComputedStyle(document.documentElement);
  // CSS minifiers may rewrite 180ms to .18s; WAAPI always expects milliseconds.
  const cssDuration = tokens.getPropertyValue("--motion-page").trim();
  const duration =
    parseFloat(cssDuration) * (cssDuration.endsWith("ms") ? 1 : 1000);
  const animation = element.animate(
    [{ transform: "translateY(3px)" }, { transform: "translateY(0)" }],
    {
      duration,
      easing: tokens.getPropertyValue("--ease-out").trim(),
    },
  );
  const cancel = () => animation.cancel();
  const reduce = () => {
    if (reduced.matches) cancel();
  };
  reduced.addEventListener("change", reduce);
  document.addEventListener("keydown", cancel, { capture: true, once: true });
  const clean = () => {
    reduced.removeEventListener("change", reduce);
    document.removeEventListener("keydown", cancel, true);
  };
  void animation.finished.then(clean, clean);
  return () => {
    cancel();
    clean();
  };
}
