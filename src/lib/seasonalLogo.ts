export interface SeasonConfig {
  start?: string; // "MM-DD" or "YYYY-MM-DD"
  end?: string;
  logo: string;
  og: string;
}

export interface SeasonalLogos {
  [key: string]: SeasonConfig;
  default: { logo: string; og: string };
}

// Load JSON (TS import works with assert {type:"json"})
import logos from "../data/seasonal-logos.json" assert { type: "json" };

function matches(date: Date, cfg: SeasonConfig): boolean {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const md = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (cfg.start && cfg.end) {
    // If start contains a year, treat as full ISO, else month‑day only
    if (cfg.start.length === 5 && cfg.end.length === 5) {
      // month‑day range
      return md >= cfg.start && md <= cfg.end;
    }
    const start = cfg.start;
    const end = cfg.end;
    return iso >= start && iso <= end;
  }
  return false;
}

export function getSeasonalAssets(now = new Date()): { logo: string; og: string } {
  for (const key of Object.keys(logos)) {
    if (key === "default") continue;
    const cfg = (logos as SeasonalLogos)[key];
    if (matches(now, cfg)) {
      return { logo: `/og/${cfg.logo}`, og: `/og/${cfg.og}` };
    }
  }
  const def = logos.default;
  return { logo: `/og/${def.logo}`, og: `/og/${def.og}` };
}
