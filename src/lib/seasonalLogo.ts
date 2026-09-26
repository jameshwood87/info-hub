export interface SeasonConfig {
  start?: string; // "MM-DD" or "YYYY-MM-DD"
  end?: string;
  // Moving feast: days from Easter Sunday, e.g. [-3, 1] = Maundy Thursday to Easter Monday. Computed every year.
  easterOffsets?: number[];
  logo: string;
  og: string;
  icon: string;
}

export interface SeasonalLogos {
  [key: string]: SeasonConfig;
  default: { logo: string; og: string; icon: string };
}

// Load JSON (TS import works with assert {type:"json"})
import logos from "../data/seasonal-logos.json" assert { type: "json" };

// Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function matches(date: Date, cfg: SeasonConfig): boolean {
  if (cfg.easterOffsets && cfg.easterOffsets.length === 2) {
    const easter = easterSunday(date.getFullYear());
    const from = new Date(easter);
    from.setDate(easter.getDate() + cfg.easterOffsets[0]);
    const to = new Date(easter);
    to.setDate(easter.getDate() + cfg.easterOffsets[1]);
    const day = localIso(date);
    return day >= localIso(from) && day <= localIso(to);
  }
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const md = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (cfg.start && cfg.end) {
    // If start contains a year, treat as full ISO, else month-day only
    if (cfg.start.length === 5 && cfg.end.length === 5) {
      // month-day range
      return md >= cfg.start && md <= cfg.end;
    }
    const start = cfg.start;
    const end = cfg.end;
    return iso >= start && iso <= end;
  }
  return false;
}

export function getSeasonalAssets(now = new Date()): { logo: string; og: string; icon: string } {
  for (const key of Object.keys(logos)) {
    if (key === "default") continue;
    const cfg = (logos as SeasonalLogos)[key];
    if (matches(now, cfg)) {
      return { logo: `/og/${cfg.logo}`, og: `/og/${cfg.og}`, icon: `/og/${cfg.icon}` };
    }
  }
  const def = logos.default;
  return { logo: `/og/${def.logo}`, og: `/og/${def.og}`, icon: `/og/${def.icon}` };
}
