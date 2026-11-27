/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// DOM-only controls use semantic Testing Library queries, without React.
// eslint-disable-next-line local/code-import-patterns
import { within } from '@testing-library/dom';
import { safeIntl } from '../../../../../base/common/date.js';
import { PosixClockWidget } from '../../browser/posixClockWidget.js';
import { PosixClockValue } from '../../common/posixClock.js';

describe('PosixClockWidget', () => {
	let widget: PosixClockWidget;
	let container: HTMLElement;
	const change = vi.fn<(value: PosixClockValue) => boolean>();

	function setup(value: PosixClockValue = { datetime: '2026-11-17 14:00:00', timezone: 'UTC' }) {
		container = document.createElement('div');
		document.body.appendChild(container);
		change.mockReturnValue(true);
		widget = new PosixClockWidget(container, value, change);
	}

	function mapElement<T extends Element>(selector: string): T {
		// SVG paths have no accessible role; inspect their geometry and zone metadata.
		// eslint-disable-next-line no-restricted-syntax
		const element = container.querySelector<T>(selector);
		if (!element) {
			throw new Error(`Missing control: ${selector}`);
		}
		return element;
	}

	function dateButton(date: string): HTMLButtonElement {
		const name = safeIntl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' }).value.format(new Date(`${date}T12:00:00Z`));
		return within(container).getByRole<HTMLButtonElement>('button', { name });
	}

	afterEach(() => {
		widget.dispose();
		container.remove();
	});

	test('date clicks update immediately and preserve time and zone across repeated edits', () => {
		setup();
		dateButton('2026-11-18').click();
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-11-18 14:00:00', timezone: 'UTC' });
		dateButton('2026-11-19').click();
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-11-19 14:00:00', timezone: 'UTC' });
		expect(dateButton('2026-11-19')).toHaveAttribute('aria-pressed', 'true');
		expect(container).not.toHaveTextContent(/Apply|Cancel|Save/);
	});

	test('time input updates on input without waiting for blur or an apply button', () => {
		setup();
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '15:23:45';
		time.dispatchEvent(new Event('input'));
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-11-17 15:23:45', timezone: 'UTC' });
	});

	test('rejects a DST gap and allows correcting it', () => {
		setup({ datetime: '2026-03-08 01:30:00', timezone: 'America/New_York' });
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '02:30:00';
		time.dispatchEvent(new Event('input'));
		expect(change).not.toHaveBeenCalled();
		expect(time).toHaveAttribute('aria-invalid', 'true');
		time.value = '03:30:00';
		time.dispatchEvent(new Event('input'));
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-03-08 03:30:00', timezone: 'America/New_York' });
		expect(time).not.toHaveAttribute('aria-invalid');
		expect(time.validity.valid).toBe(true);
	});

	test('map and select choose actual IANA zones and retain local wall time', () => {
		setup();
		const map = mapElement<SVGSVGElement>('.posix-clock-map');
		const newYork = mapElement<SVGElement>('[data-zone="America/New_York"]');
		vi.spyOn(map, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 10, 270, 135));
		newYork.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 95, clientY: 47.5 }));
		expect(change).not.toHaveBeenCalled();
		expect(map).toHaveAttribute('viewBox', '40 20 120 60');
		newYork.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-11-17 14:00:00', timezone: 'America/New_York' });
		expect(map).toHaveAttribute('viewBox', '40 20 120 60');
		const select = within(container).getByLabelText<HTMLSelectElement>('Time Zone');
		expect(select.value).toBe('America/New_York');
		select.value = 'Europe/Paris';
		select.dispatchEvent(new Event('change'));
		expect(change).toHaveBeenLastCalledWith({ datetime: '2026-11-17 14:00:00', timezone: 'Europe/Paris' });
		expect(mapElement('[data-zone="Europe/Paris"]')).toHaveClass('selected');
	});

	test('clamps zoom to the map edges and resets without editing', () => {
		setup();
		const map = mapElement<SVGSVGElement>('.posix-clock-map');
		vi.spyOn(map, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 10, 270, 135));
		map.dispatchEvent(new MouseEvent('click', { clientX: 289, clientY: 144 }));
		expect(map).toHaveAttribute('viewBox', '240 120 120 60');
		const reset = within(container).getByRole<HTMLButtonElement>('button', { name: 'Zoom Out' });
		reset.click();
		expect(map).toHaveAttribute('viewBox', '0 0 360 180');
		expect(reset).not.toBeVisible();
		expect(change).not.toHaveBeenCalled();
		map.dispatchEvent(new MouseEvent('click', { clientX: 21, clientY: 11 }));
		expect(map).toHaveAttribute('viewBox', '0 0 120 60');
		expect(change).not.toHaveBeenCalled();
	});

	test('rejected edits restore controls without changing the selected day', () => {
		setup();
		change.mockReturnValue(false);
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '17:00:00';
		time.dispatchEvent(new Event('input'));
		expect(time.value).toMatch(/^14:00(?::00)?$/);
		dateButton('2026-11-18').click();
		expect(dateButton('2026-11-17')).toHaveAttribute('aria-pressed', 'true');
	});

	test('calendar arrows move focus without changing the call', () => {
		setup();
		widget.focus();
		const selected = dateButton('2026-11-17');
		expect(selected).toHaveFocus();
		selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(dateButton('2026-11-18')).toHaveFocus();
		expect(change).not.toHaveBeenCalled();
		dateButton('2026-11-18').click();
		expect(change).toHaveBeenCalledOnce();
	});

	test('draws night and twilight geometry and updates it with time', () => {
		setup();
		const before = mapElement('.posix-clock-night').getAttribute('d');
		expect(before?.length).toBeGreaterThan(100);
		expect(mapElement('.posix-clock-twilight').getAttribute('d')).not.toBe(before);
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '21:00:00';
		time.dispatchEvent(new Event('input'));
		expect(mapElement('.posix-clock-night').getAttribute('d')).not.toBe(before);
	});

	test('dispose detaches input and calendar listeners', () => {
		setup();
		widget.dispose();
		dateButton('2026-11-18').click();
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '15:23:45';
		time.dispatchEvent(new Event('input'));
		expect(change).not.toHaveBeenCalled();
	});
});
