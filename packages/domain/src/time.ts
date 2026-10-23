/** The time zone for every date and time shown to users (AGENTS.md). */
export const TORONTO = "America/Toronto";

// The value of an <input type="datetime-local">: seconds optional.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const partsFormat = (timeZone: string) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

/** The zone's wall-clock time at instant `ms`, written as if it were UTC. */
function wallClock(ms: number, timeZone: string): number {
	const parts: Record<string, number> = {};
	for (const part of partsFormat(timeZone).formatToParts(new Date(ms)))
		if (part.type !== "literal") parts[part.type] = Number(part.value);
	return Date.UTC(
		parts.year as number,
		(parts.month as number) - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
}

/** The zone's offset from UTC at instant `ms`, in milliseconds. */
const offsetAt = (ms: number, timeZone: string) => {
	const whole = Math.floor(ms / 1000) * 1000;
	return wallClock(whole, timeZone) - whole;
};

/**
 * Reads a wall-clock time in `timeZone` as an instant. A time inside a
 * spring-forward gap is "nonexistent"; a time in a fall-back hour happens
 * twice and the earlier (first) occurrence is used.
 */
export function zonedLocalToUtc(
	local: string,
	timeZone: string,
): Date | "invalid" | "nonexistent" {
	const match = LOCAL.exec(local);
	if (!match) return "invalid";
	const [year, month, day, hour, minute, second] = match
		.slice(1)
		.map((part) => Number(part ?? 0)) as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	const naive = Date.UTC(year, month - 1, day, hour, minute, second);
	const check = new Date(naive);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	)
		return "invalid";
	// The offsets on either side of any transition near this time.
	const offsets = new Set([
		offsetAt(naive - 86_400_000, timeZone),
		offsetAt(naive + 86_400_000, timeZone),
	]);
	const matches = [...offsets]
		.map((offset) => naive - offset)
		.filter((ms) => wallClock(ms, timeZone) === naive)
		.sort((a, b) => a - b);
	return matches.length ? new Date(matches[0] as number) : "nonexistent";
}

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO 8601 with the zone's offset, e.g. 2026-11-01T09:00:00-05:00. */
export function toOffsetIso(date: Date, timeZone: string): string {
	const ms = Math.floor(date.getTime() / 1000) * 1000;
	const offset = offsetAt(ms, timeZone);
	const wall = new Date(ms + offset).toISOString().slice(0, 19);
	const minutes = Math.abs(offset) / 60_000;
	const sign = offset < 0 ? "-" : "+";
	return `${wall}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

const yearIn = (date: Date, timeZone: string) =>
	new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(date);

/**
 * A date and time for people to read, e.g. "Sun, Nov 1, 9:00 a.m.". The year
 * is added when it differs from the current year in that zone, e.g.
 * "Fri, Jan 1, 2027, 9:00 a.m.".
 */
export function formatInZone(
	iso: string,
	timeZone: string,
	now: Date = new Date(),
): string {
	const date = new Date(iso);
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		weekday: "short",
		month: "short",
		day: "numeric",
		...(yearIn(date, timeZone) === yearIn(now, timeZone)
			? {}
			: { year: "numeric" }),
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}
