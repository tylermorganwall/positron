/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PosixClockValue {
	readonly datetime: string;
	readonly timezone: string;
}

interface Token {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export interface PosixClockCall {
	readonly start: number;
	readonly end: number;
	readonly source: string;
	readonly value: PosixClockValue;
	readonly dateLiteral?: Token;
	readonly zoneLiteral?: Token;
	readonly close: number;
}

interface PosixClockEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

// R raw strings can contain ordinary quotes, comments and would-be calls.
// Match them before the ordinary strings. An unclosed string consumes the
// remaining input rather than allowing false hits inside it.
const tokenPattern = /#[^\r\n]*|[rR](["'])(-*)([([{])|"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\?$)|`(?:\\[\s\S]|[^`\\])*(?:`|\\?$)|[\p{L}\p{M}\p{N}_.]+|:::|::|<-|->|==|\S/gu;
const rawClose: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const datetimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function* tokens(text: string, start = 0): Generator<Token> {
	const pattern = new RegExp(tokenPattern, tokenPattern.flags);
	pattern.lastIndex = start;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		if (match[0].startsWith('#')) {
			continue;
		}
		if (match[1]) {
			const delimiter = rawClose[match[3]] + match[2] + match[1];
			const close = text.indexOf(delimiter, pattern.lastIndex);
			pattern.lastIndex = close < 0 ? text.length : close + delimiter.length;
		}
		yield { start: match.index, end: pattern.lastIndex, text: text.slice(match.index, pattern.lastIndex) };
	}
}

function quotedValue(token: Token): string | undefined {
	const match = /^(["'])([^"'\\\r\n]*)\1$/.exec(token.text);
	return match?.[2];
}

function isDateTime(value: string): boolean {
	if (!datetimePattern.test(value) || value.startsWith('0000-')) {
		return false;
	}
	const timestamp = Date.parse(value.replace(' ', 'T') + 'Z');
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ') === value;
}

function normalizeDateTime(value: string): string | undefined {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		value += ' 00:00:00';
	} else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
		value += ':00';
	}
	return isDateTime(value) ? value : undefined;
}

function readCall(text: string, anchor: Token, open: Token, offset: number, now: number): PosixClockCall | undefined {
	const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	const body = tokens(text, open.end);
	let current = body.next().value;
	let dateLiteral: Token | undefined;
	let zoneLiteral: Token | undefined;
	let datetime: string | undefined;
	let timezone = localZone;

	// Accept just the empty call and literal x/tz arguments. Do not guess
	// R's partial matching, evaluate expressions, or rewrite custom formats.
	while (current && current.text !== ')') {
		let name = 'x';
		if (current.text === 'x' || current.text === 'tz') {
			name = current.text;
			if (body.next().value?.text !== '=') {
				return undefined;
			}
			current = body.next().value;
		}
		if (!current) {
			return undefined;
		}
		const value = quotedValue(current);
		if (value === undefined) {
			return undefined;
		}
		if (name === 'x' && !dateLiteral) {
			datetime = normalizeDateTime(value);
			if (!datetime) {
				return undefined;
			}
			dateLiteral = current;
		} else if (name === 'tz' && !zoneLiteral) {
			timezone = value || localZone;
			if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timezone)) {
				return undefined;
			}
			try {
				new Intl.DateTimeFormat('en', { timeZone: timezone });
			} catch {
				return undefined;
			}
			zoneLiteral = current;
		} else {
			return undefined;
		}
		current = body.next().value;
		if (current?.text === ',') {
			current = body.next().value;
			if (current?.text === ')') {
				return undefined;
			}
		} else {
			break;
		}
	}
	if (current?.text !== ')' || offset >= current.end || (!dateLiteral && zoneLiteral)) {
		return undefined;
	}
	// An empty call with comments is valid; insert after the opening paren
	// so the comment, indentation and closing line remain untouched.
	return {
		start: anchor.start, end: current.end, source: text.slice(anchor.start, current.end),
		value: { datetime: datetime ?? wallTimeAt(now, timezone), timezone }, dateLiteral, zoneLiteral,
		close: dateLiteral ? current.start : open.end,
	};
}

export function findPosixClockCall(text: string, offset: number, now = Date.now()): PosixClockCall | undefined {
	const source = tokens(text);
	let previous: Token | undefined;
	let beforePrevious: Token | undefined;
	let beforeNamespace: Token | undefined;
	for (const token of source) {
		if (token.start > offset) {
			const withinBasePrefix = (previous?.text === 'base' && token.text === '::')
				|| (beforePrevious?.text === 'base' && previous?.text === '::' && token.text === 'as.POSIXct');
			if (!withinBasePrefix && previous?.text !== 'as.POSIXct') {
				break;
			}
		}
		if (token.text === '(' && previous?.text === 'as.POSIXct') {
			const namespaced = beforePrevious?.text === '::' && beforeNamespace?.text === 'base';
			const anchor = namespaced ? beforeNamespace! : previous;
			if (offset >= anchor.start && (namespaced || !['::', ':::', '$', '@'].includes(beforePrevious?.text ?? ''))) {
				const call = readCall(text, anchor, token, offset, now);
				if (call) {
					return call;
				}
			}
		}
		beforeNamespace = beforePrevious;
		beforePrevious = previous;
		previous = token;
	}
	return undefined;
}

export function posixClockEdits(call: PosixClockCall, value: PosixClockValue): PosixClockEdit[] | undefined {
	if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value.timezone) || !resolveWallTime(value.datetime, value.timezone).length) {
		return undefined;
	}
	if (!call.dateLiteral) {
		const separator = call.source[call.close - call.start] === '#' ? ' ' : '';
		return [{ start: call.close, end: call.close, text: `"${value.datetime}", tz = "${value.timezone}"${separator}` }];
	}
	const edits: PosixClockEdit[] = [];
	if (value.datetime !== call.value.datetime) {
		const quote = call.dateLiteral.text[0];
		edits.push({ start: call.dateLiteral.start, end: call.dateLiteral.end, text: `${quote}${value.datetime}${quote}` });
	}
	if (value.timezone !== call.value.timezone) {
		if (call.zoneLiteral) {
			const quote = call.zoneLiteral.text[0];
			edits.push({ start: call.zoneLiteral.start, end: call.zoneLiteral.end, text: `${quote}${value.timezone}${quote}` });
		} else {
			// Insert next to x rather than at the close, which may be below a comment.
			edits.push({ start: call.dateLiteral.end, end: call.dateLiteral.end, text: `, tz = "${value.timezone}"` });
		}
	}
	return edits;
}

function wallTimeAt(timestamp: number, timezone: string, formatter = wallFormatter(timezone)): string {
	const parts: Record<string, string> = {};
	for (const part of formatter.formatToParts(timestamp)) {
		parts[part.type] = part.value;
	}
	return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function wallFormatter(timezone: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat('en-CA-u-nu-latn-ca-gregory', {
		timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	});
}

// Round-trip plausible neighboring offsets so DST gaps are rejected and
// folds return both instants. The R source remains a wall time, not an epoch.
export function resolveWallTime(datetime: string, timezone: string): number[] {
	if (!isDateTime(datetime)) {
		return [];
	}
	try {
		const formatter = wallFormatter(timezone);
		const nominal = Date.parse(datetime.replace(' ', 'T') + 'Z');
		const candidates = new Set<number>();
		for (const hours of [-36, -12, 0, 12, 36]) {
			const sample = nominal + hours * 3600000;
			const offset = Date.parse(wallTimeAt(sample, timezone, formatter).replace(' ', 'T') + 'Z') - sample;
			const candidate = nominal - offset;
			if (wallTimeAt(candidate, timezone, formatter) === datetime) {
				candidates.add(candidate);
			}
		}
		return [...candidates].sort((a, b) => a - b);
	} catch {
		return [];
	}
}

// Approximation from the Sun's mean longitude, anomaly, and obliquity.
// Longitude is measured east of Greenwich in [-180, 180).
export function solarPosition(timestamp: number): { latitude: number; longitude: number } {
	const rad = Math.PI / 180;
	const days = timestamp / 86400000 - 10957.5; // Days since J2000 noon UTC.
	const meanLongitude = (280.460 + 0.9856474 * days) * rad;
	const anomaly = (357.528 + 0.9856003 * days) * rad;
	const eclipticLongitude = meanLongitude + (1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * rad;
	const obliquity = (23.439 - 0.0000004 * days) * rad;
	const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) / rad;
	const sidereal = 280.46061837 + 360.98564736629 * days;
	return {
		latitude: Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) / rad,
		longitude: ((rightAscension - sidereal + 180) % 360 + 360) % 360 - 180,
	};
}
