/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import { migrateCommand } from './migrateCommand.js';
import { type CommandContext } from './types.js';
import { SettingScope } from '../../config/settings.js';

vi.mock('node:fs/promises');
vi.mock('comment-json', () => ({
  parse: (text: string) => {
    if (!text || text === 'undefined') throw new Error('Invalid JSON');
    return JSON.parse(text);
  },
}));

describe('migrateCommand', () => {
  let mockContext: CommandContext;
  const claudeSubCommand = migrateCommand.subCommands![0];

  beforeEach(() => {
    vi.resetAllMocks();
    mockContext = {
      services: {
        config: {
          getSkillManager: vi.fn().mockReturnValue({
            getAllSkills: vi.fn().mockReturnValue([]),
          }),
          getMcpClientManager: vi.fn().mockReturnValue({
            restart: vi.fn().mockResolvedValue(undefined),
          }),
        },
        settings: {
          getWorkspace: vi.fn().mockReturnValue({}),
          getGlobal: vi.fn().mockReturnValue({}),
          forScope: vi.fn().mockReturnValue({ settings: {} }),
          merged: {},
          setValue: vi.fn(),
        },
      },
      ui: {
        addItem: vi.fn(),
        slashCommands: [],
      },
    } as unknown as CommandContext;

    // Default: files don't exist
    vi.mocked(fs.access).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.readdir).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
  });

  describe('/migrate claude', () => {
    it('should migrate CLAUDE.md to GEMINI.md', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (p.toString().endsWith('CLAUDE.md')) return undefined;
        throw { code: 'ENOENT' };
      });
      vi.mocked(fs.readFile).mockResolvedValue('Claude instructions');

      await claudeSubCommand.action(mockContext, '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('GEMINI.md'),
        expect.stringContaining('Gemini CLI Optimization Guide'),
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('GEMINI.md'),
        expect.stringContaining('## Gemini Added Memories'),
      );
    });

    it('should skip CLAUDE.md migration if GEMINI.md already exists and is clean', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // All files exist

      // The content must match exactly what cleanClaudeContent + addGeminiProTips produces to avoid a rewrite.
      // Note the order: Cleaned content -> Optimization Guide -> Added Memories
      const optimizedContent = `Gemini instructions

## Gemini CLI Optimization Guide (Post-Migration)
- **Modular Imports:** Use \`@path/to/file.md\` to keep this file lean and pull in external context dynamically.
- **Execution Protocols:** Define workflows in XML-like tags (e.g., \`<PROTOCOL:PLAN>\`) to enforce step-by-step logic.
- **Native Commands:** Refactor complex Markdown skills into \`.gemini/commands/*.toml\` for better argument parsing.
- **Token Capacity:** You have 1M+ tokens. Feel free to include comprehensive project maps and dependency trees.

## Gemini Added Memories`;

      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('CLAUDE.md')) return 'Claude instructions';
        if (p.toString().endsWith('GEMINI.md')) return optimizedContent;
        if (p.toString().endsWith('.json')) return '{}';
        return '';
      });
      vi.mocked(fs.readdir).mockResolvedValue([]);

      await claudeSubCommand.action(mockContext, '');

      // Should not call writeFile for GEMINI.md since it's already clean
      const writeFileCalls = vi.mocked(fs.writeFile).mock.calls;
      const geminiMdWrite = writeFileCalls.find((call) =>
        call[0].toString().endsWith('GEMINI.md'),
      );
      expect(geminiMdWrite).toBeUndefined();
    });

    it('should migrate MCP servers from .claude.json', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (p.toString().endsWith('.claude.json')) return undefined;
        throw { code: 'ENOENT' };
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            'test-server': { command: 'node', args: ['test.js'] },
          },
        }),
      );

      await claudeSubCommand.action(mockContext, '');

      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.Workspace,
        'mcpServers',
        expect.objectContaining({
          'test-server': expect.anything(),
        }),
      );
    });

    it('should migrate custom commands from .claude/commands/', async () => {
      vi.mocked(fs.readdir).mockImplementation(async (p) => {
        if (p.toString().endsWith('commands'))
          return ['test.md'] as string[] as unknown;
        return [] as string[] as unknown;
      });
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('test.md')) return 'Run $ARGUMENTS';
        throw { code: 'ENOENT' };
      });

      await claudeSubCommand.action(mockContext, '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.toml'),
        expect.stringContaining('prompt = """\nRun {{args}}\n"""'),
      );
    });

    it('should migrate skills from .claude/skills/', async () => {
      vi.mocked(fs.readdir).mockImplementation(async (p) => {
        if (p.toString().endsWith('skills'))
          return [
            {
              name: 'test-skill.md',
              isDirectory: () => false,
              isFile: () => true,
            },
          ] as unknown[] as Dirent[];
        return [] as Dirent[];
      });
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('test-skill.md')) return 'Skill content';
        if (p.toString().endsWith('GEMINI.md')) return 'Existing GEMINI.md';
        throw { code: 'ENOENT' };
      });

      await claudeSubCommand.action(mockContext, '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test-skill/SKILL.md'),
        expect.stringContaining('name: test-skill'),
      );
    });

    it('should migrate hooks from .claude/settings.json with tool mapping', async () => {
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('settings.json'))
          return JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: 'Read',
                  hooks: [{ command: 'echo $CLAUDE_TOOL' }],
                },
              ],
            },
          });
        throw { code: 'ENOENT' };
      });

      await claudeSubCommand.action(mockContext, '');

      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.Workspace,
        'hooks',
        expect.objectContaining({
          BeforeTool: expect.arrayContaining([
            expect.objectContaining({
              matcher: 'read_file',
              hooks: [
                expect.objectContaining({ command: 'echo $GEMINI_TOOL' }),
              ],
            }),
          ]),
        }),
      );
    });

    it('should update bash scripts with --output-format json', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['test.sh'] as string[]);
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('test.sh')) return 'claude hello';
        throw { code: 'ENOENT' };
      });

      await claudeSubCommand.action(mockContext, '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.sh'),
        'gemini --output-format json hello',
      );
    });

    it('should generate suggested policy from .claude/settings.local.json', async () => {
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        if (p.toString().endsWith('settings.local.json'))
          return JSON.stringify({
            approvedCommands: ['ls', 'cat'],
          });
        throw { code: 'ENOENT' };
      });

      await claudeSubCommand.action(mockContext, '');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('suggested_policy.toml'),
        expect.stringContaining('commandPrefix = "ls"'),
      );
    });

    it('should return info message if no artifacts found', async () => {
      const result = await claudeSubCommand.action(mockContext, '');

      expect(result).toEqual(
        expect.objectContaining({
          messageType: 'info',
          content: expect.stringContaining('No Claude Code artifacts found'),
        }),
      );
    });
  });
});
