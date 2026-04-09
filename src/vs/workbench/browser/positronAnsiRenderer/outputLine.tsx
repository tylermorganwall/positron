/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './outputLine.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { OutputRun } from './outputRun.js';
import { ANSIHyperlink, ANSIOutputLine, ANSIOutputRun } from '../../../base/common/ansiOutput.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { URI } from '../../../base/common/uri.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';

export interface OutputLineLinkContext {
	readonly sessionId: string;
	readonly languageId: string;
	readonly outputId?: string;
}

// OutputLineProps interface.
export interface OutputLineProps {
	readonly outputLine: ANSIOutputLine;
	readonly linkContext?: OutputLineLinkContext;
}

interface IResolvedLink {
	readonly startIndex: number;
	readonly length: number;
	readonly target: URI;
	readonly line?: number;
	readonly column?: number;
}

const toHyperlink = (link: IResolvedLink): ANSIHyperlink => {
	const params = new Map<string, string>();
	if (typeof link.line === 'number') {
		params.set('line', String(link.line));
	}
	if (typeof link.column === 'number') {
		params.set('col', String(link.column));
	}

	return {
		url: link.target.toString(),
		params: params.size ? params : undefined,
	};
};

const applyLinksToOutputLine = (
	outputLine: ANSIOutputLine,
	links: readonly IResolvedLink[]
): ANSIOutputLine => {
	if (!links.length) {
		return outputLine;
	}

	const sorted = [...links]
		.filter(link => link.length > 0)
		.map(link => ({
			...link,
			endIndex: link.startIndex + link.length,
		}))
		.sort((left, right) => left.startIndex - right.startIndex || right.length - left.length);

	const outputRuns: ANSIOutputRun[] = [];
	let absoluteOffset = 0;
	let linkIndex = 0;

	for (const run of outputLine.outputRuns) {
		if (!run.text.length) {
			continue;
		}

		if (run.hyperlink) {
			outputRuns.push(run);
			absoluteOffset += run.text.length;
			continue;
		}

		let localOffset = 0;
		const runEndAbsolute = absoluteOffset + run.text.length;

		while (localOffset < run.text.length) {
			const absoluteCursor = absoluteOffset + localOffset;

			while (linkIndex < sorted.length && sorted[linkIndex].endIndex <= absoluteCursor) {
				linkIndex++;
			}

			const activeLink = sorted[linkIndex];
			const inActiveLink = !!activeLink && activeLink.startIndex <= absoluteCursor && absoluteCursor < activeLink.endIndex;

			if (inActiveLink) {
				const take = Math.min(runEndAbsolute, activeLink.endIndex) - absoluteCursor;
				outputRuns.push({
					...run,
					id: `${run.id}:${absoluteCursor}`,
					text: run.text.slice(localOffset, localOffset + take),
					hyperlink: toHyperlink(activeLink),
				});
				localOffset += take;
				continue;
			}

			const nextBoundary = activeLink ? Math.min(runEndAbsolute, activeLink.startIndex) : runEndAbsolute;
			const take = nextBoundary - absoluteCursor;
			outputRuns.push({
				...run,
				id: `${run.id}:${absoluteCursor}`,
				text: run.text.slice(localOffset, localOffset + take),
			});
			localOffset += take;
		}

		absoluteOffset = runEndAbsolute;
	}

	return {
		...outputLine,
		outputRuns,
	};
};

/**
 * OutputLine component.
 * @param props A OutputLineProps that contains the component properties.
 * @returns The rendered component.
 */
export const OutputLine = (props: OutputLineProps) => {
	const services = usePositronReactServicesContext();
	const [resolvedLinks, setResolvedLinks] = useState<readonly IResolvedLink[]>([]);
	const lastLineKeyRef = useRef<string | null>(null);

	const lineText = useMemo(
		() => props.outputLine.outputRuns.map(run => run.text).join(''),
		[props.outputLine]
	);

	const lineKey = useMemo(() => JSON.stringify({
		sessionId: props.linkContext?.sessionId,
		languageId: props.linkContext?.languageId,
		outputId: props.linkContext?.outputId,
		line: lineText,
	}), [
		lineText,
		props.linkContext?.languageId,
		props.linkContext?.outputId,
		props.linkContext?.sessionId,
	]);

	const renderedOutputLine = useMemo(() => {
		return resolvedLinks.length
			? applyLinksToOutputLine(props.outputLine, resolvedLinks)
			: props.outputLine;
	}, [props.outputLine, resolvedLinks]);

	useEffect(() => {
		const keyChanged = lastLineKeyRef.current !== lineKey;
		lastLineKeyRef.current = lineKey;

		if (keyChanged) {
			setResolvedLinks([]);
		}

		if (!props.linkContext || !lineText.length) {
			return;
		}

		const cts = new CancellationTokenSource();
		const requestKey = lineKey;
		void services.positronConsoleService.provideConsoleLinks({
			sessionId: props.linkContext.sessionId,
			languageId: props.linkContext.languageId,
			outputId: props.linkContext.outputId,
			line: lineText,
		}, cts.token).then(links => {
			if (cts.token.isCancellationRequested || lastLineKeyRef.current !== requestKey) {
				return;
			}

			setResolvedLinks(links);
		}).catch(error => {
			services.logService.error('Failed to resolve console links.', error);
		});

		return () => {
			cts.dispose(true);
		};
	}, [
		lineKey,
		lineText,
		props.linkContext?.languageId,
		props.linkContext?.outputId,
		props.linkContext?.sessionId,
		services,
	]);

	// If there are no output runs, render a line break for an empty line.
	if (!renderedOutputLine.outputRuns.length) {
		return <br />;
	}

	// Render.
	return (
		<div>
			{renderedOutputLine.outputRuns.map(outputRun =>
				<OutputRun key={outputRun.id} outputRun={outputRun} />
			)}
		</div>
	);
};
