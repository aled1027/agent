/**
 * Generic plugin loader.
 * Loads approval plugins from file paths or builtin references.
 */
import type { ApprovalPlugin } from "./types.js";
/**
 * Pre-register a plugin instance.
 * Used to share instances between static and dynamic imports,
 * or to register builtin plugins.
 */
export declare function registerPlugin(name: string, plugin: ApprovalPlugin): void;
/**
 * Get a registered plugin by name.
 */
export declare function getPlugin(name: string): ApprovalPlugin | undefined;
/**
 * Check if a plugin is registered.
 */
export declare function hasPlugin(name: string): boolean;
/**
 * Load a plugin by name.
 *
 * @param name - Plugin name (used for cache lookup)
 * @param pluginPath - Path to plugin module, or undefined to use cache only
 * @param basePath - Base path for resolving relative plugin paths
 * @returns The loaded plugin, or undefined if not found
 */
export declare function loadPlugin(name: string, pluginPath: string | undefined, basePath?: string): Promise<ApprovalPlugin | undefined>;
/**
 * Clear the plugin cache.
 * Useful for reloading plugins or testing.
 */
export declare function clearPluginCache(): void;
/**
 * Get all registered plugin names.
 */
export declare function getRegisteredPlugins(): string[];
