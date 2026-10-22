/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { errorHandler, setUnexpectedErrorHandler } from '../../../../../../base/common/errors.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { ChatImplicitContextContribution, ChatImplicitContexts } from '../../../browser/attachments/chatImplicitContext.js';
import { IChatWidget, IChatWidgetService } from '../../../browser/chat.js';
import { IChatContextService } from '../../../browser/contextContrib/chatContextService.js';
import { ChatInputPart } from '../../../browser/widget/input/chatInputPart.js';
import { IChatService } from '../../../common/chatService/chatService.js';
import { ChatAgentLocation } from '../../../common/constants.js';
import { IChatEditingService } from '../../../common/editing/chatEditingService.js';
import { ILanguageModelIgnoredFilesService } from '../../../common/ignoredFiles.js';

suite('ChatImplicitContextContribution lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/current.ts');

	function createHarness() {
		const contexts = store.add(new ChatImplicitContexts());
		let input: ChatInputPart | undefined = upcastPartial<ChatInputPart>({ implicitContext: contexts });
		let active = false;
		let ignored = async () => false;
		let resolveContext: IChatContextService['contextForResource'] = async () => undefined;
		const submit = store.add(new Emitter<{ chatSessionResource: URI }>());
		const widget = upcastPartial<IChatWidget>({
			get input() { return input!; },
			location: ChatAgentLocation.Chat,
			viewModel: upcastPartial<NonNullable<IChatWidget['viewModel']>>({ getItems: () => [] }),
		});
		const editor = upcastPartial<ICodeEditor>({
			getModel: () => upcastPartial<ITextModel>({ uri: resource, getLanguageId: () => 'typescript' }),
			getSelection: () => null,
		});
		const configuration = new TestConfigurationService({ chat: { implicitContext: { enabled: { [ChatAgentLocation.Chat]: 'always' }, suggestedContext: true } } });
		const contribution = store.add(new ChatImplicitContextContribution(
			upcastPartial<ICodeEditorService>({ getActiveCodeEditor: () => active ? editor : null }),
			upcastPartial<IEditorService>({ onDidActiveEditorChange: Event.None, getVisibleTextEditorControls: () => [], activeEditor: {} as IEditorService['activeEditor'] }),
			upcastPartial<IChatWidgetService>({ onDidAddWidget: Event.None, getWidgetsByLocations: () => [], getWidgetBySessionResource: () => widget }),
			upcastPartial<IChatService>({ onDidSubmitRequest: submit.event }),
			upcastPartial<IChatEditingService>({ editingSessionsObs: observableValue('editingSessions', []) }),
			configuration,
			upcastPartial<ILanguageModelIgnoredFilesService>({ fileIsIgnored: () => ignored() }),
			upcastPartial<IChatContextService>({ contextForResource: (...args) => resolveContext(...args) }),
		));
		active = true;
		return {
			contexts,
			update: () => contribution['updateImplicitContext'](widget),
			disposeContribution: () => contribution.dispose(),
			cancel: () => contribution['_currentCancelTokenSource'].value?.cancel(),
			disposeInput: () => { input = undefined; },
			setContextResolver: (resolver: typeof resolveContext) => { resolveContext = resolver; },
			setIgnored: (resolver: typeof ignored) => { ignored = resolver; },
			submit: () => submit.fire({ chatSessionResource: URI.parse('test:session') }),
		};
	}

	test('live input retains resource context', async () => {
		const h = createHarness();
		await h.update();
		assert.deepStrictEqual(h.contexts.getUris(), [resource]);
	});

	test('input disposed while provider context resolves completes harmlessly', async () => {
		const h = createHarness();
		const pending = new DeferredPromise<undefined>();
		h.setContextResolver(() => pending.p);
		const update = h.update();
		h.disposeInput();
		await pending.complete(undefined);
		await update;
		assert.strictEqual(h.contexts.hasValue, false);
	});

	test('input disposed while ignored-file check resolves completes harmlessly', async () => {
		const h = createHarness();
		const pending = new DeferredPromise<boolean>();
		const entered = new DeferredPromise<void>();
		h.setIgnored(() => { entered.complete(); return pending.p; });
		const update = h.update();
		await entered.p;
		h.disposeInput();
		await pending.complete(false);
		await update;
		assert.strictEqual(h.contexts.hasValue, false);
	});

	test('superseded resolution cannot overwrite the newer live update', async () => {
		const h = createHarness();
		const pending = new DeferredPromise<undefined>();
		h.setContextResolver(() => pending.p);
		const stale = h.update();
		h.setContextResolver(async () => undefined);
		h.setIgnored(async () => true);
		await h.update();
		assert.strictEqual(h.contexts.hasValue, false);
		h.setIgnored(async () => false);
		await pending.complete(undefined);
		await stale;
		assert.strictEqual(h.contexts.hasValue, false);
		await h.update();
		assert.deepStrictEqual(h.contexts.getUris(), [resource]);
	});

	test('canceled resolution leaves live input unchanged', async () => {
		const h = createHarness();
		const pending = new DeferredPromise<undefined>();
		h.setContextResolver(() => pending.p);
		const update = h.update();
		h.cancel();
		await pending.complete(undefined);
		await update;
		assert.strictEqual(h.contexts.hasValue, false);
	});

	test('contribution disposal invalidates pending resolution', async () => {
		const h = createHarness();
		const pending = new DeferredPromise<undefined>();
		h.setContextResolver(() => pending.p);
		const update = h.update();
		h.disposeContribution();
		await pending.complete(undefined);
		await update;
		assert.strictEqual(h.contexts.hasValue, false);
	});

	test('ignored resources remain excluded', async () => {
		const h = createHarness();
		h.setIgnored(async () => true);
		await h.update();
		assert.strictEqual(h.contexts.hasValue, false);
	});

	test('submit tolerates a disposed input', () => {
		const h = createHarness();
		h.disposeInput();
		const errors: unknown[] = [];
		const original = errorHandler.getUnexpectedErrorHandler();
		setUnexpectedErrorHandler(error => errors.push(error));
		try {
			h.submit();
			assert.deepStrictEqual(errors, []);
		} finally {
			setUnexpectedErrorHandler(original);
		}
	});
});
