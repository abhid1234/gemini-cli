/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resumeCommand } from './resumeCommand.js';
import type { CommandContext } from './types.js';
import { SessionSelector } from '../../utils/sessionUtils.js';

vi.mock('../../utils/sessionUtils.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/sessionUtils.js')>();
  return {
    ...actual,
    SessionSelector: vi.fn(),
  };
});

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    uiTelemetryService: {
      hydrate: vi.fn(),
    },
  };
});

describe('resumeCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      services: {
        config: {
          setSessionId: vi.fn(),
          getGeminiClient: vi.fn().mockReturnValue({
            setHistory: vi.fn(),
          }),
        },
      },
    } as unknown as CommandContext;
  });

  it('should open the session browser for bare /resume', async () => {
    const result = await resumeCommand.action?.(mockContext, '');
    expect(result).toEqual({
      type: 'dialog',
      dialog: 'sessionBrowser',
    });
  });

  it('should resume session by ID/index if argument is provided', async () => {
    const mockSessionData = {
      sessionId: 'test-session-id',
      messages: [
        { type: 'user', content: 'Hello' },
        { type: 'gemini', content: 'Hi there' },
      ],
    };

    const mockResolveSession = vi.fn().mockResolvedValue({
      sessionData: mockSessionData,
    });

    vi.mocked(SessionSelector).mockImplementation(
      () =>
        ({
          resolveSession: mockResolveSession,
        }) as unknown as SessionSelector,
    );

    const result = await resumeCommand.action?.(mockContext, '1');

    expect(mockResolveSession).toHaveBeenCalledWith('1');
    expect(mockContext.services.config?.setSessionId).toHaveBeenCalledWith(
      'test-session-id',
    );
    expect(result).toMatchObject({
      type: 'load_history',
    });
    if (result?.type === 'load_history') {
      expect(result.history).toHaveLength(2);
      expect(result.clientHistory).toHaveLength(2);
    }
  });

  it('should return error message if session resolution fails', async () => {
    const mockResolveSession = vi
      .fn()
      .mockRejectedValue(new Error('Session not found'));

    vi.mocked(SessionSelector).mockImplementation(
      () =>
        ({
          resolveSession: mockResolveSession,
        }) as unknown as SessionSelector,
    );

    const result = await resumeCommand.action?.(mockContext, '999');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to resume session "999": Session not found',
    });
  });

  it('should expose unified chat subcommands directly under /resume', () => {
    const visibleSubCommandNames = (resumeCommand.subCommands ?? [])
      .filter((subCommand) => !subCommand.hidden)
      .map((subCommand) => subCommand.name);

    expect(visibleSubCommandNames).toEqual(
      expect.arrayContaining(['list', 'save', 'resume', 'delete', 'share']),
    );
  });
});
