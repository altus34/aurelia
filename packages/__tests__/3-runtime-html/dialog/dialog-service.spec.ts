import { noop } from '@aurelia/kernel';
import {
  IDialogService,
  IDialogSettings,
  IDialogGlobalSettings,
  DialogConfiguration,
  DialogDefaultConfiguration,
  customElement,
  IDialogCancelError,
  DialogDeactivationStatuses,
  IDialogAnimator,
  IDialogDom,
  IDialogController,
  INode,
  DialogController,
  DefaultDialogDom,
} from '@aurelia/runtime-html';
import {
  createFixture,
  assert,
  createSpy,
} from '@aurelia/testing';

describe('3-runtime-html/dialog/dialog-service.spec.ts', function () {
  describe('configuration', function () {
    it('throws on empty configuration', async function () {
      let error: unknown = void 0;
      try {
        const { startPromise } = createFixture('', class App { }, [DialogConfiguration]);
        await startPromise;
      } catch (err) {
        error = err;
      }
      assert.notStrictEqual(error, void 0);
      assert.includes((error as Error).message, 'Invalid dialog configuration.');
    });

    it('throws when customize without any implementation', async function () {
      let error: unknown = void 0;
      try {
        const { startPromise } = createFixture('', class App { }, [DialogConfiguration.customize(noop, [])]);
        await startPromise;
      } catch (err) {
        error = err;
      }
      assert.notStrictEqual(error, void 0);
      assert.includes((error as Error).message, 'Attempted to jitRegister an interface: IDialogGlobalSettings');
    });
  });

  describe('.open()', function () {
    const testCases: IDialogServiceTestCase[] = [
      {
        title: 'throws on invalid configuration',
        afterStarted: async (_, dialogService) => {
          let error: IDialogCancelError<unknown>;
          await dialogService.open({}).catch(err => error = err);
          assert.strictEqual(error.message, 'Invalid Dialog Settings. You must provide "component", "template" or both.');
        }
      },
      {
        title: 'works with @inject(IDialogController, IDialogDom, INode)',
        afterStarted: async (_, dialogService) => {
          await dialogService.open({
            component: () => class {
              public static inject = [IDialogController, IDialogDom, INode];
              public constructor(
                controller: DialogController,
                dialogDom: DefaultDialogDom,
                node: Element
              ) {
                assert.strictEqual(controller['dom'], dialogDom);
                assert.strictEqual(dialogDom.contentHost, node);
              }
            }
          });
        }
      },
      {
        title: 'hasOpenDialog with 1 dialog',
        afterStarted: async (_, dialogService) => {
          assert.strictEqual(dialogService.hasOpenDialog, false);
          const { controller } = await dialogService.open({ template: '' });
          assert.strictEqual(dialogService.hasOpenDialog, true);
          void controller.ok();
          await controller.closed;
          assert.strictEqual(dialogService.hasOpenDialog, false);
        }
      },
      {
        title: 'hasOpenDialog with more than 1 dialog',
        afterStarted: async (_, dialogService) => {
          assert.strictEqual(dialogService.hasOpenDialog, false);
          const { controller: controller1 } = await dialogService.open({ template: '' });
          assert.strictEqual(dialogService.hasOpenDialog, true);
          const { controller: controller2 } = await dialogService.open({ template: '' });
          assert.strictEqual(dialogService.hasOpenDialog, true);
          void controller1.ok();
          await controller1.closed;
          assert.strictEqual(dialogService.hasOpenDialog, true);
          void controller2.ok();
          await controller2.closed;
          assert.strictEqual(dialogService.hasOpenDialog, false);
        }
      },
      {
        title: 'should create new settings by merging the default settings and the provided ones',
        afterStarted: async ({ ctx }, dialogService) => {
          const overrideSettings: IDialogSettings = {
            rejectOnCancel: true,
            lock: true,
            keyboard: 'Escape',
            overlayDismiss: true,
          };
          const { controller } = await dialogService.open({
            ...overrideSettings,
            component: () => Object.create(null),
          });
          const expectedSettings = { ...ctx.container.get(IDialogGlobalSettings), ...overrideSettings };
          const actualSettings = { ...controller.settings };
          delete actualSettings.component;
          assert.deepStrictEqual(actualSettings, expectedSettings);
        }
      },
      {
        title: 'should not modify the default settings',
        afterStarted: async ({ ctx }, dialogService) => {
          const overrideSettings = { component: () => ({}), model: 'model data' };
          const expectedSettings = { ...ctx.container.get(IDialogGlobalSettings) };
          await dialogService.open(overrideSettings);
          const actualSettings = { ...ctx.container.get(IDialogGlobalSettings) };
          assert.deepStrictEqual(actualSettings, expectedSettings);
        }
      },
      ...[null, undefined, true].map<IDialogServiceTestCase>(canActivate => ({
        title: `invokes & resolves with [canActivate: ${canActivate}]`,
        afterStarted: async function ({ ctx }, dialogService) {
          let canActivateCallCount = 0;
          @customElement({
            name: 'test',
            template: 'hello dialog',
          })
          class TestElement {
            public canActivate() {
              canActivateCallCount++;
              return canActivate;
            }
          }

          const result = await dialogService.open({
            component: () => TestElement
          });
          assert.strictEqual(result.wasCancelled, false);
          assert.strictEqual(canActivateCallCount, 1);
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), 'hello dialog');
        },
        afterTornDown: ({ ctx }) => {
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), null);
        }
      })),
      {
        title: 'resolves to "IOpenDialogResult" with [canActivate: false + rejectOnCancel: false]',
        afterStarted: async ({ ctx }, dialogService) => {
          let canActivateCallCount = 0;
          const result = await dialogService.open({
            rejectOnCancel: false,
            template: 'hello world',
            component: () => class TestElement {
              public canActivate() {
                canActivateCallCount++;
                return false;
              }
            }
          });
          assert.strictEqual(result.wasCancelled, true);
          assert.strictEqual(canActivateCallCount, 1);
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), null);
        }
      },
      {
        title: 'gets rejected with "IDialogCancelError" with [canActivate: false + rejectOnCancel: true]',
        afterStarted: async ({ ctx }, dialogService) => {
          let canActivateCallCount = 0;
          let error: IDialogCancelError<unknown>;
          await dialogService.open({
            rejectOnCancel: true,
            template: 'hello world',
            component: () => class TestElement {
              public canActivate() {
                canActivateCallCount++;
                return false;
              }
            }
          }).catch(err => error = err);

          assert.notStrictEqual(error, undefined);
          assert.strictEqual(error.wasCancelled, true);
          assert.strictEqual(error.message, 'Dialog activation rejected');
          assert.strictEqual(canActivateCallCount, 1);
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), null);
        }
      },
      {
        title: 'propagates errors from canActivate',
        afterStarted: async (_, dialogService) => {
          const expectedError = new Error('Expected error.');
          let canActivateCallCount = 0;
          let error: IDialogCancelError<unknown>;
          await dialogService.open({
            template: 'hello world',
            component: () => class TestElement {
              public canActivate() {
                if (canActivateCallCount === 0) {
                  canActivateCallCount++;
                  throw expectedError;
                }
              }
            }
          }).catch(err => error = err);
          assert.strictEqual(dialogService.count, 0);
          assert.strictEqual(error, expectedError);
          assert.strictEqual(canActivateCallCount, 1);
          assert.strictEqual(dialogService.count, 0);
        }
      },
      ...[null, undefined, true].map<IDialogServiceTestCase>(canDeactivate => ({
        title: `invokes & resolves with [canDeactivate: ${canDeactivate}]`,
        afterStarted: async function ({ ctx }, dialogService) {
          let canActivateCallCount = 0;
          @customElement({
            name: 'test',
            template: 'hello dialog',
          })
          class TestElement {
            public canDeactivate() {
              canActivateCallCount++;
              return canDeactivate;
            }
          }

          const result = await dialogService.open({
            component: () => TestElement
          });
          assert.strictEqual(result.wasCancelled, false);
          assert.strictEqual(canActivateCallCount, 0);
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), 'hello dialog');

          void result.controller.ok();
          await result.controller.closed;
          assert.strictEqual(canActivateCallCount, 1);
          assert.html.textContent(ctx.doc.querySelector('au-dialog-container'), null);
        }
      })),
      {
        title: 'resolves: "IDialogCloseResult" when: .ok()',
        afterStarted: async (_, dialogService) => {
          const { controller } = await dialogService.open({ template: '' });
          const expectedValue = 'expected ok output';
          await controller.ok(expectedValue);
          const result = await controller.closed;
          assert.strictEqual(result.status, DialogDeactivationStatuses.Ok);
          assert.strictEqual(result.value, expectedValue);
        }
      },
      {
        title: 'resolves: "IDialogCloseResult" when: .cancel() + rejectOnCancel: false',
        afterStarted: async (_, dialogService) => {
          const { controller } = await dialogService.open({ template: '' });
          const expectedOutput = 'expected cancel output';
          let error: IDialogCancelError<unknown>;
          let errorCaughtCount = 0;
          void controller.cancel(expectedOutput);
          const result = await controller.closed.catch(err => {
            errorCaughtCount++;
            error = err;
            return { status: DialogDeactivationStatuses.Error };
          });
          assert.strictEqual(error, undefined);
          assert.strictEqual(errorCaughtCount, 0);
          assert.strictEqual(result.status, DialogDeactivationStatuses.Cancel);
        }
      },
      {
        title: 'rejects: "IDialogCancelError" when: .cancel() + rejectOnCancel: true',
        afterStarted: async (_, dialogService) => {
          const { controller } = await dialogService.open({ template: '', rejectOnCancel: true });
          const expectedValue = 'expected cancel error output';
          let error: IDialogCancelError<unknown>;
          let errorCaughtCount = 0;
          void controller.cancel(expectedValue);
          await controller.closed.catch(err => {
            errorCaughtCount++;
            error = err;
            return { status: DialogDeactivationStatuses.Ok };
          });
          assert.notStrictEqual(error, undefined);
          assert.strictEqual(errorCaughtCount, 1);
          assert.strictEqual(error.wasCancelled, true);
          assert.strictEqual(error.value, expectedValue);
        }
      },
      {
        title: 'gets rejected with provided error when ".error" closed',
        afterStarted: async (_, dialogService) => {
          const { controller } = await dialogService.open({ template: '' });
          const expectedError = new Error('expected test error');
          let error: IDialogCancelError<unknown>;
          let errorCaughtCount = 0;
          void controller.error(expectedError);
          await controller.closed.catch(err => {
            errorCaughtCount++;
            error = err;
          });
          assert.deepStrictEqual(error, Object.assign(new Error(), {
            wasCancelled: false,
            value: expectedError
          }));
          assert.strictEqual(errorCaughtCount, 1);
        }
      },
      {
        title: '.closeAll() with 1 dialog',
        afterStarted: async (_, dialogService) => {
          await dialogService.open({ template: '' });
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 1);
          const unclosedController = await dialogService.closeAll();
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);
          assert.deepStrictEqual(unclosedController, []);
        }
      },
      {
        title: '.closeAll() with more than 1 dialog',
        afterStarted: async (_, dialogService) => {
          await Promise.all([
            dialogService.open({ template: '' }),
            dialogService.open({ template: '' }),
            dialogService.open({ template: '' }),
          ]);
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 3);
          const unclosedController = await dialogService.closeAll();
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);
          assert.deepStrictEqual(unclosedController, []);
        }
      },
      {
        title: '.closeAll() with one dialog open',
        afterStarted: async (_, dialogService) => {
          await Promise.all([
            dialogService.open({ template: '' }),
            dialogService.open({ template: '' }),
            dialogService.open({ component: () => class App {
              private deactivateCount = 0;
              public canDeactivate() {
                // only deactivate when called 2nd time
                return this.deactivateCount++ > 0;
              }
            }, template: '' }),
          ]);
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 3);
          let unclosedController = await dialogService.closeAll();
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 1);
          assert.strictEqual(unclosedController.length, 1);
          unclosedController = await dialogService.closeAll();
          assert.strictEqual(dialogService.count, 0);
          assert.deepStrictEqual(unclosedController, []);
        }
      },
      {
        title: 'invokes animator',
        afterStarted: async ({ ctx }, dialogService) => {
          let attachingCallCount = 0;
          let detachingCallCount = 0;
          const dialogAnimator = ctx.container.get(IDialogAnimator);
          dialogAnimator.attaching = (fn => function (dom: IDialogDom, animation: unknown) {
            attachingCallCount++;
            return fn.call(this, dom, animation);
          })(dialogAnimator.attaching);
          dialogAnimator.detaching = (fn => function (dom: IDialogDom, animation: unknown) {
            detachingCallCount++;
            return fn.call(this, dom, animation);
          })(dialogAnimator.detaching);

          const { controller } = await dialogService.open({ template: '' });
          assert.strictEqual(attachingCallCount, 1);

          void controller.ok();
          await controller.closed;
          assert.strictEqual(detachingCallCount, 1);
        }
      },
      {
        title: 'closes dialog when clicking on overlay with lock: false',
        afterStarted: async ({ ctx }, dialogService) => {
          const { controller } = await dialogService.open({ template: 'Hello world', lock: false });
          assert.strictEqual(ctx.doc.querySelector('au-dialog-container').textContent, 'Hello world');
          const overlay = ctx.doc.querySelector('au-dialog-overlay') as HTMLElement;
          overlay.click();
          await Promise.any([
            controller.closed,
            new Promise(r => setTimeout(r, 50)),
          ]);
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);
        }
      },
      {
        title: 'does not close dialog when clicking on overlay with lock: true',
        afterStarted: async ({ ctx }, dialogService) => {
          const { controller } = await dialogService.open({ template: 'Hello world' });
          assert.strictEqual(controller.settings.lock, true);
          assert.strictEqual(ctx.doc.querySelector('au-dialog-container').textContent, 'Hello world');
          const overlay = ctx.doc.querySelector('au-dialog-overlay') as HTMLElement;
          overlay.click();
          await Promise.any([
            controller.closed,
            new Promise(r => setTimeout(r, 50)),
          ]);
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 1);
        }
      },
      {
        title: 'does not close dialog when clicking inside dialog host with lock: false',
        afterStarted: async ({ ctx }, dialogService) => {
          const { controller } = await dialogService.open({ template: 'Hello world', lock: false });
          assert.strictEqual(ctx.doc.querySelector('au-dialog-container').textContent, 'Hello world');
          const host = ctx.doc.querySelector('div') as HTMLElement;
          host.click();
          await Promise.any([
            controller.closed,
            new Promise(r => setTimeout(r, 50)),
          ]);
          assert.strictEqual(dialogService.hasOpenDialog, true);
          assert.strictEqual(dialogService.count, 1);
        }
      },
      {
        title: 'closes the latest open dialog when hitting ESC key',
        afterStarted: async ({ ctx }, dialogService) => {
          const [{ controller: controller1 }, { controller: controller2 }] = await Promise.all([
            dialogService.open({ template: 'Hello world', lock: false }),
            dialogService.open({ template: 'Hello world', lock: false })
          ]);
          const cancelSpy1 = createSpy(controller1, 'cancel', true);
          const cancelSpy2 = createSpy(controller2, 'cancel', true);
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Escape' }));
          assert.strictEqual(cancelSpy1.calls.length, 0);
          assert.strictEqual(cancelSpy2.calls.length, 1);
          await controller2.closed;
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Escape' }));
          assert.strictEqual(cancelSpy1.calls.length, 1);
          assert.strictEqual(cancelSpy2.calls.length, 1);
          await controller1.closed;
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);

          cancelSpy1.restore();
          cancelSpy2.restore();
        }
      },
      {
        title: 'does not close the latest open dialog when hitting ESC key when lock:true',
        afterStarted: async ({ ctx }, dialogService) => {
          const [{ controller: controller1 }, { controller: controller2 }] = await Promise.all([
            dialogService.open({ template: 'Hello world', lock: false }),
            dialogService.open({ template: 'Hello world', lock: true })
          ]);
          const cancelSpy1 = createSpy(controller1, 'cancel', true);
          const cancelSpy2 = createSpy(controller2, 'cancel', true);
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Escape' }));
          assert.strictEqual(cancelSpy1.calls.length, 0);
          assert.strictEqual(cancelSpy2.calls.length, 0);
          void controller2.cancel();
          await controller2.closed;
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Escape' }));
          assert.strictEqual(cancelSpy1.calls.length, 1);
          await controller1.closed;
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);

          cancelSpy1.restore();
          cancelSpy2.restore();
        }
      },
      {
        title: 'closes on Enter with keyboard:Enter regardless lock:[value]',
        afterStarted: async ({ ctx }, dialogService) => {
          const { controller: controller1 } = await dialogService.open({ template: 'Hello world', lock: false, keyboard: 'Enter' });
          const { controller: controller2 } = await dialogService.open({ template: 'Hello world', lock: true, keyboard: 'Enter' });
          const okSpy1 = createSpy(controller1, 'ok', true);
          const okSpy2 = createSpy(controller2, 'ok', true);
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Escape' }));
          assert.strictEqual(okSpy1.calls.length, 0);
          assert.strictEqual(okSpy2.calls.length, 0);

          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Enter' }));
          assert.strictEqual(okSpy1.calls.length, 0);
          assert.strictEqual(okSpy2.calls.length, 1);
          await controller2.closed;
          ctx.wnd.dispatchEvent(new ctx.wnd.KeyboardEvent('keydown', { key: 'Enter' }));
          assert.strictEqual(okSpy1.calls.length, 1);
          assert.strictEqual(okSpy2.calls.length, 1);
          await controller1.closed;
          assert.strictEqual(dialogService.hasOpenDialog, false);
          assert.strictEqual(dialogService.count, 0);

          okSpy1.restore();
          okSpy2.restore();
        }
      },
      {
        title: 'invokes lifeycyles in correct order',
        afterStarted: async (_, dialogService) => {
          const lifecycles: string[] = [];
          function log(lifecylce: string) {
            lifecycles.push(lifecylce);
          }

          class MyDialog {
            public constructor() {
              log('constructor');
            }
          }

          [
            'canActivate',
            'activate',
            'define',
            'hydrating',
            'hydrated',
            'binding',
            'bound',
            'attaching',
            'attached',
            'canDeactivate',
            'deactivate',
            'detaching',
            'unbinding',
          ].forEach(method => {
            MyDialog.prototype[method] = function () {
              log(method);
            };
          });

          const { controller } = await dialogService.open({ component: () => MyDialog });
          assert.deepStrictEqual(lifecycles, [
            'constructor',
            'canActivate',
            'activate',
            'define',
            'hydrating',
            'hydrated',
            'binding',
            'bound',
            'attaching',
            'attached',
          ]);

          void controller.ok();
          await controller.closed;
          assert.deepStrictEqual(lifecycles, [
            'constructor',
            'canActivate',
            'activate',
            'define',
            'hydrating',
            'hydrated',
            'binding',
            'bound',
            'attaching',
            'attached',
            'canDeactivate',
            'deactivate',
            'detaching',
            'unbinding',
          ]);
        }
      },
      {
        title: 'it works with .delegate listener',
        afterStarted: async ({ ctx }, dialogService) => {
          let click1CallCount = 0;
          let click2CallCount = 0;
          await Promise.all([
            dialogService.open({
              component: () => class MyClass1 {
                public onClick() {
                  click1CallCount++;
                }
              },
              template: '<button data-dialog-btn click.delegate="onClick()">'
            }),
            dialogService.open({
              component: () => class MyClass2 {
                public onClick() {
                  click2CallCount++;
                }
              },
              template: '<button data-dialog-btn click.delegate="onClick()">'
            }),
          ]);

          const buttons = Array.from(ctx.doc.querySelectorAll('[data-dialog-btn]')) as HTMLElement[];
          buttons[0].click();
          assert.strictEqual(click1CallCount, 1);
          assert.strictEqual(click2CallCount, 0);
          buttons[1].click();
          assert.strictEqual(click1CallCount, 1);
          assert.strictEqual(click2CallCount, 1);
        }
      },
      {
        title: 'it passes model to the lifecycle methods',
        afterStarted: async (_, dialogService) => {
          let canActivateCalled = false;
          let activateCalled = false;
          const model = {};
          await dialogService.open({
            model,
            component: () => class {
              public canActivate($model: unknown) {
                canActivateCalled = true;
                assert.strictEqual(model, $model);
              }
              public activate($model: unknown) {
                activateCalled = true;
                assert.strictEqual(model, $model);
              }
            }
          });
          assert.strictEqual(canActivateCalled, true);
          assert.strictEqual(activateCalled, true);
        }
      }
    ];

    for (const { title, only, afterStarted, afterTornDown } of testCases) {
      const $it = only ? it.only : it;
      $it(title, async function () {
        const creationResult = createFixture('', class App { }, [DialogDefaultConfiguration]);
        const { ctx, tearDown, startPromise } = creationResult;
        await startPromise;
        const dialogService = ctx.container.get(IDialogService);
        try {
          await afterStarted(creationResult, dialogService);
        } catch (ex) {
          try {
            await dialogService.closeAll();
          } catch (e2) {/* best effort */ }
          try {
            await tearDown();
          } catch (e2) {/* best effort */ }
          ctx.doc.querySelectorAll('au-dialog-container').forEach(e => e.remove());
          throw ex;
        }

        await tearDown();
        await afterTornDown?.(creationResult, dialogService);
        const dialogContainerEls = ctx.doc.querySelectorAll('au-dialog-container');
        dialogContainerEls.forEach(e => e.remove());
        if (dialogContainerEls.length > 0) {
          throw new Error('Invalid test, left over <au-dialog-container/> in the document');
        }
      });
    }
  });

  interface IDialogServiceTestCase {
    title: string;
    afterStarted: (appCreationResult: ReturnType<typeof createFixture>, dialogService: IDialogService) => void | Promise<void>;
    afterTornDown?: (appCreationResult: ReturnType<typeof createFixture>, dialogService: IDialogService) => void | Promise<void>;
    only?: boolean;
  }
});
