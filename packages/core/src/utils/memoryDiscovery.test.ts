/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadServerHierarchicalMemory,
  refreshServerHierarchicalMemory,
  loadJitSubdirectoryMemory,
} from './memoryDiscovery.js';
import {
  setGeminiMdFilename,
  DEFAULT_CONTEXT_FILENAME,
} from '../tools/memoryTool.js';
import { flattenMemory } from '../config/memory.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GEMINI_DIR, normalizePath, homedir as pathsHomedir } from './paths.js';
import type { HierarchicalMemory } from '../config/memory.js';

function flattenResult(result: {
  memoryContent: HierarchicalMemory;
  fileCount: number;
  filePaths: string[];
  claudeCodeDetected: boolean;
}) {
  return {
    ...result,
    memoryContent: flattenMemory(result.memoryContent),
    filePaths: result.filePaths.map((p) => normalizePath(p)),
  };
}
import type { Config, GeminiCLIExtension } from '../config/config.js';
import { SimpleExtensionLoader } from './extensionLoader.js';

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof os>();
  return {
    ...actualOs,
    homedir: vi.fn(),
  };
});

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actualPaths = await importOriginal<typeof import('./paths.js')>();
  return {
    ...actualPaths,
    homedir: vi.fn(),
  };
});

describe('memoryDiscovery', () => {
  const DEFAULT_FOLDER_TRUST = true;
  let testRootDir: string;
  let userHomeDir: string;
  let projectRoot: string;
  let cwd: string;

  async function createEmptyDir(fullPath: string) {
    await fsPromises.mkdir(fullPath, { recursive: true });
    return normalizePath(fullPath);
  }

  async function createTestFile(fullPath: string, fileContents: string) {
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, fileContents);
    return normalizePath(path.resolve(testRootDir, fullPath));
  }

  const normMarker = (p: string) =>
    process.platform === 'win32' ? p.toLowerCase() : p;

  beforeEach(async () => {
    vi.resetAllMocks();
    testRootDir = normalizePath(
      await fsPromises.mkdtemp(
        path.join(os.tmpdir(), 'folder-structure-test-'),
      ),
    );
    userHomeDir = await createEmptyDir(path.join(testRootDir, 'userhome'));
    projectRoot = await createEmptyDir(path.join(testRootDir, 'project'));
    cwd = await createEmptyDir(path.join(projectRoot, 'src'));

    vi.mocked(os.homedir).mockReturnValue(userHomeDir);
    vi.mocked(pathsHomedir).mockReturnValue(userHomeDir);

    // Default Gemini filename
    setGeminiMdFilename(DEFAULT_CONTEXT_FILENAME);
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(testRootDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('when untrusted', () => {
    it('does not load context files from untrusted workspaces', async () => {
      await createTestFile(
        path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
        'Project root memory',
      );

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          false, // untrusted
        ),
      );

      expect(result).toEqual({
        memoryContent: '',
        fileCount: 0,
        filePaths: [],
        claudeCodeDetected: false,
      });
    });

    it('loads context from outside the untrusted workspace', async () => {
      const globalGeminiDir = await createEmptyDir(
        path.join(userHomeDir, GEMINI_DIR),
      );
      const globalContextFile = await createTestFile(
        path.join(globalGeminiDir, DEFAULT_CONTEXT_FILENAME),
        'Global memory',
      );

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          false, // untrusted
        ),
      );

      expect(result.filePaths).toEqual([globalContextFile]);
      expect(result.memoryContent).toContain('Global memory');
    });
  });

  it('should return empty memory and count if no context files are found', async () => {
    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
      claudeCodeDetected: false,
    });
  });

  it('should load only the global context file if present and others are not (default filename)', async () => {
    const globalGeminiDir = await createEmptyDir(
      path.join(userHomeDir, GEMINI_DIR),
    );
    const defaultContextFile = await createTestFile(
      path.join(globalGeminiDir, DEFAULT_CONTEXT_FILENAME),
      'default context content',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Global ---
--- Context from: ${path.relative(cwd, defaultContextFile)} ---
default context content
--- End of Context from: ${path.relative(cwd, defaultContextFile)} ---`,
      fileCount: 1,
      filePaths: [defaultContextFile],
      claudeCodeDetected: false,
    });
  });

  it('should load only the global custom context file if present and filename is changed', async () => {
    const customFilename = 'CUSTOM_AGENTS.md';
    setGeminiMdFilename(customFilename);

    const globalGeminiDir = await createEmptyDir(
      path.join(userHomeDir, GEMINI_DIR),
    );
    const customContextFile = await createTestFile(
      path.join(globalGeminiDir, customFilename),
      'custom context content',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Global ---
--- Context from: ${normMarker(path.relative(cwd, customContextFile))} ---
custom context content
--- End of Context from: ${normMarker(path.relative(cwd, customContextFile))} ---`,
      fileCount: 1,
      filePaths: [customContextFile],
      claudeCodeDetected: false,
    });
  });

  it('should load context files by upward traversal with custom filename', async () => {
    const customFilename = 'PROJECT_CONTEXT.md';
    setGeminiMdFilename(customFilename);

    const projectContextFile = await createTestFile(
      path.join(projectRoot, customFilename),
      'project context content',
    );
    const cwdContextFile = await createTestFile(
      path.join(cwd, customFilename),
      'cwd context content',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
--- Context from: ${normMarker(path.relative(cwd, projectContextFile))} ---
project context content
--- End of Context from: ${normMarker(path.relative(cwd, projectContextFile))} ---

--- Context from: ${normMarker(path.relative(cwd, cwdContextFile))} ---
cwd context content
--- End of Context from: ${normMarker(path.relative(cwd, cwdContextFile))} ---`,
      fileCount: 2,
      filePaths: [projectContextFile, cwdContextFile],
      claudeCodeDetected: false,
    });
  });

  it('should load context files by downward traversal with custom filename', async () => {
    const customFilename = 'LOCAL_CONTEXT.md';
    setGeminiMdFilename(customFilename);

    const subdir = await createEmptyDir(path.join(cwd, 'subdir'));
    const cwdContextFile = await createTestFile(
      path.join(cwd, customFilename),
      'CWD memory',
    );
    const subDirContextFile = await createTestFile(
      path.join(subdir, customFilename),
      'Subdir custom memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
--- Context from: ${normMarker(customFilename)} ---
CWD memory
--- End of Context from: ${normMarker(customFilename)} ---

--- Context from: ${normMarker(path.join('subdir', customFilename))} ---
Subdir custom memory
--- End of Context from: ${normMarker(path.join('subdir', customFilename))} ---`,
      fileCount: 2,
      filePaths: [cwdContextFile, subDirContextFile],
      claudeCodeDetected: false,
    });
  });

  it('should load ORIGINAL_GEMINI_MD_FILENAME files by upward traversal from CWD to project root', async () => {
    await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project root memory',
    );
    const srcGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'Src directory memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
Project root memory

--- Context from: ${normMarker(path.relative(cwd, srcGeminiFile))} ---
Src directory memory
--- End of Context from: ${normMarker(path.relative(cwd, srcGeminiFile))} ---`,
      fileCount: 2,
      claudeCodeDetected: false,
    });
  });

  it('should load ORIGINAL_GEMINI_MD_FILENAME files by downward traversal from CWD', async () => {
    const subdir = await createEmptyDir(path.join(cwd, 'subdir'));
    const cwdGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );
    const subDirGeminiFile = await createTestFile(
      path.join(subdir, DEFAULT_CONTEXT_FILENAME),
      'Subdir memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
--- Context from: ${normMarker(DEFAULT_CONTEXT_FILENAME)} ---
CWD memory
--- End of Context from: ${normMarker(DEFAULT_CONTEXT_FILENAME)} ---

--- Context from: ${normMarker(path.join('subdir', DEFAULT_CONTEXT_FILENAME))} ---
Subdir memory
--- End of Context from: ${normMarker(path.join('subdir', DEFAULT_CONTEXT_FILENAME))} ---`,
      fileCount: 2,
      filePaths: [cwdGeminiFile, subDirGeminiFile],
      claudeCodeDetected: false,
    });
  });

  it('should load and correctly order global, upward, and downward ORIGINAL_GEMINI_MD_FILENAME files', async () => {
    const globalGeminiDir = await createEmptyDir(
      path.join(userHomeDir, GEMINI_DIR),
    );
    await createTestFile(
      path.join(globalGeminiDir, DEFAULT_CONTEXT_FILENAME),
      'Global memory',
    );

    await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project root memory',
    );

    const cwdGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );

    const subdir = await createEmptyDir(path.join(cwd, 'subdir'));
    const subDirGeminiFile = await createTestFile(
      path.join(subdir, DEFAULT_CONTEXT_FILENAME),
      'Subdir memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Global ---
--- Context from: ${normMarker(path.relative(cwd, defaultContextFile))} ---
Global memory
--- End of Context from: ${normMarker(path.relative(cwd, defaultContextFile))} ---

--- Project ---
Project root memory

--- Context from: ${normMarker(DEFAULT_CONTEXT_FILENAME)} ---
CWD memory
--- End of Context from: ${normMarker(DEFAULT_CONTEXT_FILENAME)} ---

--- Context from: ${normMarker(path.join('subdir', DEFAULT_CONTEXT_FILENAME))} ---
Subdir memory
--- End of Context from: ${normMarker(path.join('subdir', DEFAULT_CONTEXT_FILENAME))} ---`,
      fileCount: 4,
      filePaths: [defaultContextFile, cwdGeminiFile, subDirGeminiFile],
      claudeCodeDetected: false,
    });
  });

  it('should ignore specified directories during downward scan', async () => {
    await createTestFile(
      path.join(projectRoot, '.geminiignore'),
      'node_modules',
    );

    await createTestFile(
      path.join(cwd, 'node_modules', DEFAULT_CONTEXT_FILENAME),
      'Ignored memory',
    );
    const regularSubDirGeminiFile = await createTestFile(
      path.join(cwd, 'my_code', DEFAULT_CONTEXT_FILENAME),
      'My code memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
--- Context from: ${normMarker(path.relative(cwd, regularSubDirGeminiFile))} ---
My code memory
--- End of Context from: ${normMarker(path.relative(cwd, regularSubDirGeminiFile))} ---`,
      fileCount: 1,
      filePaths: [regularSubDirGeminiFile],
      claudeCodeDetected: false,
    });
  });

  it('should respect the maxDirs parameter during downward scan', async () => {
    // Create directories in parallel for better performance
    const dirPromises = Array.from({ length: 2 }, (_, i) =>
      createEmptyDir(path.join(cwd, `deep_dir_${i}`)),
    );
    const dirs = await Promise.all(dirPromises);

    await createTestFile(
      path.join(dirs[0], DEFAULT_CONTEXT_FILENAME),
      'Content from project 0',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
        'tree',
        undefined,
        1, // maxDirs
      ),
    );

    expect(result).toEqual({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
      claudeCodeDetected: false,
    });
  });

  it('should load extension context file paths', async () => {
    const extensionDir = await createEmptyDir(
      path.join(testRootDir, 'extensions', 'ext1'),
    );
    const extensionFilePath = await createTestFile(
      path.join(extensionDir, DEFAULT_CONTEXT_FILENAME),
      'Extension memory content',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([
          {
            manifest: { name: 'ext1' },
            config: { enabled: true },
            id: 'ext1',
            isActive: true,
            contextFiles: [extensionFilePath],
            sourcePath: extensionDir,
          } as unknown as GeminiCLIExtension,
        ]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Extension ---
--- Context from: ${normMarker(path.relative(cwd, extensionFilePath))} ---
Extension memory content
--- End of Context from: ${normMarker(path.relative(cwd, extensionFilePath))} ---`,
      fileCount: 1,
      filePaths: [extensionFilePath],
      claudeCodeDetected: false,
    });
  });

  it('should load memory from included directories', async () => {
    const includedDir = await createEmptyDir(
      path.join(testRootDir, 'included'),
    );
    const includedFile = await createTestFile(
      path.join(includedDir, DEFAULT_CONTEXT_FILENAME),
      'included directory memory',
    );

    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        [includedDir],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    expect(result).toEqual({
      memoryContent: `--- Project ---
--- Context from: ${normMarker(path.relative(cwd, includedFile))} ---
included directory memory
--- End of Context from: ${normMarker(path.relative(cwd, includedFile))} ---`,
      fileCount: 1,
      filePaths: [includedFile],
      claudeCodeDetected: false,
    });
  });

  it('should handle multiple directories and files in parallel correctly', async () => {
    const numDirs = 10;
    const dirPromises = Array.from({ length: numDirs }, (_, i) =>
      createEmptyDir(path.join(projectRoot, `dir_${i}`)),
    );
    const projectDirs = await Promise.all(dirPromises);

    const filePromises = projectDirs.map((dir, i) =>
      createTestFile(
        path.join(dir, DEFAULT_CONTEXT_FILENAME),
        `Content from project ${i}`,
      ),
    );
    const createdFiles = await Promise.all(filePromises);

    // Load memory from all directories
    const result = flattenResult(
      await loadServerHierarchicalMemory(
        cwd,
        createdFiles.map((f) => path.dirname(f)),
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    // Should have loaded all files
    expect(result.filePaths.length).toBe(numDirs);
    expect(result.filePaths.sort()).toEqual(createdFiles.sort());

    // Content should include all project contents
    const flattenedMemory = flattenMemory(result.memoryContent);
    for (let i = 0; i < numDirs; i++) {
      expect(flattenedMemory).toContain(`Content from project ${i}`);
    }
  });

  describe('Claude Code detection', () => {
    it('should detect CLAUDE.md', async () => {
      await createTestFile(path.join(cwd, 'CLAUDE.md'), 'Claude instructions');

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.claudeCodeDetected).toBe(true);
    });

    it('should detect .claude.json', async () => {
      await createTestFile(path.join(cwd, '.claude.json'), JSON.stringify({}));

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.claudeCodeDetected).toBe(true);
    });

    it('should NOT detect Claude artifacts if GEMINI.md already exists', async () => {
      await createTestFile(path.join(cwd, 'CLAUDE.md'), 'Claude instructions');
      await createTestFile(path.join(cwd, 'GEMINI.md'), 'Gemini instructions');

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.claudeCodeDetected).toBe(false);
    });

    it('should NOT detect Claude artifacts if not present', async () => {
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.claudeCodeDetected).toBe(false);
    });
  });

  it('should preserve order and prevent duplicates when processing multiple directories', async () => {
    // Create overlapping directory structure
    const parentDir = await createEmptyDir(path.join(testRootDir, 'parent'));
    const childDir = await createEmptyDir(path.join(parentDir, 'child'));

    const parentFile = await createTestFile(
      path.join(parentDir, DEFAULT_CONTEXT_FILENAME),
      'Parent content',
    );
    const childFile = await createTestFile(
      path.join(childDir, DEFAULT_CONTEXT_FILENAME),
      'Child content',
    );

    // Include both parent and child directories
    const result = flattenResult(
      await loadServerHierarchicalMemory(
        parentDir,
        [childDir, parentDir], // Deliberately include duplicates
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      ),
    );

    // Should have only 2 files
    expect(result.fileCount).toBe(2);
    expect(result.filePaths).toHaveLength(2);
    expect(result.filePaths).toContain(normalizePath(parentFile));
    expect(result.filePaths).toContain(normalizePath(childFile));

    // Order should be parent then child (hierarchical)
    const flattenedMemory = flattenMemory(result.memoryContent);
    const parentIndex = flattenedMemory.indexOf('Parent content');
    const childIndex = flattenedMemory.indexOf('Child content');
    expect(parentIndex).toBeLessThan(childIndex);
  });

  describe('getGlobalMemoryPaths', () => {
    it('should find global memory file if it exists', async () => {
      const globalGeminiDir = await createEmptyDir(
        path.join(userHomeDir, GEMINI_DIR),
      );
      const globalFile = await createTestFile(
        path.join(globalGeminiDir, DEFAULT_CONTEXT_FILENAME),
        'Global content',
      );

      // Need to use the real internal function if we want to test it in isolation
      // but loadServerHierarchicalMemory is sufficient for verifying the paths are found.
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(globalFile);
    });

    it('should return empty array if global memory file does not exist', async () => {
      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(
        result.filePaths.filter((p) => p.includes(GEMINI_DIR)),
      ).toHaveLength(0);
    });
  });

  describe('getExtensionMemoryPaths', () => {
    it('should return active extension context files', async () => {
      const extensionDir = await createEmptyDir(
        path.join(testRootDir, 'extensions', 'ext1'),
      );
      const extensionFile = await createTestFile(
        path.join(extensionDir, DEFAULT_CONTEXT_FILENAME),
        'Extension content',
      );

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([
          {
            manifest: { name: 'ext1' },
            config: { enabled: true },
            id: 'ext1',
            isActive: true,
            contextFiles: [extensionFile],
            sourcePath: extensionDir,
          } as unknown as GeminiCLIExtension,
        ]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(extensionFile);
    });

    it('should ignore inactive extensions', async () => {
      const extensionDir = await createEmptyDir(
        path.join(testRootDir, 'extensions', 'ext1'),
      );
      await createTestFile(
        path.join(extensionDir, DEFAULT_CONTEXT_FILENAME),
        'Extension content',
      );

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([
          {
            manifest: { name: 'ext1' },
            config: { enabled: false }, // disabled
            id: 'ext1',
            sourcePath: extensionDir,
          } as unknown as GeminiCLIExtension,
        ]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toHaveLength(0);
    });
  });

  describe('getEnvironmentMemoryPaths', () => {
    it('should NOT traverse upward beyond trusted root (even with .git)', async () => {
      // Create a structure: /untrusted/project (trusted)
      const untrustedRoot = await createEmptyDir(
        path.join(testRootDir, 'untrusted'),
      );
      const trustedProject = await createEmptyDir(
        path.join(untrustedRoot, 'project'),
      );
      const srcDir = await createEmptyDir(path.join(trustedProject, 'src'));

      // Add GEMINI.md in untrusted parent
      await createTestFile(
        path.join(untrustedRoot, DEFAULT_CONTEXT_FILENAME),
        'Untrusted memory',
      );
      // Add GEMINI.md in trusted project
      const trustedFile = await createTestFile(
        path.join(trustedProject, DEFAULT_CONTEXT_FILENAME),
        'Trusted memory',
      );

      // Mark project as trusted
      await loadServerHierarchicalMemory(
        srcDir,
        [],
        new FileDiscoveryService(trustedProject),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(trustedFile);
    });

    it('should NOT traverse upward beyond trusted root (no .git)', async () => {
      const untrustedRoot = await createEmptyDir(
        path.join(testRootDir, 'untrusted_no_git'),
      );
      const trustedProject = await createEmptyDir(
        path.join(untrustedRoot, 'project'),
      );
      const srcDir = await createEmptyDir(path.join(trustedProject, 'src'));

      await createTestFile(
        path.join(untrustedRoot, DEFAULT_CONTEXT_FILENAME),
        'Untrusted memory',
      );
      const trustedFile = await createTestFile(
        path.join(trustedProject, DEFAULT_CONTEXT_FILENAME),
        'Trusted memory',
      );

      await loadServerHierarchicalMemory(
        srcDir,
        [],
        new FileDiscoveryService(trustedProject),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(trustedFile);
    });

    it('should deduplicate paths when same root is trusted multiple times', async () => {
      await loadServerHierarchicalMemory(
        cwd,
        [cwd, cwd], // duplicate includes
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      // internally should deduplicate
      expect(result.fileCount).toBeLessThanOrEqual(
        new Set(result.filePaths).size,
      );
    });

    it('should keep multiple memory files from the same directory adjacent and in order', async () => {
      setGeminiMdFilename(['A.md', 'B.md']);
      const fileA = await createTestFile(path.join(cwd, 'A.md'), 'Content A');
      const fileB = await createTestFile(path.join(cwd, 'B.md'), 'Content B');

      await loadServerHierarchicalMemory(
        cwd,
        [],
        new FileDiscoveryService(projectRoot),
        new SimpleExtensionLoader([]),
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toEqual([fileA, fileB]);
    });
  });

  describe('case-insensitive filesystem deduplication', () => {
    it('should deduplicate files that point to the same inode (same physical file)', async () => {
      const geminiFile = await createTestFile(
        path.join(projectRoot, 'gemini.md'),
        'Project root memory',
      );

      // create hard link to simulate case-insensitive filesystem behavior
      const geminiFileLink = path.join(projectRoot, 'GEMINI.md');
      try {
        await fsPromises.link(geminiFile, geminiFileLink);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('cross-device') ||
          errorMessage.includes('EXDEV') ||
          errorMessage.includes('EEXIST')
        ) {
          return;
        }
        throw error;
      }

      const stats1 = await fsPromises.lstat(geminiFile);
      const stats2 = await fsPromises.lstat(geminiFileLink);
      expect(stats1.ino).toBe(stats2.ino);
      expect(stats1.dev).toBe(stats2.dev);

      setGeminiMdFilename(['GEMINI.md', 'gemini.md']);

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          DEFAULT_FOLDER_TRUST,
        ),
      );

      expect(result.fileCount).toBe(1);
      expect(result.filePaths).toHaveLength(1);
      expect(result.memoryContent).toContain('Project root memory');
      const contentMatches = result.memoryContent.match(/Project root memory/g);
      expect(contentMatches).toHaveLength(1);

      try {
        await fsPromises.unlink(geminiFileLink);
      } catch {
        // ignore cleanup errors
      }
    });

    it('should handle case where files have different inodes (different files)', async () => {
      const geminiFileLower = await createTestFile(
        path.join(projectRoot, 'gemini.md'),
        'Lowercase file content',
      );
      const geminiFileUpper = await createTestFile(
        path.join(projectRoot, 'GEMINI.md'),
        'Uppercase file content',
      );

      const stats1 = await fsPromises.lstat(geminiFileLower);
      const stats2 = await fsPromises.lstat(geminiFileUpper);

      if (stats1.ino === stats2.ino && stats1.dev === stats2.dev) {
        return;
      }

      setGeminiMdFilename(['GEMINI.md', 'gemini.md']);

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          DEFAULT_FOLDER_TRUST,
        ),
      );

      expect(result.fileCount).toBe(2);
      expect(result.filePaths).toHaveLength(2);
      expect(result.memoryContent).toContain('Lowercase file content');
      expect(result.memoryContent).toContain('Uppercase file content');
    });

    it("should handle files that cannot be stat'd (missing files)", async () => {
      await createTestFile(
        path.join(projectRoot, 'gemini.md'),
        'Valid file content',
      );

      setGeminiMdFilename(['gemini.md', 'missing.md']);

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          DEFAULT_FOLDER_TRUST,
        ),
      );

      expect(result.fileCount).toBe(1);
      expect(result.memoryContent).toContain('Valid file content');
    });

    it('should deduplicate multiple paths pointing to same file (3+ duplicates)', async () => {
      const geminiFile = await createTestFile(
        path.join(projectRoot, 'gemini.md'),
        'Project root memory',
      );

      const link1 = path.join(projectRoot, 'GEMINI.md');
      const link2 = path.join(projectRoot, 'Gemini.md');

      try {
        await fsPromises.link(geminiFile, link1);
        await fsPromises.link(geminiFile, link2);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('cross-device') ||
          errorMessage.includes('EXDEV') ||
          errorMessage.includes('EEXIST')
        ) {
          return;
        }
        throw error;
      }

      const stats1 = await fsPromises.lstat(geminiFile);
      const stats2 = await fsPromises.lstat(link1);
      const stats3 = await fsPromises.lstat(link2);
      expect(stats1.ino).toBe(stats2.ino);
      expect(stats1.ino).toBe(stats3.ino);

      setGeminiMdFilename(['gemini.md', 'GEMINI.md', 'Gemini.md']);

      const result = flattenResult(
        await loadServerHierarchicalMemory(
          cwd,
          [],
          new FileDiscoveryService(projectRoot),
          new SimpleExtensionLoader([]),
          DEFAULT_FOLDER_TRUST,
        ),
      );

      expect(result.fileCount).toBe(1);
      expect(result.filePaths).toHaveLength(1);
      expect(result.memoryContent).toContain('Project root memory');
      const contentMatches = result.memoryContent.match(/Project root memory/g);
      expect(contentMatches).toHaveLength(1);

      try {
        await fsPromises.unlink(link1);
        await fsPromises.unlink(link2);
      } catch {
        // ignore cleanup errors
      }
    });
  });

  describe('loadJitSubdirectoryMemory', () => {
    it('should load JIT memory when target is inside a trusted root', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const geminiFile = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'JIT memory content',
      );

      await loadJitSubdirectoryMemory(targetFile, [rootDir], new Set());

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(normalizePath(geminiFile));
      expect(result.files[0].content).toBe('JIT memory content');
    });

    it('should skip JIT memory when target is outside trusted roots', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const otherDir = await createEmptyDir(path.join(testRootDir, 'other'));
      const targetFile = path.join(otherDir, 'target.txt');

      await createTestFile(
        path.join(otherDir, DEFAULT_CONTEXT_FILENAME),
        'JIT memory content',
      );

      await loadJitSubdirectoryMemory(targetFile, [rootDir], new Set());

      expect(result.files).toHaveLength(0);
    });

    it('should skip already loaded paths', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const geminiFile = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'JIT memory content',
      );

      await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set([normalizePath(geminiFile)]),
      );

      expect(result.files).toHaveLength(0);
    });

    it('should deduplicate files in JIT memory loading (same inode)', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const geminiFile = await createTestFile(
        path.join(subDir, 'gemini.md'),
        'JIT memory content',
      );

      const geminiFileLink = path.join(subDir, 'GEMINI.md');
      try {
        await fsPromises.link(geminiFile, geminiFileLink);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('cross-device') ||
          errorMessage.includes('EXDEV') ||
          errorMessage.includes('EEXIST')
        ) {
          return;
        }
        throw error;
      }

      const stats1 = await fsPromises.lstat(geminiFile);
      const stats2 = await fsPromises.lstat(geminiFileLink);
      expect(stats1.ino).toBe(stats2.ino);

      setGeminiMdFilename(['gemini.md', 'GEMINI.md']);

      await loadJitSubdirectoryMemory(targetFile, [rootDir], new Set());

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe('JIT memory content');
      const contentMatches =
        result.files[0].content.match(/JIT memory content/g);
      expect(contentMatches).toHaveLength(1);

      try {
        await fsPromises.unlink(geminiFileLink);
      } catch {
        // ignore cleanup errors
      }
    });

    it('should use the deepest trusted root when multiple nested roots exist', async () => {
      const outerRoot = await createEmptyDir(path.join(testRootDir, 'outer'));
      const innerRoot = await createEmptyDir(path.join(outerRoot, 'inner'));
      const subDir = await createEmptyDir(path.join(innerRoot, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir content',
      );

      // outerRoot is trusted, but innerRoot is deeper and also trusted.
      // Discovery should stop at innerRoot.
      await loadJitSubdirectoryMemory(
        targetFile,
        [outerRoot, innerRoot],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe('Subdir content');
    });

    it('should resolve file target to its parent directory for traversal', async () => {
      const rootDir = await createEmptyDir(
        path.join(testRootDir, 'jit_file_resolve'),
      );
      const subDir = await createEmptyDir(path.join(rootDir, 'src'));

      // Create the target file so fs.stat can identify it as a file
      const targetFile = await createTestFile(
        path.join(subDir, 'app.ts'),
        'const x = 1;',
      );

      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Src context rules',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
      );

      // Should find the GEMINI.md in the same directory as the file
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Src context rules');
    });

    it('should handle non-existent file target by using parent directory', async () => {
      const rootDir = await createEmptyDir(
        path.join(testRootDir, 'jit_nonexistent'),
      );
      const subDir = await createEmptyDir(path.join(rootDir, 'src'));

      // Target file does NOT exist (e.g. write_file creating a new file)
      const targetFile = path.join(subDir, 'new-file.ts');

      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Rules for new files',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Rules for new files');
    });
  });

  it('refreshServerHierarchicalMemory should refresh memory and update config', async () => {
    await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project content',
    );

    const mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue(cwd),
      shouldLoadMemoryFromIncludeDirectories: vi.fn().mockReturnValue(false),
      getFileService: vi
        .fn()
        .mockReturnValue(new FileDiscoveryService(projectRoot)),
      getExtensionLoader: vi
        .fn()
        .mockReturnValue(new SimpleExtensionLoader([])),
      isTrustedFolder: vi.fn().mockReturnValue(true),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue([]),
      }),
      setUserMemory: vi.fn(),
      setGeminiMdFileCount: vi.fn(),
      setGeminiMdFilePaths: vi.fn(),
      setClaudeCodeDetected: vi.fn(),
      getImportFormat: vi.fn().mockReturnValue('tree'),
      getFileFilteringOptions: vi.fn().mockReturnValue(undefined),
      getDiscoveryMaxDirs: vi.fn().mockReturnValue(200),
      getMcpClientManager: vi.fn().mockReturnValue({
        getMcpInstructions: vi
          .fn()
          .mockReturnValue('MCP Instructions from config'),
      }),
    } as unknown as Config;

    await refreshServerHierarchicalMemory(mockConfig);

    expect(mockConfig.setUserMemory).toHaveBeenCalled();
    expect(mockConfig.setGeminiMdFileCount).toHaveBeenCalledWith(1);
    expect(mockConfig.setGeminiMdFilePaths).toHaveBeenCalledWith(
      expect.arrayContaining([projectRootGeminiFile]),
    );
    expect(mockConfig.setClaudeCodeDetected).toHaveBeenCalled();
  });

  it('should include MCP instructions in user memory', async () => {
    await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project content',
    );

    const mockConfig = {
      getWorkingDir: vi.fn().mockReturnValue(cwd),
      shouldLoadMemoryFromIncludeDirectories: vi.fn().mockReturnValue(false),
      getFileService: vi
        .fn()
        .mockReturnValue(new FileDiscoveryService(projectRoot)),
      getExtensionLoader: vi
        .fn()
        .mockReturnValue(new SimpleExtensionLoader([])),
      isTrustedFolder: vi.fn().mockReturnValue(true),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue([]),
      }),
      setUserMemory: vi.fn(),
      setGeminiMdFileCount: vi.fn(),
      setGeminiMdFilePaths: vi.fn(),
      setClaudeCodeDetected: vi.fn(),
      getImportFormat: vi.fn().mockReturnValue('tree'),
      getFileFilteringOptions: vi.fn().mockReturnValue(undefined),
      getDiscoveryMaxDirs: vi.fn().mockReturnValue(200),
      getMcpClientManager: vi.fn().mockReturnValue({
        getMcpInstructions: vi
          .fn()
          .mockReturnValue(
            "The following are instructions provided by the tool server 'extension-server':\n---[start of server instructions]---\nAlways be polite.\n---[end of server instructions]---",
          ),
      }),
    } as unknown as Config;

    await refreshServerHierarchicalMemory(mockConfig);

    expect(mockConfig.setUserMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.stringContaining(
          "The following are instructions provided by the tool server 'extension-server':",
        ),
      }),
    );
    expect(mockConfig.setUserMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.stringContaining('Always be polite.'),
      }),
    );
  });
});
