/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityOutputStream.css';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { ActivityItemStream } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

// ActivityOutputStreamProps interface.
export interface ActivityOutputStreamProps {
	activityItemStream: ActivityItemStream;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ActivityOutputStream component.
 * @param props An ActivityOutputStreamProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputStream = (props: ActivityOutputStreamProps) => {
	// Render.
	return (
		<ConsoleOutputLines
			outputLines={props.activityItemStream.outputLines}
			linkContext={{
				sessionId: props.positronConsoleInstance.sessionMetadata.sessionId,
				languageId: props.positronConsoleInstance.runtimeMetadata.languageId,
			}}
		/>
	);
};
