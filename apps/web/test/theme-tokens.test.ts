import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const themeCssPath = path.resolve(__dirname, "../src/app/theme.css");
const themeCss = fs.readFileSync(themeCssPath, "utf-8");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf-8");

/** Reads `--name: hsl(h s% l%)` declarations from the first block opened by `selector {`. */
function readTokens(selector: string): Record<string, [number, number, number]> {
  const start = themeCss.indexOf(`${selector} {`);
  const block = themeCss.slice(start, themeCss.indexOf("\n  }", start));
  const tokens: Record<string, [number, number, number]> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/g)) {
    tokens[m[1] as string] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

function luminance([h, s, l]: [number, number, number]): number {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

type Hsl = [number, number, number];

function toRgb([h, s, l]: Hsl): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function rgbLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(l1: number, l2: number): number {
  const [hi, lo] = [l1, l2].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function contrast(a: Hsl, b: Hsl): number {
  return ratio(luminance(a), luminance(b));
}

/** Contrast of `fg` text on a `bg-fg/{alpha}` tint over `surface` (the alert-panel pattern). */
function contrastOnTint(fg: Hsl, surface: Hsl, alpha: number): number {
  const f = toRgb(fg);
  const s = toRgb(surface);
  const mixed = f.map((v, i) => v * alpha + (s[i] as number) * (1 - alpha)) as [
    number,
    number,
    number,
  ];
  return ratio(rgbLuminance(f), rgbLuminance(mixed));
}

describe("Theme Tokens & CSS Variables Compliance (T014, FR-001, FR-003)", () => {
  it("defines all mandatory semantic light tokens in :root", () => {
    const requiredTokens = [
      "--background",
      "--foreground",
      "--primary",
      "--primary-foreground",
      "--card",
      "--card-foreground",
      "--muted",
      "--muted-foreground",
      "--accent",
      "--destructive",
      "--border",
      "--ring",
      "--radius",
      "--agent", // Principle IV Agent Native Attribution
    ];

    for (const token of requiredTokens) {
      expect(themeCss).toContain(token);
    }
  });

  it("defines dark mode theme overrides in .dark", () => {
    expect(themeCss).toContain(".dark {");
    expect(themeCss).toContain("--background: hsl(240 10% 3.9%)");
    expect(themeCss).toContain("--foreground: hsl(0 0% 98%)");
    expect(themeCss).toContain("--agent:");
  });

  it("binds tokens into Tailwind @theme schema", () => {
    expect(themeCss).toContain("@theme {");
    expect(themeCss).toContain("--color-background: var(--background)");
    expect(themeCss).toContain("--color-primary: var(--primary)");
    expect(themeCss).toContain("--color-agent: var(--agent)");
  });

  it("drives Tailwind dark: utilities from the .dark class, not the OS media query", () => {
    expect(themeCss).toMatch(/@custom-variant dark \(&:where\(\.dark, \.dark \*\)\)/);
  });

  it("loads the animation utilities used by overlays (animate-in, fade-in-0, zoom-in-95)", () => {
    expect(themeCss).toContain('@import "tw-animate-css"');
  });

  it("resolves the theme before first paint to avoid a flash of the wrong theme (SC-003)", () => {
    expect(indexHtml).toContain('localStorage.getItem("decisionator-theme")');
    expect(indexHtml).toContain("prefers-color-scheme: dark");
  });

  it("respects reduced motion preference", () => {
    expect(themeCss).toContain("prefers-reduced-motion: reduce");
  });

  describe.each([
    [":root", "light"],
    [".dark", "dark"],
  ])("WCAG 2.1 AA contrast in %s (%s) (FR-009)", (selector) => {
    const tokens = { ...readTokens(":root"), ...readTokens(selector) };
    const t = (name: string) => {
      const value = tokens[name];
      if (!value) throw new Error(`missing token --${name} in ${selector}`);
      return value;
    };

    // [foreground, background, minimum ratio]
    const textPairs: [string, string, number][] = [
      ["foreground", "background", 4.5],
      ["card-foreground", "card", 4.5],
      ["popover-foreground", "popover", 4.5],
      ["muted-foreground", "background", 4.5],
      ["muted-foreground", "card", 4.5],
      ["muted-foreground", "muted", 4.5],
      // Filled buttons, badges and toasts: white text on the `-solid` fills.
      ["primary-foreground", "primary-solid", 4.5],
      ["secondary-foreground", "secondary", 4.5],
      ["accent-foreground", "accent", 4.5],
      ["destructive-foreground", "destructive-solid", 4.5],
      ["success-foreground", "success-solid", 4.5],
      ["warning-foreground", "warning-solid", 4.5],
      ["agent-foreground", "agent-solid", 4.5],
      // Semantic colors are also used as text on surfaces (text-destructive etc.).
      ["primary", "card", 4.5],
      ["destructive", "card", 4.5],
      ["success", "card", 4.5],
      ["warning", "card", 4.5],
      ["agent", "card", 4.5],
      ["agent", "agent-muted", 4.5],
      // Non-text UI graphics need 3:1.
      ["ring", "background", 3],
      ["rating", "card", 3],
    ];

    it.each(textPairs)("--%s on --%s ≥ %s:1", (fg, bg, min) => {
      expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(min);
    });

    // Button text is white in both themes (user preference) and must stay readable on hover,
    // where the fill drops to 90% opacity over the page.
    const solidRoles = ["primary", "destructive", "success", "warning", "agent"];
    it.each(solidRoles)("--%s-foreground is white", (role) => {
      expect(t(`${role}-foreground`)).toEqual([0, 0, 100]);
    });
    it.each(
      solidRoles.flatMap((role) => [
        [role, "card"],
        [role, "background"],
      ])
    )("white on --%s-solid at 90%% over --%s ≥ 4.5:1", (role, surface) => {
      const white = toRgb(t(`${role}-foreground`));
      const solid = toRgb(t(`${role}-solid`));
      const under = toRgb(t(surface));
      const hovered = solid.map((v, i) => v * 0.9 + (under[i] as number) * 0.1) as [
        number,
        number,
        number,
      ];
      expect(ratio(rgbLuminance(white), rgbLuminance(hovered))).toBeGreaterThanOrEqual(4.5);
    });

    // Alerts and banners use `text-X` on a `bg-X/10` tint, over cards or the page background.
    const tintedText = ["primary", "destructive", "success", "warning", "agent"];
    it.each(
      tintedText.flatMap((fg) => [
        [fg, "card"],
        [fg, "background"],
      ])
    )("--%s text on a 10%% --%s tint ≥ 4.5:1", (fg, surface) => {
      expect(contrastOnTint(t(fg), t(surface), 0.1)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
