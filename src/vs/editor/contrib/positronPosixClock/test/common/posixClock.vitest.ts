/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { findPosixClockCall, PosixClockValue, posixClockEdits, resolveWallTime, solarPosition } from '../../common/posixClock.js';

const datetime = '2026-12-02 13:14:15';
const timezone = 'America/New_York';

function edit(source: string, value: PosixClockValue): string {
	const call = findPosixClockCall(source, source.indexOf('as.POSIXct'))!;
	const edits = posixClockEdits(call, value)!;
	for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
		source = source.slice(0, start) + text + source.slice(end);
	}
	return source;
}

describe('POSIXct source edits', () => {
	it('opens on an empty call and inserts both literals without changing surrounding code', () => {
		expect(edit('before <- 1; t <- as.POSIXct(); after <- 2', { datetime, timezone }))
			.toBe('before <- 1; t <- as.POSIXct("2026-12-02 13:14:15", tz = "America/New_York"); after <- 2');
	});

	it('accepts base:: and locates a call from inside its arguments', () => {
		const source = 'outer(base::as.POSIXct("2026-01-02", tz = "UTC"))';
		const call = findPosixClockCall(source, source.indexOf('01-02'))!;
		expect(call.value).toEqual({ datetime: '2026-01-02 00:00:00', timezone: 'UTC' });
		expect(call.source).toBe('base::as.POSIXct("2026-01-02", tz = "UTC")');
		expect(findPosixClockCall(source, call.start)).toEqual(call);
		expect(findPosixClockCall(source, source.length - 1)).toBeUndefined();
	});

	it('preserves comments, order, whitespace, and quote style around arguments', () => {
		const source = `base::as.POSIXct(\n\ttz = 'UTC', # zone\n\tx = '2026-01-02 03:04' # wall clock\n)`;
		expect(edit(source, { datetime, timezone }))
			.toBe(`base::as.POSIXct(\n\ttz = 'America/New_York', # zone\n\tx = '2026-12-02 13:14:15' # wall clock\n)`);
		expect(edit('as.POSIXct("2026-01-02" # date\n)', { datetime, timezone }))
			.toMatch(/^as\.POSIXct\("2026-12-02 13:14:15"(?:, tz = "America\/New_York")? # date\n\)$/);
	});

	it('changes only the requested literal and preserves implicit timezone', () => {
		const source = 'as.POSIXct("2026-01-02")';
		const local = findPosixClockCall(source, 0)!.value.timezone;
		expect(edit(source, { datetime, timezone: local })).toBe('as.POSIXct("2026-12-02 13:14:15")');
		expect(edit('as.POSIXct("2026-01-02", tz = "UTC")', { datetime: '2026-01-02 00:00:00', timezone }))
			.toBe('as.POSIXct("2026-01-02", tz = "America/New_York")');
	});

	it('handles comment-only empty calls without putting code inside the comment', () => {
		expect(edit('as.POSIXct(# keep\n)', { datetime, timezone }))
			.toBe('as.POSIXct("2026-12-02 13:14:15", tz = "America/New_York" # keep\n)');
	});

	it.each([
		'# as.POSIXct()',
		'"as.POSIXct()"',
		`'unclosed as.POSIXct()`,
		'r"--( " as.POSIXct() )--"',
		'`as.POSIXct()`',
		'(pkg::as.POSIXct())',
		'(base:::as.POSIXct())',
		'object$as.POSIXct()',
		'prefix.as.POSIXct()',
		'as.POSIXct(iso)',
		'as.POSIXct("2026-01-02", tz = zone)',
		'as.POSIXct("2026-01-02", format = "%Y-%m-%d")',
		'as.POSIXct("2026-02-30")',
		'as.POSIXct("2026-02-20",)',
		'as.POSIXct("2026-02-20", x = "2026-02-21")',
		'as.POSIXct("2026-02-20", tz = "Bogus/Zone")',
	])('does not offer edits for %s', source => {
		expect(findPosixClockCall(source, source.indexOf('as.POSIXct'))).toBeUndefined();
	});

	it('finds a real call after comments and raw strings', () => {
		const source = 'r"---({ " as.POSIXct() } )---"\n# as.POSIXct()\nas.POSIXct()';
		expect(findPosixClockCall(source, source.lastIndexOf('as.POSIXct'))?.source).toBe('as.POSIXct()');
	});

	it('does not write a nonexistent local time or invalid date', () => {
		const call = findPosixClockCall('as.POSIXct()', 0)!;
		expect(posixClockEdits(call, { datetime: '2026-03-08 02:30:00', timezone })).toBeUndefined();
		expect(posixClockEdits(call, { datetime: '2026-02-30 00:00:00', timezone: 'UTC' })).toBeUndefined();
	});
});

describe('wall time and solar position', () => {
	it('returns both instants in a DST fold', () => {
		expect(resolveWallTime('2026-11-01 01:30:00', timezone))
			.toEqual([Date.parse('2026-11-01T05:30:00Z'), Date.parse('2026-11-01T06:30:00Z')]);
	});

	it('supports fractional offsets', () => {
		expect(resolveWallTime('2026-12-02 13:14:15', 'Asia/Kathmandu')).toEqual([Date.parse('2026-12-02T07:29:15Z')]);
	});

	it('has northern summer and winter subsolar latitudes and roughly Greenwich noon', () => {
		const june = solarPosition(Date.parse('2026-06-21T12:00:00Z'));
		const december = solarPosition(Date.parse('2026-12-21T12:00:00Z'));
		expect(june.latitude).toBeCloseTo(23.44, 1);
		expect(december.latitude).toBeCloseTo(-23.44, 1);
		expect(Math.abs(june.longitude)).toBeLessThan(2);
		expect(Math.abs(december.longitude)).toBeLessThan(2);
	});
});
