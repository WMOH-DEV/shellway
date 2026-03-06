import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  className?: string;
}

// Transform to offset the tooltip so it appears correctly on each side
const sideTransform: Record<string, string> = {
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0%)",
  left: "translate(-100%, -50%)",
  right: "translate(0%, -50%)",
};

export function Tooltip({
  content,
  children,
  side = "top",
  delay = 400,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const GAP = 6;
      let top = 0,
        left = 0;
      switch (side) {
        case "top":
          top = rect.top - GAP;
          left = rect.left + rect.width / 2;
          break;
        case "bottom":
          top = rect.bottom + GAP;
          left = rect.left + rect.width / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2;
          left = rect.left - GAP;
          break;
        case "right":
          top = rect.top + rect.height / 2;
          left = rect.right + GAP;
          break;
      }
      setCoords({ top, left });
      setVisible(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  }, []);

  // Clean up timer on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      // Hide immediately on click — pointer stays on element so mouseLeave won't fire
      onMouseDown={hide}
    >
      {children}
      {visible &&
        createPortal(
          <div
            className={cn(
              "fixed z-[9999] whitespace-nowrap rounded px-2 py-1",
              "bg-nd-surface border border-nd-border text-2xs text-nd-text-secondary shadow-lg",
              "animate-fade-in pointer-events-none",
              className,
            )}
            style={{
              top: coords.top,
              left: coords.left,
              transform: sideTransform[side],
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
