import { useLayoutEffect, useRef, type RefObject } from "react";

// Keep the native dialog present through its exit. CSS display/overlay
// transitions are not consistently supported by mobile browsers.
export function useDrawerMotion(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
  onClosed: () => void,
) {
  const closed = useRef(onClosed);
  closed.current = onClosed;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || (!open && !dialog.open)) return;
    const panel = dialog.querySelector<HTMLElement>(".mobile-sidebar-content")!;
    const scrim = dialog.querySelector<HTMLElement>(".mobile-scrim")!;
    const newlyOpened = open && !dialog.open;
    if (newlyOpened) dialog.showModal();
    dialog.dataset.closing = String(!open);

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const endTransform = open ? "translateX(0)" : "translateX(-100%)";
    const endOpacity = open ? "1" : "0";
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      panel.style.transform = endTransform;
      scrim.style.opacity = endOpacity;
      if (!open) {
        dialog.close();
        closed.current();
      }
    };
    if (reduced.matches) {
      finish();
      return;
    }

    const fromTransform = newlyOpened
      ? "translateX(-100%)"
      : getComputedStyle(panel).transform;
    const fromOpacity = newlyOpened ? "0" : getComputedStyle(scrim).opacity;
    const tokens = getComputedStyle(document.documentElement);
    const duration = open ? 180 : 140;
    const easing = tokens
      .getPropertyValue(open ? "--ease-drawer" : "--ease-out")
      .trim();
    const animations = [
      panel.animate(
        [{ transform: fromTransform }, { transform: endTransform }],
        { duration, easing, fill: "both" },
      ),
      scrim.animate([{ opacity: fromOpacity }, { opacity: endOpacity }], {
        duration,
        easing,
        fill: "both",
      }),
    ];
    const reduce = () => {
      if (reduced.matches) {
        finish();
        animations.forEach((animation) => animation.cancel());
      }
    };
    reduced.addEventListener("change", reduce);
    void Promise.all(animations.map((animation) => animation.finished))
      .then(
        () => {
          finish();
          animations.forEach((animation) => animation.cancel());
        },
        () => {},
      )
      .finally(() => reduced.removeEventListener("change", reduce));

    return () => {
      cancelled = true;
      // Preserve the presentation value when an opening/closing reverses.
      panel.style.transform = getComputedStyle(panel).transform;
      scrim.style.opacity = getComputedStyle(scrim).opacity;
      animations.forEach((animation) => animation.cancel());
      reduced.removeEventListener("change", reduce);
    };
  }, [open, ref]);
}
