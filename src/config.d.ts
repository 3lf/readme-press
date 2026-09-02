import type { Diagnostic, LoadedConfig, ReadmePressConfig } from './types.d.ts';

export type { DiagnosticsMode, NetworkPolicy, RawHtmlMode, ReadmePressConfig } from './types.d.ts';

/** Preserve config inference while authoring a trusted configuration. */
export declare function defineConfig<T extends ReadmePressConfig>(config: T): T;
/** Validate config types and report or reject unknown core keys. */
export declare function validateConfig(
  value: unknown,
  options?: { strict?: boolean },
): { config: ReadmePressConfig; diagnostics: Diagnostic[] };
/** Execute, validate, normalize, and resolve a README Press config file. */
export declare function loadConfig(configFile?: string, cwd?: string): Promise<LoadedConfig>;
/** Return the installed README Press package root. */
export declare function packageRoot(): string;
