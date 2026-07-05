const MASTHEAD_HOOK_MARKER = "masthead-hook.js";
const DEFAULT_TIMEOUT_SECONDS = 1;
const REQUIRED_HOOK_EVENTS = ["SessionStart", "PermissionRequest", "PostToolUse", "Stop"] as const;

export type HookEventName = string;

export type CodexCommandHook = {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
  commandWindows?: string;
  command_windows?: string;
  [key: string]: unknown;
};

export type CodexHookMatcherGroup = {
  matcher?: string;
  hooks?: CodexCommandHook[];
  [key: string]: unknown;
};

export type CodexHookConfig = {
  hooks?: Partial<Record<string, CodexHookMatcherGroup[]>>;
  [key: string]: unknown;
};

export type HookInstallOptions = {
  command: string;
  events?: readonly string[];
  timeout?: number;
  statusMessage?: string;
};

export type HookVerifyResult = {
  installed: boolean;
  missingEvents: HookEventName[];
  mismatchedEvents: HookEventName[];
};

export function installMastheadHookConfig(config: CodexHookConfig, options: HookInstallOptions): Required<CodexHookConfig> {
  const next = cloneConfig(config);
  next.hooks ??= {};

  for (const eventName of requiredEvents(options.events)) {
    let repairedExistingHook = false;
    const groups = [...(next.hooks[eventName] ?? [])].map((group) => {
      const nextGroup = cloneGroup(group);
      if (!isOfficialGroup(nextGroup)) return nextGroup;
      nextGroup.hooks = nextGroup.hooks.map((entry) => {
        if (!isMastheadHook(entry)) return entry;
        repairedExistingHook = true;
        return mastheadHook(options);
      });
      return nextGroup;
    });
    if (!repairedExistingHook) {
      groups.push({
        matcher: "*",
        hooks: [mastheadHook(options)]
      });
    }
    next.hooks[eventName] = groups;
  }

  return next as Required<CodexHookConfig>;
}

export function uninstallMastheadHookConfig(config: CodexHookConfig): Required<CodexHookConfig> {
  const next = cloneConfig(config);
  next.hooks ??= {};

  for (const [eventName, groups] of Object.entries(next.hooks)) {
    next.hooks[eventName] = (groups ?? [])
      .map(cloneGroup)
      .map(removeMastheadHooksFromGroup)
      .filter((group) => !isOfficialGroup(group) || (group.hooks ?? []).length > 0);
  }

  return next as Required<CodexHookConfig>;
}

export function verifyMastheadHookConfig(config: CodexHookConfig, expected?: Partial<HookInstallOptions>): HookVerifyResult {
  const hooks = config.hooks ?? {};
  const missingEvents: HookEventName[] = [];
  const mismatchedEvents: HookEventName[] = [];

  for (const eventName of requiredEvents(expected?.events)) {
    const handlers = (hooks[eventName] ?? [])
      .filter(isOfficialGroup)
      .flatMap((group) => group.hooks)
      .filter(isMastheadHook);

    if (handlers.length === 0) {
      missingEvents.push(eventName);
      continue;
    }

    if (expected && !handlers.some((handler) => matchesExpectedHook(handler, expected))) {
      mismatchedEvents.push(eventName);
    }
  }

  return {
    installed: missingEvents.length === 0 && mismatchedEvents.length === 0,
    missingEvents,
    mismatchedEvents
  };
}

export function plannedMastheadHookConfig(config: CodexHookConfig, options: HookInstallOptions): Required<CodexHookConfig> {
  return installMastheadHookConfig(config, options);
}

export function requiredHookEvents(): HookEventName[] {
  return [...REQUIRED_HOOK_EVENTS];
}

function requiredEvents(events: readonly string[] | undefined): readonly string[] {
  return events?.length ? events : REQUIRED_HOOK_EVENTS;
}

function mastheadHook(options: HookInstallOptions): CodexCommandHook {
  const hook: CodexCommandHook = {
    type: "command",
    command: options.command,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_SECONDS
  };

  if (options.statusMessage) hook.statusMessage = options.statusMessage;
  return hook;
}

function isMastheadHook(entry: unknown): entry is CodexCommandHook {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    entry.type === "command" &&
    "command" in entry &&
    typeof entry.command === "string" &&
    entry.command.includes(MASTHEAD_HOOK_MARKER)
  );
}

function matchesExpectedHook(handler: CodexCommandHook, expected: Partial<HookInstallOptions>): boolean {
  if (expected.command && handler.command !== expected.command) return false;
  if (expected.timeout !== undefined && handler.timeout !== expected.timeout) return false;
  if (expected.statusMessage !== undefined && handler.statusMessage !== expected.statusMessage) return false;
  return true;
}

function removeMastheadHooksFromGroup(group: CodexHookMatcherGroup): CodexHookMatcherGroup {
  if (!isOfficialGroup(group)) return group;
  return {
    ...group,
    hooks: (group.hooks ?? []).filter((entry) => !isMastheadHook(entry))
  };
}

function isOfficialGroup(group: CodexHookMatcherGroup): group is CodexHookMatcherGroup & { hooks: CodexCommandHook[] } {
  return Array.isArray(group.hooks);
}

function cloneGroup(group: CodexHookMatcherGroup): CodexHookMatcherGroup {
  if (!isOfficialGroup(group)) return { ...group };
  return {
    ...group,
    hooks: [...group.hooks]
  };
}

function cloneConfig(config: CodexHookConfig): CodexHookConfig {
  return structuredClone(config);
}
