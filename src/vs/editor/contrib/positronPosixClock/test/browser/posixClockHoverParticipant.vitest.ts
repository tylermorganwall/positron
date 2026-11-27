/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../browser/editorBrowser.js';
import { Range } from '../../../../common/core/range.js';
import { IModelChangedEvent } from '../../../../common/editorCommon.js';
import { ITextModel } from '../../../../common/model.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { HoverRangeAnchor, IEditorHoverRenderContext } from '../../../hover/browser/hoverTypes.js';
import { PosixClockHoverParticipant } from '../../browser/posixClockHoverParticipant.js';
import { PosixClockValue } from '../../common/posixClock.js';

const widget = vi.hoisted(() => ({
	change: undefined as ((value: PosixClockValue) => boolean) | undefined,
	dispose: vi.fn(),
}));
vi.mock('../../browser/posixClockWidget.js', () => ({
	PosixClockWidget: class {
		readonly domNode = document.createElement('div');
		constructor(parent: HTMLElement, _value: PosixClockValue, change: (value: PosixClockValue) => boolean) {
			parent.appendChild(this.domNode);
			widget.change = change;
		}
		dispose(): void { widget.dispose(); }
	},
}));

describe('POSIX clock native hover lifecycle', () => {
	let disposables: DisposableStore;
	beforeEach(() => { disposables = new DisposableStore(); });
	afterEach(() => { disposables.dispose(); });

	function setup(text = 'x <- as.POSIXct("2026-11-17 12:00:00", tz = "UTC")', language = 'r') {
		const model = disposables.add(createTextModel(text, language));
		let currentModel: ITextModel | null = model;
		const modelChanged = disposables.add(new Emitter<IModelChangedEvent>());
		const readOnly = vi.fn().mockReturnValue(false);
		const undoStop = vi.fn().mockReturnValue(true);
		const editor = stubInterface<ICodeEditor>({
			getModel: () => currentModel,
			getOption: readOnly,
			pushUndoStop: undoStop,
			executeEdits: (_source, edits) => { model.applyEdits(edits); return true; },
			onDidChangeModelContent: listener => model.onDidChangeContent(listener),
			onDidChangeModel: modelChanged.event,
		});
		const context = stubInterface<IEditorHoverRenderContext>({
			fragment: document.createDocumentFragment(),
			setMinimumDimensions: vi.fn(),
			hide: vi.fn(),
		});
		const participant = new PosixClockHoverParticipant(editor);
		const anchor = new HoverRangeAnchor(0, new Range(1, 7, 1, 8), undefined, undefined);
		const parts = participant.computeSync(anchor);
		const rendered = disposables.add(participant.renderHoverParts(context, parts));
		return { model, context, parts, participant, anchor, readOnly, undoStop, rendered, switchModel: () => { currentModel = null; } };
	}

	test('appears over the call and preserves hover through repeated direct edits', () => {
		const { model, context, parts, undoStop } = setup();
		expect(parts).toHaveLength(1);
		expect(widget.change?.({ datetime: '2026-11-18 13:45:00', timezone: 'America/New_York' })).toBe(true);
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'Europe/Paris' })).toBe(true);
		expect(model.getValue()).toBe('x <- as.POSIXct("2026-11-19 14:30:00", tz = "Europe/Paris")');
		expect(context.hide).not.toHaveBeenCalled();
		expect(undoStop).toHaveBeenCalledTimes(4);
	});

	test('retains the updated call when theme tokenization causes a re-render', () => {
		const { model, context, parts, participant, rendered } = setup();
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'America/New_York' })).toBe(true);
		rendered.dispose();
		disposables.add(participant.renderHoverParts(context, parts));
		expect(widget.change?.({ datetime: '2026-11-20 14:30:00', timezone: 'UTC' })).toBe(true);
		expect(model.getValue()).toBe('x <- as.POSIXct("2026-11-20 14:30:00", tz = "UTC")');
		expect(context.hide).not.toHaveBeenCalled();
	});

	test('expands an empty multiline call and keeps later edits attached', () => {
		const { model, context } = setup('x <- as.POSIXct(\n)');
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'UTC' })).toBe(true);
		expect(widget.change?.({ datetime: '2026-11-20 14:30:00', timezone: 'Europe/Paris' })).toBe(true);
		expect(model.getValue()).toContain('2026-11-20 14:30:00');
		expect(model.getValue()).toContain('Europe/Paris');
		expect(context.hide).not.toHaveBeenCalled();
	});

	test('rejects invalid values without touching the document', () => {
		const { model, undoStop } = setup();
		const before = model.getValue();
		expect(widget.change?.({ datetime: '2026-02-31 14:30:00', timezone: 'UTC' })).toBe(false);
		expect(model.getValue()).toBe(before);
		expect(undoStop).not.toHaveBeenCalled();
	});

	test('external edits invalidate even when the original call text is unchanged', () => {
		const { model, context } = setup();
		model.applyEdits([{ range: new Range(1, 1, 1, 1), text: '# ' }]);
		const before = model.getValue();
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'UTC' })).toBe(false);
		expect(model.getValue()).toBe(before);
		expect(context.hide).toHaveBeenCalled();
	});

	test('refuses an edit after editor model replacement', () => {
		const { model, switchModel } = setup();
		const before = model.getValue();
		switchModel();
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'UTC' })).toBe(false);
		expect(model.getValue()).toBe(before);
	});

	test('read-only changes prevent writes and further hover creation', () => {
		const { model, participant, anchor, readOnly } = setup();
		const before = model.getValue();
		readOnly.mockReturnValue(true);
		expect(participant.computeSync(anchor)).toEqual([]);
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'UTC' })).toBe(false);
		expect(model.getValue()).toBe(before);
	});

	test('does not edit after switching the document language', () => {
		const { model } = setup();
		const before = model.getValue();
		model.setLanguage('plaintext');
		expect(widget.change?.({ datetime: '2026-11-19 14:30:00', timezone: 'UTC' })).toBe(false);
		expect(model.getValue()).toBe(before);
	});

	test('does not show for other languages or dynamic calls', () => {
		expect(setup('x <- as.POSIXct("2026-11-17")', 'plaintext').parts).toEqual([]);
		expect(setup('x <- as.POSIXct(variable)').parts).toEqual([]);
	});
});
