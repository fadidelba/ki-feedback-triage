import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COL, EXPO_OUT, EASE_IN, MONO, SANS } from "./theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function prog(frame: number, start: number, dur: number, easing = EXPO_OUT) {
  return interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing });
}

// Zeilenweise Masken-Einblendung: Text gleitet hinter einer Kante hervor
export const Reveal: React.FC<{
  lines: React.ReactNode[];
  delay?: number;
  stagger?: number;
  dur?: number;
  out?: number; // Frame, ab dem die Zeilen nach oben verschwinden
  style?: React.CSSProperties;
  lineStyle?: React.CSSProperties;
}> = ({ lines, delay = 0, stagger = 4, dur = 26, out, style, lineStyle }) => {
  const frame = useCurrentFrame();
  return (
    <div style={style}>
      {lines.map((l, i) => {
        const p = prog(frame, delay + i * stagger, dur);
        const o = out === undefined ? 0 : prog(frame, out + i * 2, 16, EASE_IN);
        return (
          <div key={i} style={{ overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
            <div style={{ transform: `translateY(${(1 - p) * 110 - o * 110}%)`, ...lineStyle }}>{l}</div>
          </div>
        );
      })}
    </div>
  );
};

export const Fade: React.FC<{ delay?: number; dur?: number; y?: number; out?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0, dur = 22, y = 18, out, children, style,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, dur);
  const o = out === undefined ? 0 : prog(frame, out, 14, EASE_IN);
  return <div style={{ opacity: p * (1 - o), transform: `translateY(${(1 - p) * y - o * 10}px)`, ...style }}>{children}</div>;
};

// Kapitel-Label oben links, z. B. "01 — Das Problem"
export const Label: React.FC<{ n: string; text: string; dark?: boolean; delay?: number }> = ({ n, text, dark, delay = 4 }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, 24);
  const c = dark ? COL.mutedDark : COL.muted;
  return (
    <div style={{ position: "absolute", left: 120, top: 90, display: "flex", alignItems: "center", fontFamily: MONO, fontSize: 20, letterSpacing: 2, color: c, textTransform: "uppercase" }}>
      <span style={{ color: dark ? COL.paper : COL.ink, opacity: p }}>{n}</span>
      <span style={{ display: "inline-block", width: 60 * p, height: 1.5, background: c, margin: "0 18px" }} />
      <span style={{ opacity: p }}>{text}</span>
    </div>
  );
};

// Animiertes Filmkorn, nimmt den "zu sauberen" Digital-Look
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "overlay", opacity }}>
      <svg width="100%" height="100%">
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${strength}) 100%)` }} />
);

// App-Icon im iOS-Stil
const APPS: Record<string, [string, string]> = {
  "Knight Grid": ["#2C3E66", "#4C6FB3"],
  "Sum Grid": ["#7A3B2E", "#D97757"],
  "Mine Grid": ["#22553F", "#3FA174"],
};
export const AppIcon: React.FC<{ app: string; size?: number }> = ({ app, size = 52 }) => {
  const [a, b] = APPS[app] ?? ["#333", "#666"];
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.23, background: `linear-gradient(145deg, ${b}, ${a})`,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
    }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2" opacity="0.9" />
        <path d="M9 3v18M15 3v18M3 9h18M3 15h18" opacity="0.6" />
      </svg>
    </div>
  );
};

// Linien-Icons (Stroke), einheitlich 24er Raster
export const Icon: React.FC<{ name: string; size?: number; color?: string; stroke?: number }> = ({ name, size = 56, color = COL.ink, stroke = 1.6 }) => {
  const p = { fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    webhook: <><circle cx="12" cy="6" r="3" {...p} /><circle cx="5.5" cy="17" r="3" {...p} /><circle cx="18.5" cy="17" r="3" {...p} /><path d="M10.5 8.6 7 14.4M13.5 8.6 17 14.4M8.5 17h7" {...p} /></>,
    spark: <path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z M19 15.5c.25 1.6 1 2.35 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.15 2.25-.9 2.5-2.5Z" {...p} />,
    shield: <><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6L12 3Z" {...p} /><path d="m8.8 12.2 2.2 2.2 4.4-4.6" {...p} /></>,
    db: <><ellipse cx="12" cy="5.5" rx="7" ry="2.8" {...p} /><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" {...p} /></>,
    send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" {...p} />,
    check: <path d="m5 12.5 4.5 4.5L19 7.5" {...p} />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24">{paths[name]}</svg>;
};

export const Pill: React.FC<{ children: React.ReactNode; bg: string; fg?: string; size?: number }> = ({ children, bg, fg = COL.white, size = 18 }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", padding: `${size * 0.35}px ${size * 0.8}px`, borderRadius: 999,
    background: bg, color: fg, fontFamily: MONO, fontSize: size, fontWeight: 500, letterSpacing: 1, marginRight: 10,
  }}>{children}</span>
);

export const Base: React.FC<{ bg: string; children: React.ReactNode; dark?: boolean }> = ({ bg, children, dark }) => (
  <AbsoluteFill style={{ background: bg, fontFamily: SANS, color: dark ? COL.paper : COL.ink, overflow: "hidden" }}>
    {children}
    <Grain opacity={dark ? 0.09 : 0.06} />
    {dark && <Vignette />}
  </AbsoluteFill>
);
