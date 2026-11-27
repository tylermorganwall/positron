/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { HoverParticipantRegistry } from '../../hover/browser/hoverTypes.js';
import { PosixClockHoverParticipant } from './posixClockHoverParticipant.js';

HoverParticipantRegistry.register(PosixClockHoverParticipant);
