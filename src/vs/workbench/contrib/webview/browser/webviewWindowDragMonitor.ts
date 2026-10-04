/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWebview } from './webview.js';

export interface IDragPosition {
	readonly x: number;
	readonly y: number;
}

export interface IDragRect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/**
 * agent-team: whether a window drag at `position` should reach the webview content instead of
 * being blocked. Only webviews that opt in with `enableDropWithoutShift` do so, and only while the
 * pointer is over them.
 */
export function shouldAcceptDragWithoutShift(enableDropWithoutShift: boolean | undefined, rect: IDragRect | undefined, position: IDragPosition | undefined): boolean {
	if (!enableDropWithoutShift || !rect || !position) {
		return false;
	}
	if (rect.right <= rect.left || rect.bottom <= rect.top) {
		return false;
	}
	return position.x >= rect.left && position.x < rect.right
		&& position.y >= rect.top && position.y < rect.bottom;
}

/**
 * Allows webviews to monitor when an element in the VS Code editor is being dragged/dropped.
 *
 * This is required since webview end up eating the drag event. VS Code needs to see this
 * event so it can handle editor element drag drop.
 */
export class WebviewWindowDragMonitor extends Disposable {
	constructor(targetWindow: CodeWindow, getWebview: () => IWebview | undefined) {
		super();

		const onDragStart = (event?: DragEvent) => {
			getWebview()?.windowDidDragStart(event ? { x: event.clientX, y: event.clientY } : undefined);
		};

		const onDragEnd = () => {
			getWebview()?.windowDidDragEnd();
		};

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_START, () => {
			onDragStart();
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_END, onDragEnd));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.MOUSE_MOVE, currentEvent => {
			if (currentEvent.buttons === 0) {
				onDragEnd();
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG, (event) => {
			if (event.clientX === 0 && event.clientY === 0 && !event.shiftKey) {
				// agent-team: Chromium reports (0, 0) on some drag events of the source; dragover has the real position.
				return;
			}
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart(event);
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_OVER, (event) => {
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart(event);
			}
		}));

	}
}
