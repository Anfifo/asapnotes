/** The name a meeting note gets unless the user types over it — the local
 * date and time, with a dot in the clock because filenames can't hold a
 * colon. */
export const defaultMeetingName = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `Meeting ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

/** Seconds as a clock: 303 → "5:03", 3725 → "1:02:05". */
export const formatElapsed = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
};
