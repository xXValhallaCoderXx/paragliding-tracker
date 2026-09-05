import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCATION_TASK_NAME } from '../config';

const projectRoot = process.cwd();
const mockDefine = jest.fn();
const mockDatabaseLoaded = jest.fn();
const mockPersist = jest.fn();
const mockEvent = jest.fn();
const mockRouterLoaded = jest.fn();
let mockDefined = false;
jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => mockDefined,
  defineTask: (...args: unknown[]) => { mockDefined = true; mockDefine(...args); },
}));
jest.mock('../database.native', () => {
  mockDatabaseLoaded();
  return { persistLocationBatch: mockPersist, getUnfinishedSession: async () => ({ id: 's' }), recordEvent: mockEvent };
});
jest.mock('expo-router/entry', () => {
  mockRouterLoaded(mockDefine.mock.calls.length);
  return {};
});
beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); mockDefined = false; });
it('executes task registration before the router and loads SQLite only when a callback arrives', async () => {
  const { main } = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  await jest.isolateModulesAsync(async () => {
    jest.requireActual(resolve(projectRoot, main));
    expect(mockDefine).toHaveBeenCalledWith(LOCATION_TASK_NAME, expect.any(Function));
    expect(mockRouterLoaded).toHaveBeenCalledWith(1);
    expect(mockDatabaseLoaded).not.toHaveBeenCalled();
    const callback = mockDefine.mock.calls[0][1];
    const locations = [{ timestamp: 1000 }];
    await callback({ data: { locations }, executionInfo: { eventId: 'callback-1' } });
    expect(mockDatabaseLoaded).toHaveBeenCalledTimes(1);
    expect(mockPersist).toHaveBeenCalledWith({ callbackId: 'callback-1', receivedAt: expect.any(Number), locations });
    await callback({ error: { code: 1, message: 'GPS unavailable' }, executionInfo: { eventId: 'callback-2' } });
    expect(mockEvent).toHaveBeenCalledWith('s', 'location_task_error', expect.any(Number), { code: 1, message: 'GPS unavailable', eventId: 'callback-2' });
    expect(mockPersist).toHaveBeenCalledTimes(1);
  });
});
it('does not redefine an installed task or load its database during registration', () => {
  mockDefined = true;
  jest.isolateModules(() => { jest.requireActual('../location-task.native'); });
  expect(mockDefine).not.toHaveBeenCalled(); expect(mockDatabaseLoaded).not.toHaveBeenCalled();
});

  it('keeps Expo TaskManager\'s Android headless timer guard pending', () => {
    const workspaceSource = readFileSync(
      resolve(projectRoot, 'pnpm-workspace.yaml'),
      'utf8',
    );
    const patchSource = readFileSync(
      resolve(projectRoot, 'patches/expo-task-manager@57.0.11.patch'),
      'utf8',
    );
    const installedSource = readFileSync(
      resolve(projectRoot, 'node_modules/expo-task-manager/build/TaskManager.js'),
      'utf8',
    );

    expect(workspaceSource).toContain(
      'expo-task-manager@57.0.11: patches/expo-task-manager@57.0.11.patch',
    );
    expect(patchSource).toContain('new Promise<void>(() => {})');
    expect(installedSource).toContain('() => () => new Promise(() => { })');
  });
