import { Easing } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/InterTight";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const SANS = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext"] }).fontFamily;
export const SERIF = loadSerif("italic", { weights: ["400"], subsets: ["latin", "latin-ext"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "500"], subsets: ["latin", "latin-ext"] }).fontFamily;

export const COL = {
  paper: "#EFEDE7",
  paper2: "#E5E2DA",
  white: "#FBFAF7",
  ink: "#0F0F10",
  ink2: "#1B1B1E",
  ink3: "#2A2A2E",
  muted: "#77756F",
  mutedDark: "#8E8C86",
  line: "#D2CEC4",
  lineDark: "#34343A",
  accent: "#D97757",
  red: "#E5484D",
  green: "#2E9E68",
  blue: "#3E7BE6",
};

// Kurven wie "Easy Ease" mit starkem Ausklang
export const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EXPO_IN_OUT = Easing.bezier(0.87, 0, 0.13, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 1, 0.45);

export const FPS = 30;
// Schnitte auf Taktanfängen (120 BPM, erster Schlag bei Frame 11, ein Takt = 60 Frames)
export const CUTS = {
  hook: 0,
  title: 311,
  pipeline: 491,
  phone: 1031,
  screens: 1271,
  stress: 1571,
  stats: 1931,
  outro: 2111,
  end: 2280,
};
export const WIPE = 16; // Dauer der Wisch-Übergänge
