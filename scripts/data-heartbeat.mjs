// Watches the cron-fed data files that pages render from, and emails if one
// goes stale or loses its shape.
//
// Why this exists: budget-data.mjs and finder-counts.mjs both deliberately
// keep the last good cache when the portal API misbehaves, rather than
// blanking the page. That is the right call, but it fails SILENTLY - /budget/
// and /property-finder/ would keep serving confident numbers from a week ago
// and nothing would say so. This is the thing that says so.
//
// Checks freshness AND shape, because a file can be rewritten on schedule and
// still be wrong: an API that starts returning empty results would produce a
// fresh file with no towns in it.
//
// Run daily by cron at 09:15, after finder-counts (04:30) and budget-data (04:50).
import fs from "node:fs/promises";

const ENV = "/opt/info-hub/.env";
const SITE = "https://info.propertylist.es";

const CHECKS = [
  {
    label: "Budget page data",
    file: "/opt/info-hub/var/admin/budget-data.json",
    page: "/budget/",
    maxAgeHours: 36,
    // town count and a sane median guard the shape
    shape: (d) => {
      if (!Array.isArray(d.towns) || d.towns.length < 8) return `only ${d.towns?.length ?? 0} towns (expected 8+)`;
      const bad = d.towns.filter((t) => !(t.m2eur > 500 && t.m2eur < 30000));
      if (bad.length) return `${bad.length} town(s) with implausible EUR/m2, e.g. ${bad[0].name}=${bad[0].m2eur}`;
      if (!Array.isArray(d.grid) || d.grid.length < 10) return "budget grid missing or too short";
      return null;
    },
    // budget-data writes updatedAt, finder-counts writes updated
    stamp: (d) => d.updatedAt || d.updated,
  },
  {
    label: "Property finder counts",
    file: "/opt/info-hub/var/admin/finder-counts.json",
    page: "/property-finder/",
    maxAgeHours: 36,
    shape: (d) => {
      const areas = Array.isArray(d) ? d : d.areas;
      if (!Array.isArray(areas) || areas.length < 8) return `only ${areas?.length ?? 0} areas (expected 8+)`;
      const total = areas.reduce((a, x) => a + (x.total || 0), 0);
      if (total < 100) return `total listings across all areas is only ${total}`;
      return null;
    },
    // budget-data writes updatedAt, finder-counts writes updated
    stamp: (d) => d.updatedAt || d.updated,
  },
];

const env = await fs.readFile(ENV, "utf8").catch(() => "");
const cfg = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1] || "").trim();
const KEY = cfg("MANDRILL_API_KEY");
const TO = cfg("NOTIFY_TO");
const FROM = cfg("NOTIFY_FROM");

const problems = [];

for (const c of CHECKS) {
  let raw, data, ageH = null;
  try {
    raw = await fs.readFile(c.file, "utf8");
    data = JSON.parse(raw);
  } catch (e) {
    problems.push(`${c.label}: cannot read or parse ${c.file} (${e.message})`);
    continue;
  }

  // prefer the file's own timestamp, fall back to mtime
  let when = c.stamp(data) ? new Date(c.stamp(data)) : null;
  if (!when || isNaN(when)) when = (await fs.stat(c.file)).mtime;
  ageH = (Date.now() - when.getTime()) / 3600000;

  if (ageH > c.maxAgeHours) {
    problems.push(`${c.label}: last updated ${ageH.toFixed(1)}h ago (limit ${c.maxAgeHours}h). ${SITE}${c.page} is serving stale numbers.`);
  }
  const shapeIssue = c.shape(data);
  if (shapeIssue) {
    problems.push(`${c.label}: ${shapeIssue}. ${SITE}${c.page} may be rendering wrong figures.`);
  }
  console.error(`${c.label}: age ${ageH.toFixed(1)}h, shape ${shapeIssue ? "FAIL - " + shapeIssue : "ok"}`);
}

if (!problems.length) {
  console.error("all data files fresh and well-shaped");
  process.exit(0);
}

console.error("\nPROBLEMS:\n" + problems.map((p) => " - " + p).join("\n"));

if (!KEY || !TO || !FROM) {
  console.error("mail not configured; problems logged only");
  process.exit(1);
}

const html =
  `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px">` +
  `<p style="font-size:16px;margin:0 0 14px"><strong>Site data needs a look</strong> on info.propertylist.es</p>` +
  `<ul style="font-size:14px;color:#101828;line-height:1.6">` +
  problems.map((p) => `<li>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("") +
  `</ul>` +
  `<p style="font-size:13px;color:#667085">These files are rebuilt by cron (finder-counts 04:30, budget-data 04:50). ` +
  `Both keep their last good copy when the portal API misbehaves, so the pages stay up but the numbers age. ` +
  `Check the logs in /opt/info-hub/var/log/.</p></div>`;

try {
  const res = await fetch("https://mandrillapp.com/api/1.0/messages/send.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: KEY,
      message: {
        from_email: FROM,
        from_name: "PropertyList Info Hub",
        to: [{ email: TO, type: "to" }],
        subject: `Info hub: ${problems.length} data check${problems.length > 1 ? "s" : ""} failed`,
        html,
        text: "Site data needs a look on info.propertylist.es\n\n" + problems.map((p) => "- " + p).join("\n"),
      },
    }),
  });
  console.error("mandrill:", res.status, (await res.text()).slice(0, 120));
} catch (e) {
  console.error("mail failed:", e.message);
}
process.exit(1);
