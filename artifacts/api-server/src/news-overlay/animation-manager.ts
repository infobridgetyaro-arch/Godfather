import type { AnimationPreset } from "./types.js";

export const ANIMATION_PRESETS: AnimationPreset[] = [
  "None",
  "Slide Left",
  "Slide Right",
  "Slide Up",
  "Slide Down",
  "Fade",
  "Zoom",
  "Elastic",
  "Bounce",
  "Flip",
  "Typewriter",
  "Blur",
  "Glitch",
  "Pulse",
  "Flash",
];

export interface AnimationConfig {
  name: AnimationPreset;
  durationMs: number;
  css: {
    enter: string;
    exit: string;
    keyframes: string;
  };
}

function kf(name: string, frames: string): string {
  return `@keyframes ${name} { ${frames} }`;
}

export const ANIMATION_CONFIGS: Record<AnimationPreset, AnimationConfig> = {
  "None": {
    name: "None",
    durationMs: 0,
    css: { enter: "", exit: "", keyframes: "" },
  },
  "Slide Left": {
    name: "Slide Left",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-slide-left 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
      exit: "animation: no-exit-slide-left 0.4s ease-in forwards",
      keyframes: kf("no-enter-slide-left", "from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1}") +
        kf("no-exit-slide-left", "from{transform:translateX(0);opacity:1} to{transform:translateX(-100%);opacity:0}"),
    },
  },
  "Slide Right": {
    name: "Slide Right",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-slide-right 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
      exit: "animation: no-exit-slide-right 0.4s ease-in forwards",
      keyframes: kf("no-enter-slide-right", "from{transform:translateX(-100%);opacity:0} to{transform:translateX(0);opacity:1}") +
        kf("no-exit-slide-right", "from{transform:translateX(0);opacity:1} to{transform:translateX(100%);opacity:0}"),
    },
  },
  "Slide Up": {
    name: "Slide Up",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-slide-up 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
      exit: "animation: no-exit-slide-up 0.4s ease-in forwards",
      keyframes: kf("no-enter-slide-up", "from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1}") +
        kf("no-exit-slide-up", "from{transform:translateY(0);opacity:1} to{transform:translateY(-100%);opacity:0}"),
    },
  },
  "Slide Down": {
    name: "Slide Down",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-slide-down 0.5s cubic-bezier(0.22,1,0.36,1) forwards",
      exit: "animation: no-exit-slide-down 0.4s ease-in forwards",
      keyframes: kf("no-enter-slide-down", "from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1}") +
        kf("no-exit-slide-down", "from{transform:translateY(0);opacity:1} to{transform:translateY(100%);opacity:0}"),
    },
  },
  "Fade": {
    name: "Fade",
    durationMs: 400,
    css: {
      enter: "animation: no-enter-fade 0.4s ease forwards",
      exit: "animation: no-exit-fade 0.35s ease forwards",
      keyframes: kf("no-enter-fade", "from{opacity:0} to{opacity:1}") +
        kf("no-exit-fade", "from{opacity:1} to{opacity:0}"),
    },
  },
  "Zoom": {
    name: "Zoom",
    durationMs: 450,
    css: {
      enter: "animation: no-enter-zoom 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards",
      exit: "animation: no-exit-zoom 0.35s ease-in forwards",
      keyframes: kf("no-enter-zoom", "from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1}") +
        kf("no-exit-zoom", "from{transform:scale(1);opacity:1} to{transform:scale(1.2);opacity:0}"),
    },
  },
  "Elastic": {
    name: "Elastic",
    durationMs: 700,
    css: {
      enter: "animation: no-enter-elastic 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards",
      exit: "animation: no-exit-fade 0.35s ease forwards",
      keyframes: kf("no-enter-elastic", "0%{transform:translateY(60px) scaleY(0.8);opacity:0} 60%{transform:translateY(-8px) scaleY(1.04)} 80%{transform:translateY(4px) scaleY(0.98)} 100%{transform:translateY(0) scaleY(1);opacity:1}"),
    },
  },
  "Bounce": {
    name: "Bounce",
    durationMs: 700,
    css: {
      enter: "animation: no-enter-bounce 0.7s ease forwards",
      exit: "animation: no-exit-fade 0.35s ease forwards",
      keyframes: kf("no-enter-bounce", "0%{transform:translateY(-40px);opacity:0} 50%{transform:translateY(6px)} 75%{transform:translateY(-3px)} 100%{transform:translateY(0);opacity:1}"),
    },
  },
  "Flip": {
    name: "Flip",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-flip 0.5s ease forwards",
      exit: "animation: no-exit-flip 0.4s ease forwards",
      keyframes: kf("no-enter-flip", "from{transform:perspective(400px) rotateX(90deg);opacity:0} to{transform:perspective(400px) rotateX(0);opacity:1}") +
        kf("no-exit-flip", "from{transform:perspective(400px) rotateX(0);opacity:1} to{transform:perspective(400px) rotateX(-90deg);opacity:0}"),
    },
  },
  "Typewriter": {
    name: "Typewriter",
    durationMs: 600,
    css: {
      enter: "animation: no-enter-typewriter 0.6s steps(30,end) forwards",
      exit: "animation: no-exit-fade 0.3s ease forwards",
      keyframes: kf("no-enter-typewriter", "from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)}"),
    },
  },
  "Blur": {
    name: "Blur",
    durationMs: 500,
    css: {
      enter: "animation: no-enter-blur 0.5s ease forwards",
      exit: "animation: no-exit-blur 0.4s ease forwards",
      keyframes: kf("no-enter-blur", "from{filter:blur(16px);opacity:0} to{filter:blur(0);opacity:1}") +
        kf("no-exit-blur", "from{filter:blur(0);opacity:1} to{filter:blur(16px);opacity:0}"),
    },
  },
  "Glitch": {
    name: "Glitch",
    durationMs: 600,
    css: {
      enter: "animation: no-enter-glitch 0.6s ease forwards",
      exit: "animation: no-exit-fade 0.3s ease forwards",
      keyframes: kf("no-enter-glitch",
        "0%{transform:translateX(0);opacity:0;filter:hue-rotate(0deg)} " +
        "10%{transform:translateX(-6px);opacity:0.7;filter:hue-rotate(90deg)} " +
        "20%{transform:translateX(6px);filter:hue-rotate(0deg)} " +
        "30%{transform:translateX(-3px)} 40%{transform:translateX(3px)} " +
        "50%{transform:translateX(0);opacity:1;filter:hue-rotate(0deg)} " +
        "100%{transform:translateX(0);opacity:1}"),
    },
  },
  "Pulse": {
    name: "Pulse",
    durationMs: 300,
    css: {
      enter: "animation: no-enter-pulse 0.3s ease forwards",
      exit: "animation: no-exit-pulse 0.3s ease forwards",
      keyframes: kf("no-enter-pulse", "0%{transform:scale(1);opacity:0} 50%{transform:scale(1.04);opacity:0.9} 100%{transform:scale(1);opacity:1}") +
        kf("no-exit-pulse", "0%{transform:scale(1);opacity:1} 50%{transform:scale(0.96);opacity:0.5} 100%{transform:scale(1);opacity:0}"),
    },
  },
  "Flash": {
    name: "Flash",
    durationMs: 400,
    css: {
      enter: "animation: no-enter-flash 0.4s ease forwards",
      exit: "animation: no-exit-flash 0.4s ease forwards",
      keyframes: kf("no-enter-flash", "0%{opacity:0} 25%{opacity:1} 50%{opacity:0.3} 75%{opacity:1} 100%{opacity:1}") +
        kf("no-exit-flash", "0%{opacity:1} 33%{opacity:0} 66%{opacity:1} 100%{opacity:0}"),
    },
  },
};

export function getAnimationConfig(preset: AnimationPreset): AnimationConfig {
  return ANIMATION_CONFIGS[preset] ?? ANIMATION_CONFIGS["None"];
}

export function listAnimationPresets(): AnimationPreset[] {
  return ANIMATION_PRESETS;
}

export function buildCSSAnimation(preset: AnimationPreset, phase: "enter" | "exit"): string {
  const cfg = getAnimationConfig(preset);
  return phase === "enter" ? cfg.css.enter : cfg.css.exit;
}

export function buildKeyframes(): string {
  return Object.values(ANIMATION_CONFIGS)
    .map(c => c.css.keyframes)
    .filter(Boolean)
    .join("\n");
}
