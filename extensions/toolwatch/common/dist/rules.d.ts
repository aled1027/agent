/**
 * Rules evaluation engine.
 * Matches tool call events against rules and returns approval decisions.
 */
import type { ToolCallEvent, Rule, ApprovalResponse } from "./types.js";
/**
 * Find the first matching rule for an event.
 */
export declare function findMatchingRule(event: ToolCallEvent, rules: Rule[]): Rule | undefined;
/**
 * Result of rules evaluation.
 */
export interface RulesResult {
    /** Immediate response (for allow/deny actions) */
    response: ApprovalResponse;
    /** Plugin to invoke (for plugin action) */
    pluginName?: string;
    /** Whether manual approval is required */
    requiresManual?: boolean;
    /** The matched rule (for logging/debugging) */
    matchedRule?: Rule;
}
/**
 * Evaluate rules against an event.
 * Returns immediate response for allow/deny, or plugin name for plugin action.
 */
export declare function evaluateRules(event: ToolCallEvent, rules: Rule[]): RulesResult;
