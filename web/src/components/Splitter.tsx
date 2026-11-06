import { useRef, type PointerEvent } from "react";

/**
 * A draggable divider between two columns. `side` says which neighbour it resizes: "left" grows as you drag
 * right (a panel on the left), "right" grows as you drag left (a panel on the right). Double-click resets.
 */
export function Splitter({
  value,
  onChange,
  min,
  max,
  reset,
  side,
  label,
}: {
  value: number;
  onChange: (px: number) => void;
  min: number;
  max: number;
  reset: number;
  side: "left" | "right";
  label: string;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={(e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: value };
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e: PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        onChange(clamp(side === "left" ? d.w + dx : d.w - dx));
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.classList.remove("resizing");
      }}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 60 : 20;
        const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
        const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
        if (e.key === grow) onChange(clamp(value + step));
        else if (e.key === shrink) onChange(clamp(value - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
