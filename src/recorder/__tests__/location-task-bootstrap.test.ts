import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

describe('headless location task bootstrap', () => {
  it('loads the task module before Expo Router from the configured entrypoint', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as { main?: string };
    const entrySource = readFileSync(resolve(projectRoot, 'index.js'), 'utf8');
    const taskImportIndex = entrySource.indexOf("import './src/recorder/location-task';");
    const routerImportIndex = entrySource.indexOf("import 'expo-router/entry';");

    expect(packageJson.main).toBe('index.js');
    expect(taskImportIndex).toBeGreaterThanOrEqual(0);
    expect(routerImportIndex).toBeGreaterThan(taskImportIndex);
  });

  it('defines the task before lazily importing its database dependency', () => {
    const taskSource = readFileSync(
      resolve(projectRoot, 'src/recorder/location-task.native.ts'),
      'utf8',
    );
    const definitionIndex = taskSource.indexOf('TaskManager.defineTask');
    const databaseImportIndex = taskSource.indexOf("import('./database.native')");

    expect(taskSource).not.toMatch(
      /import\s+[^;]+\s+from\s+['"]\.\/database\.native['"]/,
    );
    expect(definitionIndex).toBeGreaterThanOrEqual(0);
    expect(databaseImportIndex).toBeGreaterThan(definitionIndex);
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
});
