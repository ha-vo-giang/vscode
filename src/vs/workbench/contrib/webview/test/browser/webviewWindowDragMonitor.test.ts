/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWebview } from '../../browser/webview.js';
import { IDragPosition, shouldAcceptDragWithoutShift, WebviewWindowDragMonitor } from '../../browser/webviewWindowDragMonitor.js';

suite('WebviewWindowDragMonitor (agent-team)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const rect = { left: 100, top: 50, right: 300, bottom: 250 };

	test('accepts drags without Shift only for opted-in webviews under the pointer', () => {
		assert.strictEqual(shouldAcceptDragWithoutShift(true, rect, { x: 150, y: 100 }), true);
		assert.strictEqual(shouldAcceptDragWithoutShift(false, rect, { x: 150, y: 100 }), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(undefined, rect, { x: 150, y: 100 }), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(true, rect, { x: 50, y: 100 }), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(true, rect, { x: 300, y: 100 }), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(true, rect, undefined), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(true, undefined, { x: 150, y: 100 }), false);
		assert.strictEqual(shouldAcceptDragWithoutShift(true, { left: 0, top: 0, right: 0, bottom: 0 }, { x: 0, y: 0 }), false);
	});

	function createMonitor() {
		const calls: Array<{ type: 'start'; position: IDragPosition | undefined } | { type: 'end' }> = [];
		const webview = {
			windowDidDragStart: (position?: IDragPosition) => calls.push({ type: 'start', position }),
			windowDidDragEnd: () => calls.push({ type: 'end' }),
		} as unknown as IWebview;
		store.add(new WebviewWindowDragMonitor(mainWindow, () => webview));
		return calls;
	}

	test('passes the pointer position of dragover to the webview', () => {
		const calls = createMonitor();
		mainWindow.dispatchEvent(new DragEvent('dragover', { clientX: 150, clientY: 100 }));
		assert.deepStrictEqual(calls, [{ type: 'start', position: { x: 150, y: 100 } }]);
	});

	test('Shift still unblocks every webview', () => {
		const calls = createMonitor();
		mainWindow.dispatchEvent(new DragEvent('dragover', { clientX: 150, clientY: 100, shiftKey: true }));
		mainWindow.dispatchEvent(new DragEvent('drag', { clientX: 150, clientY: 100, shiftKey: true }));
		assert.deepStrictEqual(calls, [{ type: 'end' }, { type: 'end' }]);
	});

	test('ignores source drag events without a pointer position', () => {
		const calls = createMonitor();
		mainWindow.dispatchEvent(new DragEvent('drag', { clientX: 0, clientY: 0 }));
		mainWindow.dispatchEvent(new DragEvent('drag', { clientX: 20, clientY: 30 }));
		assert.deepStrictEqual(calls, [{ type: 'start', position: { x: 20, y: 30 } }]);
	});
});
