import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 300;
/** Distance from the anchor, and the least room left to the window edge. */
const GAP = 6;
const MARGIN = 6;

interface Tip {
  text: string;
  /** Horizontal center of the anchor, plus the edges it can hang off. */
  x: number;
  top: number;
  bottom: number;
}

/** Single app-wide tooltip for elements carrying `data-tip`. Custom instead of
 *  native `title` because the OS hover delay (~1–2 s) can't be tuned, and
 *  fixed-position instead of a CSS bubble because the formatting bar is a
 *  scroll container that would clip anything positioned inside it. */
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el === current) return;
      window.clearTimeout(timer);
      current = el;
      setTip(null);
      if (!(el instanceof HTMLElement)) return;
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTip({
          text: el.dataset.tip ?? "",
          x: r.left + r.width / 2,
          top: r.top,
          bottom: r.bottom,
        });
      }, SHOW_DELAY_MS);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousedown", hide, true);
    document.documentElement.addEventListener("mouseleave", hide);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousedown", hide, true);
      document.documentElement.removeEventListener("mouseleave", hide);
      window.clearTimeout(timer);
    };
  }, []);

  // Fitting it to the window needs its own measured size, so the final spot is
  // written after render — in a layout effect, which runs before paint, so the
  // first position anyone sees is already the corrected one. An anchor near the
  // right or left edge pulls the tooltip inside; one near the bottom (the
  // status bar) flips it above.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tip) return;
    const half = box.offsetWidth / 2;
    const left = MARGIN + half;
    const right = window.innerWidth - MARGIN - half;
    box.style.left = `${Math.min(Math.max(tip.x, left), Math.max(left, right))}px`;
    const below = tip.bottom + GAP;
    const fits = below + box.offsetHeight <= window.innerHeight - MARGIN;
    box.style.top = `${fits ? below : Math.max(MARGIN, tip.top - GAP - box.offsetHeight)}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={boxRef} className="tooltip" style={{ left: tip.x, top: tip.bottom + GAP }}>
      {tip.text}
    </div>
  );
}
