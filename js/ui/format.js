// Dates and numbers as the page shows them, the same in every language.
//
// Dates are always YYYY-MM-DD, and a decimal point is always a dot. Nothing here
// goes through toLocaleString(): what it gives depends on the browser and on the
// locale asked for, and the page used to ask for Polish, so the English version
// showed 11.11.2026 and decimal commas.

const pad2 = (n) => String(n).padStart(2, '0');

/** `2026-11-11` */
export function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `2026-11-11 18:33` */
export function isoDateTime(d) {
  return `${isoDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `2026-11-11-183305` - for file names, which cannot hold a colon. */
export function fileStamp(d = new Date()) {
  return `${isoDate(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * A number with a dot for the decimal point and, from five digits on, its
 * thousands set apart by a no-break space: `1234`, `12 345`, `1 234 567.5`.
 * A space rather than a comma, so the grouping cannot be mistaken for a
 * decimal point in either language.
 */
export function formatNumber(n, decimals = 0) {
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+$)/g, ' ') : whole;
  return (n < 0 && Number(fixed) !== 0 ? '-' : '') + grouped + (frac ? `.${frac}` : '');
}
