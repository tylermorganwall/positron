/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './posixClockWidget.css';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { safeIntl } from '../../../../base/common/date.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { PosixClockValue, resolveWallTime, solarPosition } from '../common/posixClock.js';
import { landPath, zonePaths } from './media/posixClockMapData.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const mapWidth = 360;
const mapHeight = 180;
const mapOverview = `0 0 ${mapWidth} ${mapHeight}`;
const mapZoom = 3;
let supportedZones: readonly string[] | undefined;
const weekdayFormatter = safeIntl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const dateFormatter = safeIntl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });

/** A compact, native hover control. Construct every element in the editor's document. */
export class PosixClockWidget extends Disposable {
	readonly domNode: HTMLElement;
	private readonly document: Document;
	private readonly calendar: HTMLElement;
	private readonly month: HTMLInputElement;
	private readonly time: HTMLInputElement;
	private readonly timezone: HTMLSelectElement;
	private readonly night: SVGPathElement;
	private readonly twilight: SVGPathElement;
	private readonly dateButtons = new Map<string, HTMLButtonElement>();
	private tabStop: HTMLButtonElement | undefined;
	private readonly zoneElements = new Map<string, SVGPathElement>();
	private value: PosixClockValue;
	private viewMonth: string;

	constructor(parent: HTMLElement | DocumentFragment, value: PosixClockValue, private readonly onChange: (value: PosixClockValue) => boolean) {
		super();
		this.document = parent.ownerDocument;
		this.value = { ...value };
		this.viewMonth = value.datetime.slice(0, 7);
		this.domNode = this.document.createElement('div');
		this.domNode.className = 'posix-clock-widget';
		this.domNode.setAttribute('role', 'group');
		this.domNode.setAttribute('aria-label', localize('posixClock.picker', "Date, Time and Time Zone"));
		parent.appendChild(this.domNode);

		const mapColumn = this.element('div', 'posix-clock-map-column', this.domNode);
		const mapFrame = this.element('div', 'posix-clock-map-frame', mapColumn);
		const map = this.document.createElementNS(svgNamespace, 'svg');
		map.classList.add('posix-clock-map');
		map.setAttribute('viewBox', mapOverview);
		map.setAttribute('aria-hidden', 'true');
		// The adjacent select provides the keyboard/screen-reader equivalent for every zone.
		map.setAttribute('focusable', 'false');
		mapFrame.appendChild(map);
		const zoomOut = this.button(mapFrame, '−', localize('posixClock.zoomOut', "Zoom Out"));
		zoomOut.className = 'posix-clock-zoom-out';
		zoomOut.hidden = true;
		const title = this.document.createElementNS(svgNamespace, 'title');
		title.textContent = localize('posixClock.map', "Time zones (approximate boundaries); shaded area is night. Map: © OpenStreetMap contributors, ODbL 1.0; Natural Earth, public domain.");
		map.appendChild(title);
		this.path(map, landPath, 'posix-clock-land');
		for (const [zone, path] of zonePaths) {
			const region = this.path(map, path, 'posix-clock-zone');
			region.dataset.zone = zone;
			const title = this.document.createElementNS(svgNamespace, 'title');
			title.textContent = zone;
			region.appendChild(title);
			this.zoneElements.set(zone, region);
		}
		this.twilight = this.path(map, '', 'posix-clock-twilight');
		this.night = this.path(map, '', 'posix-clock-night');
		this.timezone = this.document.createElement('select');
		this.timezone.className = 'posix-clock-timezone';
		this.timezone.title = localize('posixClock.attribution', "Map: © OpenStreetMap contributors (ODbL 1.0), Natural Earth (public domain). Approximate geographic boundaries.");
		this.timezone.setAttribute('aria-label', localize('posixClock.timezone', "Time Zone"));
		if (!supportedZones) {
			const zones = new Set(['UTC', ...zonePaths.map(([zone]) => zone), ...Intl.supportedValuesOf('timeZone')]);
			supportedZones = [...zones].sort().filter(zone => {
				try {
					// Deliberately validate eagerly; unsupported zone names must throw.
					// eslint-disable-next-line no-restricted-syntax
					new Intl.DateTimeFormat('en', { timeZone: zone });
					return true;
				} catch {
					return false;
				}
			});
		}
		for (const zone of [...new Set([...supportedZones, value.timezone])].sort()) {
			const option = this.document.createElement('option');
			option.value = zone;
			option.textContent = zone;
			this.timezone.appendChild(option);
		}
		this.timezone.value = value.timezone;
		mapColumn.appendChild(this.timezone);

		const dateColumn = this.element('div', 'posix-clock-date-column', this.domNode);
		const header = this.element('div', 'posix-clock-month-row', dateColumn);
		const previous = this.button(header, '‹', localize('posixClock.previous', "Previous Month"));
		this.month = this.document.createElement('input');
		this.month.type = 'month';
		this.month.min = '0001-01';
		this.month.max = '9999-12';
		this.month.value = this.viewMonth;
		this.month.setAttribute('aria-label', localize('posixClock.month', "Calendar Month"));
		header.appendChild(this.month);
		const next = this.button(header, '›', localize('posixClock.next', "Next Month"));
		const weekdays = this.element('div', 'posix-clock-weekdays', dateColumn);
		weekdays.setAttribute('aria-hidden', 'true');
		for (let day = 0; day < 7; day++) {
			const label = this.element('span', '', weekdays);
			label.textContent = weekdayFormatter.value.format(new Date(Date.UTC(2023, 0, day + 1)));
		}
		this.calendar = this.element('div', 'posix-clock-calendar', dateColumn);
		this.calendar.setAttribute('role', 'group');
		this.calendar.setAttribute('aria-label', localize('posixClock.date', "Date"));
		this.time = this.document.createElement('input');
		this.time.type = 'time';
		this.time.step = '1';
		this.time.value = value.datetime.slice(11);
		this.time.setAttribute('aria-label', localize('posixClock.time', "Local Time"));
		dateColumn.appendChild(this.time);

		this._register(addDisposableListener(previous, 'click', () => this.moveMonth(-1)));
		this._register(addDisposableListener(next, 'click', () => this.moveMonth(1)));
		this._register(addDisposableListener(this.month, 'input', () => {
			if (this.month.validity.valid && /^\d{4}-\d{2}$/.test(this.month.value)) {
				this.viewMonth = this.month.value;
				this.renderCalendar();
			}
		}));
		this._register(addDisposableListener(this.calendar, 'click', event => {
			const day = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
			if (day?.dataset.date) {
				this.chooseDate(day.dataset.date);
			}
		}));
		this._register(addDisposableListener(this.calendar, 'keydown', event => this.calendarKeydown(event)));
		this._register(addDisposableListener(this.time, 'input', () => {
			// A previously rejected DST gap must not block correcting the field.
			this.time.setCustomValidity('');
			if (this.time.validity.valid && this.time.value) {
				const time = this.time.value.length === 5 ? `${this.time.value}:00` : this.time.value;
				this.change({ ...this.value, datetime: `${this.value.datetime.slice(0, 10)} ${time}` });
			}
		}));
		this._register(addDisposableListener(this.timezone, 'change', () => this.change({ ...this.value, timezone: this.timezone.value })));
		this._register(addDisposableListener(zoomOut, 'click', () => {
			map.setAttribute('viewBox', mapOverview);
			map.classList.remove('zoomed');
			this.timezone.focus();
			zoomOut.hidden = true;
		}));
		this._register(addDisposableListener(map, 'click', event => {
			if (zoomOut.hidden) {
				map.setAttribute('viewBox', zoomedMapViewBox(map, event));
				map.classList.add('zoomed');
				zoomOut.hidden = false;
				return;
			}
			const zone = (event.target as Element).closest<SVGPathElement>('[data-zone]')?.dataset.zone;
			if (zone && [...this.timezone.options].some(option => option.value === zone)) {
				this.timezone.focus();
				this.change({ ...this.value, timezone: zone });
			}
		}));
		this.renderCalendar();
		this.renderMap();
		const instants = resolveWallTime(value.datetime, value.timezone);
		if (instants.length > 1) {
			this.time.title = localize('posixClock.fold', "This time occurs twice. R chooses the occurrence; the map previews the earlier one.");
		}
	}

	focus(): void {
		this.tabStop?.focus();
	}

	private element(tag: string, className: string, parent: HTMLElement): HTMLElement {
		const element = this.document.createElement(tag);
		element.className = className;
		parent.appendChild(element);
		return element;
	}

	private button(parent: HTMLElement, text: string, label: string): HTMLButtonElement {
		const button = this.document.createElement('button');
		button.type = 'button';
		button.textContent = text;
		button.setAttribute('aria-label', label);
		button.title = label;
		parent.appendChild(button);
		return button;
	}

	private path(parent: SVGElement, data: string, className: string): SVGPathElement {
		const path = this.document.createElementNS(svgNamespace, 'path');
		path.setAttribute('d', data);
		path.setAttribute('fill-rule', 'evenodd');
		path.classList.add(className);
		parent.appendChild(path);
		return path;
	}

	private moveMonth(delta: number): void {
		const date = new Date(`${this.viewMonth}-01T12:00:00Z`);
		date.setUTCMonth(date.getUTCMonth() + delta);
		if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
			return;
		}
		this.viewMonth = date.toISOString().slice(0, 7);
		this.month.value = this.viewMonth;
		this.renderCalendar();
	}

	private chooseDate(date: string): void {
		this.change({ ...this.value, datetime: `${date} ${this.value.datetime.slice(11)}` });
	}

	private calendarKeydown(event: KeyboardEvent): void {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
		if (!button?.dataset.date) {
			return;
		}
		const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : undefined;
		if (delta !== undefined) {
			event.preventDefault();
			event.stopPropagation();
			const date = new Date(`${button.dataset.date}T12:00:00Z`);
			date.setUTCDate(date.getUTCDate() + delta);
			if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
				return;
			}
			const value = date.toISOString().slice(0, 10);
			this.viewMonth = value.slice(0, 7);
			this.month.value = this.viewMonth;
			this.renderCalendar(value);
			this.dateButtons.get(value)?.focus();
		}
	}

	private renderCalendar(focusedDate?: string): void {
		const first = new Date(`${this.viewMonth}-01T12:00:00Z`);
		const start = new Date(first);
		start.setUTCDate(1 - first.getUTCDay());
		const selected = this.value.datetime.slice(0, 10);
		const tabStop = focusedDate ?? (selected.startsWith(this.viewMonth) ? selected : `${this.viewMonth}-01`);
		const fragment = this.document.createDocumentFragment();
		this.dateButtons.clear();
		this.tabStop = undefined;
		for (let index = 0; index < 42; index++) {
			const date = new Date(start);
			date.setUTCDate(start.getUTCDate() + index);
			const iso = date.toISOString().slice(0, 10);
			const button = this.document.createElement('button');
			button.type = 'button';
			button.textContent = String(date.getUTCDate());
			button.dataset.date = iso;
			button.tabIndex = iso === tabStop ? 0 : -1;
			this.dateButtons.set(iso, button);
			if (iso === tabStop) {
				this.tabStop = button;
			}
			button.disabled = date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999;
			button.classList.toggle('adjacent-month', !iso.startsWith(this.viewMonth));
			button.classList.toggle('selected', iso === selected);
			button.setAttribute('aria-pressed', String(iso === selected));
			button.setAttribute('aria-label', dateFormatter.value.format(date));
			fragment.appendChild(button);
		}
		this.calendar.replaceChildren(fragment);
	}

	private change(value: PosixClockValue): void {
		const instants = resolveWallTime(value.datetime, value.timezone);
		if (instants.length === 0) {
			const message = localize('posixClock.invalid', "This local time does not exist in the selected time zone.");
			this.time.setAttribute('aria-invalid', 'true');
			this.time.title = message;
			this.time.setCustomValidity(message);
			// Keep typed time visible for correction, but never modify the R call.
			this.timezone.value = this.value.timezone;
			return;
		}
		this.time.removeAttribute('aria-invalid');
		this.time.setCustomValidity('');
		if (!this.onChange(value)) {
			this.timezone.value = this.value.timezone;
			this.time.value = this.value.datetime.slice(11);
			return;
		}
		const hadCalendarFocus = this.calendar.contains(this.document.activeElement);
		this.value = value;
		this.timezone.value = value.timezone;
		this.time.value = value.datetime.slice(11);
		this.viewMonth = value.datetime.slice(0, 7);
		this.month.value = this.viewMonth;
		this.time.title = instants.length > 1 ? localize('posixClock.fold', "This time occurs twice. R chooses the occurrence; the map previews the earlier one.") : '';
		this.renderCalendar();
		this.renderMap();
		if (hadCalendarFocus) {
			this.focus();
		}
	}

	private renderMap(): void {
		for (const [zone, element] of this.zoneElements) {
			element.classList.toggle('selected', zone === this.value.timezone);
		}
		const instant = resolveWallTime(this.value.datetime, this.value.timezone)[0];
		if (instant === undefined) {
			this.night.setAttribute('d', '');
			this.twilight.setAttribute('d', '');
			return;
		}
		const sun = solarPosition(instant);
		this.twilight.setAttribute('d', nightPolygon(sun, 0));
		this.night.setAttribute('d', nightPolygon(sun, -6));
	}
}

/** Convert the pointer to world-map coordinates and clamp the zoom to the edges. */
function zoomedMapViewBox(map: SVGSVGElement, event: MouseEvent): string {
	const bounds = map.getBoundingClientRect();
	const width = map.clientWidth || bounds.width;
	const height = map.clientHeight || bounds.height;
	const scale = Math.min(width / mapWidth, height / mapHeight);
	const x = scale > 0 ? (event.clientX - bounds.left - (map.clientLeft || 0) - (width - mapWidth * scale) / 2) / scale : mapWidth / 2;
	const y = scale > 0 ? (event.clientY - bounds.top - (map.clientTop || 0) - (height - mapHeight * scale) / 2) / scale : mapHeight / 2;
	const zoomWidth = mapWidth / mapZoom;
	const zoomHeight = mapHeight / mapZoom;
	const left = Math.max(0, Math.min(mapWidth - zoomWidth, x - zoomWidth / 2));
	const top = Math.max(0, Math.min(mapHeight - zoomHeight, y - zoomHeight / 2));
	return `${left} ${top} ${zoomWidth} ${zoomHeight}`;
}

/**
 * Clip the night cap into longitude strips. Unlike a single closed great-circle
 * path, this represents polar day/night and antimeridian crossings without seams
 * or an accidentally shaded daytime hemisphere. One degree is subpixel here.
 */
function nightPolygon(sun: { latitude: number; longitude: number }, altitude: number): string {
	const radians = Math.PI / 180;
	const a = Math.sin(sun.latitude * radians);
	const threshold = Math.sin(altitude * radians);
	const paths: string[] = [];
	for (let x = 0; x < 360; x++) {
		const b = Math.cos(sun.latitude * radians) * Math.cos((x - 179.5 - sun.longitude) * radians);
		const magnitude = Math.hypot(a, b);
		const phase = Math.atan2(b, a);
		const roots = [-Math.PI / 2, Math.PI / 2];
		if (magnitude >= Math.abs(threshold)) {
			const angle = Math.asin(threshold / magnitude);
			for (const base of [angle - phase, Math.PI - angle - phase]) {
				for (let turn = -1; turn <= 1; turn++) {
					const root = base + turn * 2 * Math.PI;
					if (root > -Math.PI / 2 && root < Math.PI / 2) {
						roots.push(root);
					}
				}
			}
		}
		roots.sort((left, right) => left - right);
		for (let index = 0; index < roots.length - 1; index++) {
			const latitude = (roots[index] + roots[index + 1]) / 2;
			if (a * Math.sin(latitude) + b * Math.cos(latitude) < threshold) {
				const top = (90 - roots[index + 1] / radians).toFixed(2);
				const bottom = (90 - roots[index] / radians).toFixed(2);
				paths.push(`M${x},${top}H${x + 1}V${bottom}H${x}Z`);
			}
		}
	}
	return paths.join('');
}
