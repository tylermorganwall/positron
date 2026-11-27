/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Semantic queries for native DOM controls, not React components.
// eslint-disable-next-line local/code-import-patterns
import { within } from '@testing-library/dom';
// Integration coverage intentionally instantiates the real standalone editor.
// eslint-disable-next-line local/code-import-patterns
import * as editor from '../../../../standalone/browser/standaloneEditor.js';
// Its public language registration API supplies the provider fixture.
// eslint-disable-next-line local/code-import-patterns
import * as languages from '../../../../standalone/browser/standaloneLanguages.js';
import '../../../hover/browser/hoverContribution.js';
import '../../browser/posixClock.contribution.js';
import { ContentHoverController } from '../../../hover/browser/contentHoverController.js';
import { Range } from '../../../../common/core/range.js';
import { HoverStartMode, HoverStartSource } from '../../../hover/browser/hoverOperation.js';

// Exercise the real editor, hover registry/controller, model, and widget rather
// than mocking executeEdits. happy-dom cannot validate pointer hit-testing or
// pixel layout; those remain browser smoke checks.
test('native editor hover edits repeatedly, survives theme changes, and supports undo', async () => {
	// happy-dom exposes a partial clipboard that triggers the editor's Safari
	// workaround but does not consume its pending write promises.
	vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as never);
	const container = document.createElement('div');
	document.body.appendChild(container);
	languages.register({ id: 'r' });
	const provideHover = vi.fn(() => ({ contents: [{ value: 'R documentation fixture' }] }));
	const provider = languages.registerHoverProvider('r', { provideHover });
	const instance = editor.create(container, {
		value: 'as.POSIXct("2026-11-17 14:00:00", tz = "UTC")',
		language: 'r',
		dimension: { width: 800, height: 600 },
		// These canvas surfaces are not implemented by happy-dom.
		minimap: { enabled: false },
		overviewRulerLanes: 0,
		scrollBeyondLastLine: false,
	});
	const model = instance.getModel();
	try {
		const hover = instance.getContribution<ContentHoverController>(ContentHoverController.ID)!;
		hover.showContentHover(new Range(1, 3, 1, 3), HoverStartMode.Immediate, HoverStartSource.Keyboard, true);
		await vi.waitFor(() => expect(within(container).getByRole('group', { name: 'Date, Time and Time Zone' })).toBeInTheDocument());
		expect(hover.isHoverVisible).toBe(true);
		expect(provideHover).not.toHaveBeenCalled();

		within(container).getByRole<HTMLButtonElement>('button', { name: /Wednesday, November 18, 2026/ }).click();
		expect(instance.getValue()).toContain('2026-11-18 14:00:00');
		expect(hover.isHoverVisible).toBe(true);
		const time = within(container).getByLabelText<HTMLInputElement>('Local Time');
		time.value = '15:25:45';
		time.dispatchEvent(new Event('input'));
		expect(instance.getValue()).toContain('2026-11-18 15:25:45');
		// The geographic region is a pointer target; keyboard users use the zone select.
		// eslint-disable-next-line no-restricted-syntax
		const region = container.querySelector('[data-zone="America/New_York"]')!;
		region.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(instance.getValue()).toContain('tz = "UTC"');
		expect(within(container).getByRole('button', { name: 'Zoom Out' })).toBeVisible();
		region.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(instance.getValue()).toContain('tz = "America/New_York"');
		expect(hover.isHoverVisible).toBe(true);

		editor.setTheme('vs');
		await new Promise(resolve => setTimeout(resolve, 100));
		within(container).getByRole<HTMLButtonElement>('button', { name: /Thursday, November 19, 2026/ }).click();
		expect(instance.getValue()).toContain('2026-11-19 15:25:45');
		instance.trigger('test', 'undo', null);
		expect(instance.getValue()).toContain('2026-11-18 15:25:45');
		expect(hover.isHoverVisible).toBe(false);

		instance.setValue('as.POSIXct(dynamicValue)');
		hover.showContentHover(new Range(1, 3, 1, 3), HoverStartMode.Immediate, HoverStartSource.Keyboard, true);
		await vi.waitFor(() => expect(provideHover).toHaveBeenCalled());
		await vi.waitFor(() => expect(container).toHaveTextContent('R documentation fixture'));
	} finally {
		instance.dispose();
		model?.dispose();
		provider.dispose();
		container.remove();
		editor.setTheme('vs');
	}
});
