/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Range } from '../../../common/core/range.js';
import { HoverAnchor, HoverAnchorType, IEditorHoverParticipant, IEditorHoverRenderContext, IHoverPart, IRenderedHoverParts, RenderedHoverParts } from '../../hover/browser/hoverTypes.js';
import { findPosixClockCall, PosixClockCall, posixClockEdits } from '../common/posixClock.js';
import { PosixClockWidget } from './posixClockWidget.js';

/** An editable R date-time call in the ordinary editor hover. */
class PosixClockHover implements IHoverPart {
	readonly forceShowAtRange = true;

	constructor(
		readonly owner: PosixClockHoverParticipant,
		public range: Range,
		public call: PosixClockCall,
	) { }

	isValidForHoverAnchor(anchor: HoverAnchor): boolean {
		return anchor.type === HoverAnchorType.Range && this.range.containsRange(anchor.range);
	}
}

/** Hosts the native widget; no extension command or webview is involved. */
export class PosixClockHoverParticipant implements IEditorHoverParticipant<PosixClockHover> {
	readonly hoverOrdinal = 2;
	readonly hideCopyButton = true;

	constructor(private readonly editor: ICodeEditor) { }

	computeSync(anchor: HoverAnchor): PosixClockHover[] {
		const model = this.editor.getModel();
		if (!model || model.getLanguageId() !== 'r' || this.editor.getOption(EditorOption.readOnly) || anchor.type !== HoverAnchorType.Range) {
			return [];
		}
		const call = findPosixClockCall(model.getValue(), model.getOffsetAt(anchor.range.getStartPosition()));
		if (!call) {
			return [];
		}
		const range = Range.fromPositions(model.getPositionAt(call.start), model.getPositionAt(call.end));
		return [new PosixClockHover(this, range, call)];
	}

	renderHoverParts(context: IEditorHoverRenderContext, hoverParts: PosixClockHover[]): IRenderedHoverParts<PosixClockHover> {
		const model = this.editor.getModel();
		const part = hoverParts[0];
		if (!model || !part) {
			return new RenderedHoverParts([]);
		}
		const disposables = new DisposableStore();
		const container = context.fragment.ownerDocument.createElement('div');
		context.fragment.appendChild(container);
		let call = part.call;
		let editing = false;
		let invalidated = false;
		const widget = disposables.add(new PosixClockWidget(container, call.value, value => {
			// Never write to a different editor model, an obsolete range, or a read-only editor.
			if (invalidated || this.editor.getModel() !== model || model.getLanguageId() !== 'r' || this.editor.getOption(EditorOption.readOnly) || model.getValue().slice(call.start, call.end) !== call.source) {
				context.hide();
				return false;
			}
			const changes = posixClockEdits(call, value);
			if (!changes) {
				return false;
			}
			if (changes.length === 0) {
				return true;
			}
			const edits = changes.map(change => ({
				range: Range.fromPositions(model.getPositionAt(change.start), model.getPositionAt(change.end)),
				text: change.text,
			}));
			editing = true;
			try {
				// Every deliberate widget change is independently undoable, without joining typing.
				this.editor.pushUndoStop();
				if (!this.editor.executeEdits('positron.posixClock', edits)) {
					return false;
				}
				this.editor.pushUndoStop();
				const updated = findPosixClockCall(model.getValue(), call.start);
				if (!updated) {
					invalidated = true;
					context.hide();
					return false;
				}
				call = updated;
				part.call = updated;
				part.range = Range.fromPositions(model.getPositionAt(call.start), model.getPositionAt(call.end));
				return true;
			} finally {
				editing = false;
			}
		}));
		disposables.add(this.editor.onDidChangeModelContent(() => {
			if (!editing) {
				invalidated = true;
				context.hide();
			}
		}));
		disposables.add(this.editor.onDidChangeModel(() => {
			invalidated = true;
			context.hide();
		}));
		context.setMinimumDimensions(new Dimension(464, 190));
		return new RenderedHoverParts([{
			hoverPart: part,
			hoverElement: widget.domNode,
			dispose: () => disposables.dispose(),
		}]);
	}

	getAccessibleContent(): string {
		return localize('posixClockHover', "Date, time, and time zone picker. Changes update the R call immediately.");
	}
}
