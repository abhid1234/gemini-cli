/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'comment-json';

const execAsync = promisify(exec);

import type {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
} from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { SettingScope } from '../../config/settings.js';

import * as os from 'node:os';

const cleanClaudeContent = (content: string): string => {
  let cleaned = content
    // 1. Branding Scrub
    .replace(/CLAUDE\.md/gi, 'GEMINI.md')
    .replace(/Claude Code/gi, 'Gemini CLI')
    .replace(/Claude/gi, 'Gemini')
    .replace(/## Claude Added Memories/gi, '## Gemini Added Memories')

    // 2. Terminology Mapping (Gemini-specific patterns)
    .replace(/\bsubagents\b/gi, 'parallel tool execution')
    .replace(/\bsub-agents\b/gi, 'parallel tool execution')
    .replace(/\bsubagent\b/gi, 'sub-agent')

    // 3. Remove Redundant Memory Tool instructions
    .replace(/^.*update MEMORY\.md.*$/gim, '')
    .replace(/^.*maintain MEMORY\.md.*$/gim, '')
    .replace(/^.*MEMORY\.md should.*$/gim, '');

  return cleaned.trim();
};

const addGeminiProTips = (content: string): string => {
  let updated = content;
  if (!updated.includes('Gemini CLI Optimization Guide')) {
    updated += `

## Gemini CLI Optimization Guide (Post-Migration)
- **Modular Imports:** Use \`@path/to/file.md\` to keep this file lean and pull in external context dynamically.
- **Execution Protocols:** Define workflows in XML-like tags (e.g., \`<PROTOCOL:PLAN>\`) to enforce step-by-step logic.
- **Native Commands:** Refactor complex Markdown skills into \`.gemini/commands/*.toml\` for better argument parsing.
- **Token Capacity:** You have 1M+ tokens. Feel free to include comprehensive project maps and dependency trees.`;
  }

  if (!updated.toLowerCase().includes('## gemini added memories')) {
    updated += '\n\n## Gemini Added Memories\n';
  }
  return updated;
};

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  hooks?: Record<
    string,
    Array<{
      matcher: string;
      hooks: Array<{ type?: string; command?: string }>;
    }>
  >;
  approvedCommands?: string[];
}

const migrateClaudeAction = async (
  context: CommandContext,
): Promise<SlashCommandActionReturn> => {
  const startTime = Date.now();
  const { config, settings } = context.services;
  if (!config || !settings) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Config or settings not loaded.',
    };
  }

  const cwd = process.cwd();
  const reports: string[] = [];
  let migratedAny = false;

  // Track detailed stats for the summary
  const stats = {
    mdCloned: false,
    ignoreCloned: false,
    mcpCount: 0,
    mcpNames: [] as string[],
    skillsCount: 0,
    skillsNames: [] as string[],
    commandsCount: 0,
    commandsNames: [] as string[],
    hooksCount: 0,
    scriptsUpdated: 0,
    policyGenerated: false,
  };

  context.ui.addItem({
    type: MessageType.INFO,
    text: '> 📦 **Migrating your workflow...**',
  });

  // 1. Migrate CLAUDE.md to GEMINI.md (with @imports for skills)
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const geminiMdPath = path.join(cwd, 'GEMINI.md');

  try {
    await fs.access(claudeMdPath);
    const claudeMdContent = await fs.readFile(claudeMdPath, 'utf-8');

    migratedAny = true;

    try {
      await fs.access(geminiMdPath);
      const existingContent = await fs.readFile(geminiMdPath, 'utf-8');
      const cleaned = addGeminiProTips(cleanClaudeContent(existingContent));
      if (cleaned !== existingContent) {
        await fs.writeFile(geminiMdPath, cleaned);
        reports.push(
          'Optimized existing **GEMINI.md** with Gemini-specific patterns.',
        );
      } else {
        reports.push('**GEMINI.md** already exists and is optimized.');
      }
    } catch (err: unknown) {
       
      const error = err as Error & { code?: string };
      if (error.code === 'ENOENT') {
        const cleanedContent = addGeminiProTips(
          cleanClaudeContent(claudeMdContent),
        );
        await fs.writeFile(geminiMdPath, cleanedContent);
        stats.mdCloned = true;
      } else {
        reports.push(`❌ Error accessing/writing GEMINI.md: ${error.message}`);
      }
    }
  } catch (err: unknown) {
     
    const error = err as Error & { code?: string };
    if (error.code !== 'ENOENT') {
      reports.push(`❌ Error accessing CLAUDE.md: ${error.message}`);
    }
  }

  // 1.5 Migrate .claudeignore to .geminiignore
  const claudeIgnorePath = path.join(cwd, '.claudeignore');
  const geminiIgnorePath = path.join(cwd, '.geminiignore');
  try {
    const ignoreContent = await fs.readFile(claudeIgnorePath, 'utf-8');
    const cleanedIgnore = ignoreContent.replace(/\.claude/g, '.gemini');
    try {
      await fs.access(geminiIgnorePath);
      reports.push(
        '**.geminiignore** already exists, skipping **.claudeignore** clone.',
      );
    } catch {
      await fs.writeFile(geminiIgnorePath, cleanedIgnore);
      stats.ignoreCloned = true;
      migratedAny = true;
    }
  } catch {
    // .claudeignore doesn't exist
  }

  // 2. Migrate MCP servers (Old .claude.json, Global config, and Nested Project settings)
  const migrateMcpServers = async (
    filePath: string,
    scope: SettingScope,
    prefix: string = '',
  ) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
       
      const claudeConfig = parse(content) as unknown as ClaudeConfig;

      if (claudeConfig.mcpServers) {
        // Get the full current settings for the specified scope
         
        const settingsFile = settings.forScope(scope as any);
        const currentMcpServers = (settingsFile.settings.mcpServers ||
          {}) as Record<string, unknown>;

        const newMcpServers = { ...currentMcpServers };
        let added = 0;

        for (const [name, serverConfig] of Object.entries(
          claudeConfig.mcpServers,
        )) {
          if (!stats.mcpNames.includes(`${prefix}${name}`)) {
            stats.mcpNames.push(`${prefix}${name}`);
          }
          if (!newMcpServers[name]) {
            newMcpServers[name] = serverConfig;
            added++;
          }
        }
        if (added > 0) {
           
          settings.setValue(scope as any, 'mcpServers', newMcpServers);
          migratedAny = true;
        }
      }
    } catch (error: unknown) {
      // Only log if it's an error other than "file not found"
       
      const err = error as Error & { code?: string };
      if (err.code !== 'ENOENT') {
        reports.push(`❌ Error reading ${filePath}: ${err.message}`);
      }
    }
  };

  const globalClaudePath = path.join(os.homedir(), '.claude.json');

  // 2.1 First, try to find project-specific settings inside the global config
  try {
    const content = await fs.readFile(globalClaudePath, 'utf-8');
     
    const globalConfig = JSON.parse(content) as any;
     
    if (globalConfig.projects) {
      // Find all projects in the config that are parents of (or equal to) the current directory
       
      const relevantProjectPaths = Object.keys(globalConfig.projects).filter(
        (p) => cwd === p || cwd.startsWith(p + path.sep) || p === os.homedir(),
      );

      // Sort by length descending so we pick up the most specific settings first if there are overlaps
      relevantProjectPaths.sort((a, b) => b.length - a.length);

      for (const projectPath of relevantProjectPaths) {
         
        const projectData = globalConfig.projects[projectPath];
         
        if (
          projectData.mcpServers &&
           
          Object.keys(projectData.mcpServers).length > 0
        ) {
          const isGlobal = projectPath === os.homedir();

          const scope = isGlobal ? SettingScope.User : SettingScope.Workspace;
           
          const settingsFile = settings.forScope(scope as any);
          const currentMcpServers = (settingsFile.settings.mcpServers ||
            {}) as Record<string, unknown>;
          const newMcpServers = { ...currentMcpServers };
          let added = 0;

           
          for (const [name, serverConfig] of Object.entries(
            projectData.mcpServers,
          )) {
            if (!stats.mcpNames.includes(name)) {
              stats.mcpNames.push(name);
            }
            if (!newMcpServers[name]) {
              newMcpServers[name] = serverConfig;
              added++;
            }
          }

          if (added > 0) {
             
            settings.setValue(scope as any, 'mcpServers', newMcpServers);
            stats.mcpCount += added;
            migratedAny = true;
            reports.push(
              `Found and migrated MCP settings from Claude project: **${projectPath}**`,
            );
          }
        }
      }
    }
  } catch {
    // Global config not found or unparseable
  }

  // 2.2 Migrate legacy .claude.json and global servers
  await migrateMcpServers(
    path.join(cwd, '.claude.json'),
    SettingScope.Workspace,
    '',
  );
  await migrateMcpServers(globalClaudePath, SettingScope.User, '(Global) ');

  // 3. Migrate Skills (.claude/skills/* -> .gemini/skills/*)
  const claudeSkillsDir = path.join(cwd, '.claude', 'skills');
  const geminiSkillsDir = path.join(cwd, '.gemini', 'skills');
  const migratedSkills: string[] = [];

  // Get existing skill names to prevent conflicts
  const skillManager = config.getSkillManager();
  const existingSkillNames = new Set(
    skillManager.getAllSkills().map((s) => s.name),
  );

  try {
    const entries = await fs.readdir(claudeSkillsDir, { withFileTypes: true });
    if (entries.length > 0) {
      await fs.mkdir(geminiSkillsDir, { recursive: true });

      for (const entry of entries) {
        let skillName = entry.name.replace(/\.md$/, '');

        // Handle conflict with existing Gemini skills (like find-skills)
        if (existingSkillNames.has(skillName)) {
          skillName = `claude-${skillName}`;
        }

        if (!stats.skillsNames.includes(skillName)) {
          stats.skillsNames.push(skillName);
          stats.skillsCount++;
        }
        if (!migratedSkills.includes(skillName)) {
          migratedSkills.push(skillName);
        }

        const targetSkillDir = path.join(geminiSkillsDir, skillName);
        const targetSkillFile = path.join(targetSkillDir, 'SKILL.md');

        try {
          await fs.access(targetSkillFile);
          continue;
        } catch {
          // Proceed
        }

        let skillContent = '';
        if (entry.isDirectory()) {
          const sourceSkillFile = path.join(
            claudeSkillsDir,
            entry.name,
            'SKILL.md',
          );
          try {
            skillContent = await fs.readFile(sourceSkillFile, 'utf-8');
          } catch {
            try {
              skillContent = await fs.readFile(
                path.join(claudeSkillsDir, entry.name, 'index.md'),
                'utf-8',
              );
            } catch {
              continue;
            }
          }
        } else if (entry.name.endsWith('.md')) {
          skillContent = await fs.readFile(
            path.join(claudeSkillsDir, entry.name),
            'utf-8',
          );
        }

        if (skillContent) {
          await fs.mkdir(targetSkillDir, { recursive: true });
          // Apply cleaning to skill content
          skillContent = cleanClaudeContent(skillContent);

          // Ensure YAML frontmatter if missing (Gemini style)
          if (!skillContent.trim().startsWith('---')) {
            skillContent = `---\nname: ${skillName}\ndescription: Migrated from Claude Code\n---\n\n${skillContent}`;
          } else {
            // Update name in existing frontmatter if it was prefixed
            skillContent = skillContent.replace(
              /^name:.*$/m,
              `name: ${skillName}`,
            );
          }
          await fs.writeFile(targetSkillFile, skillContent);
        }
      }

      if (stats.skillsCount > 0) {
        migratedAny = true;

        try {
          const currentGeminiMd = await fs.readFile(geminiMdPath, 'utf-8');
          const imports = migratedSkills
            .map((s) => `@.gemini/skills/${s}/SKILL.md`)
            .join('\n');
          if (!currentGeminiMd.includes(imports)) {
            await fs.writeFile(
              geminiMdPath,
              `${currentGeminiMd}\n\n# Migrated Skills\n${imports}\n`,
            );
            reports.push('✅ Added modular **@imports** to **GEMINI.md**');
          }
        } catch {
          // GEMINI.md might not exist
        }
      }
    }
  } catch (error: unknown) {
     
    const err = error as Error & { code?: string };
    if (err.code !== 'ENOENT') {
      reports.push(`❌ Error migrating skills: ${err.message}`);
    }
  }

  // 4. Migrate Custom Commands (.claude/commands/*.md -> .gemini/commands/*.toml)
  const claudeCommandsDir = path.join(cwd, '.claude', 'commands');
  const geminiCommandsDir = path.join(cwd, '.gemini', 'commands');

  try {
    const files = await fs.readdir(claudeCommandsDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length > 0) {
      await fs.mkdir(geminiCommandsDir, { recursive: true });

      for (const file of mdFiles) {
        const commandName = path.basename(file, '.md');
        if (!stats.commandsNames.includes(commandName)) {
          stats.commandsCount++;
          stats.commandsNames.push(commandName);
        }

        const geminiCommandPath = path.join(
          geminiCommandsDir,
          `${commandName}.toml`,
        );

        try {
          await fs.access(geminiCommandPath);
          continue;
        } catch {
          // Proceed
        }

        const content = await fs.readFile(
          path.join(claudeCommandsDir, file),
          'utf-8',
        );
        // Apply cleaning to command prompt
        const cleanedContent = cleanClaudeContent(content);
        const translatedPrompt = cleanedContent
          .replace(/\$ARGUMENTS/g, '{{args}}')
          .trim();

        const tomlContent = `description = "Migrated from Claude Code: /${commandName}"\nprompt = """\n${translatedPrompt}\n"""\n`;
        await fs.writeFile(geminiCommandPath, tomlContent);
      }

      if (stats.commandsCount > 0) {
        migratedAny = true;
      }
    }
  } catch (error: unknown) {
     
    const err = error as Error & { code?: string };
    if (err.code !== 'ENOENT') {
      reports.push(`❌ Error migrating custom commands: ${err.message}`);
    }
  }

  // 5. Migrate Hooks (.claude/settings.json -> .gemini/settings.json)
  const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');
  try {
    const content = await fs.readFile(claudeSettingsPath, 'utf-8');
     
    const claudeSettings = parse(content) as unknown as ClaudeConfig;

    if (claudeSettings.hooks) {
      const workspaceSettings = settings.forScope(
        SettingScope.Workspace,
      ).settings;
      const currentHooks = workspaceSettings.hooks || {};
      const newHooks = { ...currentHooks };

      const eventMap: Record<string, string> = {
        PostToolUse: 'AfterTool',
        PreToolUse: 'BeforeTool',
        SessionStart: 'SessionStart',
      };

      const toolMap: Record<string, string> = {
        Edit: 'replace',
        Write: 'write_file',
        Bash: 'run_shell_command',
        Read: 'read_file',
        Grep: 'grep_search',
        Glob: 'glob',
      };

      let hooksAdded = 0;
      for (const [claudeEvent, claudeHookList] of Object.entries(
        claudeSettings.hooks,
      )) {
        const geminiEvent = eventMap[claudeEvent];
        if (!geminiEvent) continue;

        if (!(newHooks as Record<string, unknown[]>)[geminiEvent]) {
          (newHooks as Record<string, unknown[]>)[geminiEvent] = [];
        }

        for (const entry of claudeHookList) {
          stats.hooksCount++;
          let translatedMatcher = entry.matcher;
          for (const [claudeTool, geminiTool] of Object.entries(toolMap)) {
            translatedMatcher = translatedMatcher.replace(
              new RegExp(`\\b${claudeTool}\\b`, 'g'),
              geminiTool,
            );
          }

          const geminiEntry = {
            matcher: translatedMatcher,
            hooks: (entry.hooks || []).map((h) => ({
              type: h.type || 'command',
              command: h.command?.replace(/\$CLAUDE_/g, '$GEMINI_'),
            })),
          };

           
          const exists = (
            (newHooks as Record<string, unknown[]>)[geminiEvent] || []
          ).some((existing: any) => {
             
            return (
              existing.matcher === geminiEntry.matcher &&
              JSON.stringify(existing.hooks) ===
                JSON.stringify(geminiEntry.hooks)
            );
          });

          if (!exists) {
            (newHooks as Record<string, unknown[]>)[geminiEvent].push(
              geminiEntry,
            );
            hooksAdded++;
          }
        }
      }

      if (hooksAdded > 0) {
        settings.setValue(SettingScope.Workspace, 'hooks', newHooks);
        migratedAny = true;
      }
    }
  } catch (error: unknown) {
     
    const err = error as Error & { code?: string };
    if (err.code !== 'ENOENT') {
      reports.push(`❌ Error migrating hooks: ${err.message}`);
    }
  }

  // 6. Scripts: Smart find-and-replace claude -> gemini
  try {
    const scripts = await fs.readdir(cwd);
    const bashScripts = scripts.filter(
      (s) => s.endsWith('.sh') || s.endsWith('.bash'),
    );

    for (const script of bashScripts) {
      const scriptPath = path.join(cwd, script);
      const content = await fs.readFile(scriptPath, 'utf-8');

      if (
        content.includes('claude ') ||
        content.includes('gemini --output-format json ')
      ) {
        stats.scriptsUpdated++;
        const updatedContent = content.replace(
          /claude\s/g,
          'gemini --output-format json ',
        );
        if (updatedContent !== content) {
          await fs.writeFile(scriptPath, updatedContent);
        }
      }
    }

    if (stats.scriptsUpdated > 0) {
      migratedAny = true;
    }
  } catch {
    // Ignore
  }

  // 7. Permissions: Policy Engine Suggestion
  const claudeLocalSettingsPath = path.join(
    cwd,
    '.claude',
    'settings.local.json',
  );
  try {
    const content = await fs.readFile(claudeLocalSettingsPath, 'utf-8');
     
    const localSettings = parse(content) as unknown as ClaudeConfig;

    if (
      localSettings.approvedCommands &&
      localSettings.approvedCommands.length > 0
    ) {
      const policyPath = path.join(cwd, '.gemini', 'suggested_policy.toml');
      let policyContent =
        '# Suggested policy migrated from Claude Code\n# Move this to ~/.gemini/policies/ to apply\n\n';

      for (const cmd of localSettings.approvedCommands) {
        policyContent += `[[rule]]\ntoolName = "run_shell_command"\ncommandPrefix = "${cmd}"\ndecision = "allow"\npriority = 100\n\n`;
      }

      await fs.writeFile(policyPath, policyContent);
      stats.policyGenerated = true;
      migratedAny = true;
    }
  } catch {
    // Skip
  }

  if (!migratedAny && reports.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No Claude Code artifacts found to migrate in this directory.',
    };
  }

  if (migratedAny) {
    if (stats.mcpNames.length > 0) {
      const mcpClientManager = config.getMcpClientManager();
      if (mcpClientManager) {
        context.ui.addItem({
          type: MessageType.INFO,
          text: 'Restarting MCP servers to apply new configurations...',
        });
        await mcpClientManager.restart();
      }
    }
  }

  // 8. Self-Diagnostic Turn
  let diagnosticResult = 'Skipped (no scripts found)';
  let diagnosticPassed = true;

  try {
    const pkgJsonPath = path.join(cwd, 'package.json');
     
    const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8')) as any;
     
    const scripts = pkgJson.scripts || {};

    // Broaden search for relevant diagnostic scripts
     
    const diagnosticCmd = scripts.typecheck
      ? 'npm run typecheck'
      :  
        scripts['lint:ci']
        ? 'npm run lint:ci'
        :  
          scripts.lint
          ? 'npm run lint'
          : null;

    if (diagnosticCmd) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: `🔍 **Running Self-Diagnostic (${diagnosticCmd})...**`,
      });

      try {
        await execAsync(diagnosticCmd, { cwd });
        diagnosticResult = 'Passed ✅';
      } catch (err: unknown) {
        diagnosticPassed = false;
         
        const errorOutput = (
          ((err as any).stdout || '') + ((err as any).stderr || '')
        ).toString();
        let hint = '';
        if (
          errorOutput.includes('command not found') ||
          errorOutput.includes('node_modules missing')
        ) {
          hint =
            '\n\n💡 Tip: It looks like project dependencies are missing. Try running pnpm install or npm install in your project directory.';
        }
         
        diagnosticResult = `Failed ❌\n\n\`\`\`\n${
          errorOutput || (err as any).message
        }\n\`\`\`${hint}`;
      }
    }
  } catch {
    // Ignore errors reading package.json
  }

  // Build the final summary message
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  const formattedSummary = [
    stats.mdCloned && `- ✅ Migrated CLAUDE.md into GEMINI.md`,
    stats.ignoreCloned && `- ✅ Migrated .claudeignore to .geminiignore`,
    stats.mcpNames.length > 0 &&
      `- ✅ Connected ${stats.mcpNames.length} MCP Server(s) (${stats.mcpNames.join(', ')})`,
    stats.skillsCount > 0 &&
      `- ✅ Ported ${stats.skillsCount} skill(s) to .gemini/skills/`,
    stats.commandsCount > 0 &&
      `- ✅ Ported ${stats.commandsCount} custom slash command(s)`,
    stats.hooksCount > 0 &&
      `- ✅ Migrated ${stats.hooksCount} automated hook(s)`,
    stats.scriptsUpdated > 0 &&
      `- ✅ Updated ${stats.scriptsUpdated} script(s) with gemini --output-format json`,
    stats.policyGenerated &&
      `- ✅ Generated suggested policy in .gemini/suggested_policy.toml`,
    ...reports.map((r) => {
      if (r.includes('@imports'))
        return `- 🔗 Added modular @imports to GEMINI.md`;
      if (r.includes('Optimized') || r.includes('exists')) return `- ✅ ${r}`;
      return `- ${r}`;
    }),
    `- 🩺 **Self-Diagnostic:** ${diagnosticResult}`,
  ]
    .filter(Boolean)
    .join('\n');

  const finalMessage = `
📦 Migrating your workflow...
${formattedSummary}

🚀 Migration complete in ${duration}s.

${
  !diagnosticPassed
    ? `⚠️ Warning: The self-diagnostic found potential issues. Please review the output above to ensure no logic-critical strings were broken during replacement.\n\n`
    : ''
}💡 Note: We migrated automated hooks to .gemini/settings.json. You will see a standard security warning when these hooks are detected—this is normal for project-level automation.

💡 Quick Tip: In Gemini CLI, typing /exit or pressing Ctrl+C quits instantly. No hanging. We promise. 😉`;

  return {
    type: 'message',
    messageType: 'info',
    content: finalMessage.trim(),
  };
};

const claudeSubCommand: SlashCommand = {
  name: 'claude',
  description:
    'Migrate Claude Code artifacts (CLAUDE.md, .claude.json) to Gemini',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: migrateClaudeAction,
};

export const migrateCommand: SlashCommand = {
  name: 'migrate',
  description: 'Migrate settings and context from other AI tools',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [claudeSubCommand],
  action: async () => ({
    type: 'message',
    messageType: 'info',
    content: 'Usage: /migrate claude',
  }),
};
