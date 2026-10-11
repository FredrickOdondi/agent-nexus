import { useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type MarkState = "idle" | "loading" | "static";
type MarkTone = "brand" | "inverse";

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** The Nimbus cloud. Idle drifts. Loading breathes and trails a spark. */
export function NimbusMark({
  size = 28,
  state = "idle",
  tone = "brand",
  className,
}: {
  size?: number;
  state?: MarkState;
  tone?: MarkTone;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const calm = reduced || state === "static";
  const gradientId = useId();
  const fill = tone === "inverse" ? "#fff" : `url(#${gradientId})`;
  const eye = tone === "inverse" ? "#3a2f86" : "#1b1633";
  const loading = state === "loading" && !calm;

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="10" y1="14" x2="54" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8d7cff" />
          <stop offset="0.55" stopColor="#6d5ef8" />
          <stop offset="1" stopColor="#3ecfbf" />
        </linearGradient>
      </defs>
      <motion.g
        animate={calm ? { y: 0, scale: 1 } : loading ? { y: [0, -2.4, 0.4, -1.2, 0], scale: [1, 1.045, 0.985, 1.02, 1] } : { y: [0, -1.5, 0], scale: [1, 1.018, 1] }}
        transition={calm ? { duration: 0 } : { duration: loading ? 1.7 : 3.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "32px 38px" }}
      >
        <g fill={fill}>
          <circle cx="23" cy="36" r="11" />
          <circle cx="35" cy="29" r="13" />
          <circle cx="46" cy="36" r="10" />
          <ellipse cx="34" cy="42" rx="18" ry="11" />
        </g>
        <ellipse cx="32" cy="25" rx="6" ry="3" fill="#fff" opacity={tone === "inverse" ? 0.45 : 0.32} />
        <motion.g
          style={{ transformOrigin: "32px 38px" }}
          animate={calm ? { scaleY: 1 } : { scaleY: [1, 1, 0.12, 1, 1] }}
          transition={calm ? { duration: 0 } : { duration: 4.4, repeat: Infinity, times: [0, 0.84, 0.9, 0.96, 1], ease: "easeInOut" }}
        >
          <ellipse cx="27.5" cy="38" rx="1.55" ry="2.05" fill={eye} />
          <ellipse cx="38.5" cy="37.4" rx="1.55" ry="2.05" fill={eye} />
        </motion.g>
        {loading && (
          <>
            <motion.circle
              cx="14"
              cy="46"
              r="2.1"
              fill={fill}
              animate={{ opacity: [0, 0.85, 0], x: [0, -3, -5], y: [0, -1, 1], scale: [0.5, 1.15, 0.4] }}
              transition={{ duration: 1.7, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.circle
              cx="52"
              cy="44"
              r="1.7"
              fill={fill}
              animate={{ opacity: [0, 0.7, 0], x: [0, 3, 5], y: [0, -2, 0], scale: [0.4, 1, 0.35] }}
              transition={{ duration: 1.7, repeat: Infinity, ease: "easeOut", delay: 0.45 }}
            />
          </>
        )}
      </motion.g>
      {loading && (
        <motion.g
          style={{ transformOrigin: "32px 36px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        >
          <circle cx="32" cy="11" r="2.15" fill="#fff" />
          <circle cx="32" cy="11" r="1.15" fill="#3ecfbf" />
        </motion.g>
      )}
    </motion.svg>
  );
}

export function NimbusLoader({ label, size = 48 }: { label?: string; size?: number }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
      <NimbusMark state="loading" size={size} />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : <span className="sr-only">Loading</span>}
    </div>
  );
}
