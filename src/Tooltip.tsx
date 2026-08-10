import { useEffect, useState } from "react";

const SHOW_DELAY_MS = 300;

/** Single app-wide tooltip for elements carrying `data-tip`. Custom instead of
 *  native `title` because the OS hover delay (~1–2 s) can't be tuned, and
 *  fixed-position instead of a CSS bubble because the formatting bar is a
 *  scroll container that would clip anything positioned inside it. */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

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
        setTip({ text: el.dataset.tip ?? "", x: r.left + r.width / 2, y: r.bottom + 6 });
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

  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}
