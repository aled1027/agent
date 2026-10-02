// @ts-nocheck
import { execFileSync } from "node:child_process";

const pane = process.env.TMUX_PANE;
const option = "@schmuck-pi-status";
let sequence = Date.now();

export default function (pi) {
  let enabled = false;
  let active = false;
  let prompts = 0;
  let last = null;

  function publish(state) {
    if (!enabled || state === last) return;
    try {
      const args = state
        ? ["set-option", "-p", "-t", pane, option, `${state}:${process.pid}:${++sequence}`]
        : ["set-option", "-p", "-u", "-t", pane, option];
      execFileSync("tmux", args, { stdio: "ignore", timeout: 500 });
      last = state;
    } catch {}
  }

  pi.on("session_start", (_event, ctx) => {
    enabled = ctx?.mode === "tui" && !!pane;
    active = enabled && ctx?.isIdle?.() === false;
    publish(active ? "running" : undefined);
  });

  pi.on("agent_start", () => {
    if (!enabled) return;
    active = true;
    publish(prompts ? "blocked" : "running");
  });

  pi.on("ui_prompt_start", () => {
    if (!enabled || !active) return;
    prompts += 1;
    publish("blocked");
  });

  pi.on("ui_prompt_end", () => {
    if (!enabled || !active) return;
    prompts = Math.max(0, prompts - 1);
    publish(prompts ? "blocked" : "running");
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!enabled || ctx?.isIdle?.() !== true) return;
    active = false;
    prompts = 0;
    publish("done");
  });

  pi.on("session_shutdown", () => publish(undefined));
}
