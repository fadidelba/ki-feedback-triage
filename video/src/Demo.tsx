import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COL, CUTS, EXPO_IN_OUT, WIPE } from "./theme";
import { Hook, Outro, Phone, Pipeline, Screens, Stats, Stress, Title } from "./scenes";
import { clamp } from "./ui";

export const DURATION = CUTS.end;

const ORDER: [keyof typeof CUTS, React.FC][] = [
  ["hook", Hook], ["title", Title], ["pipeline", Pipeline], ["phone", Phone],
  ["screens", Screens], ["stress", Stress], ["stats", Stats], ["outro", Outro],
];
const KEYS = Object.keys(CUTS) as (keyof typeof CUTS)[];
// Szene startet WIPE Frames vor ihrem Schnitt, damit sie hereinwischen kann
const start = (k: keyof typeof CUTS) => (k === "hook" ? 0 : CUTS[k] - WIPE);

// Wisch-Übergang: neue Szene wird von rechts mit einer Akzentkante freigelegt
const Wipe: React.FC<{ children: React.ReactNode; enabled: boolean }> = ({ children, enabled }) => {
  const frame = useCurrentFrame();
  if (!enabled) return <>{children}</>;
  const p = interpolate(frame, [0, WIPE], [0, 1], { ...clamp, easing: EXPO_IN_OUT });
  const edge = (1 - p) * 100;
  return (
    <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${edge}%)` }}>
      <AbsoluteFill style={{ transform: `translateX(${(1 - p) * 160}px)` }}>{children}</AbsoluteFill>
      {p < 1 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${edge}%`, width: 8, background: COL.accent }} />}
    </AbsoluteFill>
  );
};

const Sfx: React.FC<{ at: number; name: string; volume?: number }> = ({ at, name, volume = 0.5 }) => (
  <Sequence from={Math.max(0, Math.round(at))} durationInFrames={120}>
    <Audio src={staticFile(`sfx/${name}.mp3`)} volume={volume} />
  </Sequence>
);

export const Demo: React.FC = () => {
  const s = (k: keyof typeof CUTS) => start(k);
  const pipelineArr = [44, 124, 244, 316, 392];
  return (
    <AbsoluteFill style={{ background: COL.ink }}>
      {ORDER.map(([key, Comp], i) => {
        const next = KEYS[i + 1];
        const from = start(key);
        return (
          <Sequence key={key} from={from} durationInFrames={CUTS[next] - from}>
            <Wipe enabled={key !== "hook"}><Comp /></Wipe>
          </Sequence>
        );
      })}

      {/* Musik */}
      <Audio src={staticFile("music.mp3")} volume={(f) => interpolate(f, [0, 12, DURATION - 50, DURATION], [0, 0.85, 0.85, 0], clamp)} />

      {/* Sound-Design */}
      <Sfx at={182} name="swoosh" volume={0.55} />
      <Sfx at={214} name="glitch" volume={0.3} />
      <Sfx at={CUTS.title - 82} name="riser" volume={0.4} />
      <Sfx at={CUTS.title - 2} name="pop" volume={0.45} />
      {(["pipeline", "phone", "screens", "stress", "stats", "outro"] as const).map((k) => (
        <Sfx key={k} at={s(k) - 6} name="whoosh" volume={0.4} />
      ))}
      {pipelineArr.map((a, i) => <Sfx key={`t${i}`} at={s("pipeline") + a} name="tick" volume={0.5} />)}
      <Sfx at={s("pipeline") + 124 + 34} name="pop" volume={0.4} />
      <Sfx at={s("phone") + 40} name="notify" volume={0.6} />
      <Sfx at={s("screens") + 136} name="swoosh" volume={0.4} />
      {[0, 1, 3].map((k) => <Sfx key={`r${k}`} at={s("stress") + k * 90 + 36} name="pop" volume={0.4} />)}
      <Sfx at={s("stress") + 180 + 8} name="glitch" volume={0.45} />
      <Sfx at={s("stress") + 180 + 36} name="pop" volume={0.4} />
      {[0, 1, 2, 3].map((i) => <Sfx key={`b${i}`} at={s("stats") + 20 + i * 5} name="tick" volume={0.35} />)}
      <Sfx at={s("outro") + 22} name="pop" volume={0.45} />
    </AbsoluteFill>
  );
};
