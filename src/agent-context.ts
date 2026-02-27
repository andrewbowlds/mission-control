/**
 * Builds the Mission Control context string injected into every agent's
 * system prompt via the before_prompt_build hook. This teaches agents
 * about MC's capabilities and how to use them.
 */

import { getEngineStatus } from "./execution-engine.js";
import { listTasks } from "./task-engine.js";

export function buildMissionControlContext(): string {
  // Get live status summary for agents
  let statusSummary = "";
  try {
    const status = getEngineStatus();
    const pendingTasks = listTasks({ status: "pending", limit: 5 });
    const runningTasks = listTasks({ status: "running", limit: 5 });
    const waitingApproval = listTasks({ status: "waiting_approval", limit: 5 });

    const parts: string[] = [];
    parts.push(`Engine: ${status.running ? "running" : "stopped"} | Active: ${status.activeTasks} | Queued: ${status.queuedTasks} | Blocked: ${status.blockedTasks} | Pending Approvals: ${status.pendingApprovals}`);

    if (runningTasks.length > 0) {
      parts.push("Currently running tasks: " + runningTasks.map((t) => `"${t.title}" (${t.agentId})`).join(", "));
    }
    if (waitingApproval.length > 0) {
      parts.push("Awaiting approval: " + waitingApproval.map((t) => `"${t.title}"`).join(", "));
    }
    if (pendingTasks.length > 0) {
      parts.push("Pending tasks: " + pendingTasks.map((t) => `"${t.title}" [${t.priority}]`).join(", "));
    }

    statusSummary = parts.join("\n");
  } catch {
    statusSummary = "Engine status unavailable";
  }

  return `<mission-control>
# Mission Control — Agent Orchestration Platform

You have access to Mission Control, a task management and orchestration system.
Use the gateway RPC methods below to manage tasks, workflows, and integrations.

## Current Status
${statusSummary}

## Task Management (mc.tasks.*)
You can create, manage, and track tasks through Mission Control:
- \`mc.tasks.list\` — List tasks. Params: { status?: string[], parentId?: string, agentId?: string, search?: string, limit?: number, offset?: number }
- \`mc.tasks.get\` — Get task detail. Params: { id: string }
- \`mc.tasks.create\` — Create a task. Params: { title: string, description?: string, agentId: string, priority?: "critical"|"high"|"normal"|"low", parentId?: string, scheduledAt?: number, deadlineAt?: number, requiresApproval?: boolean, tags?: string[], contextJson?: string }
- \`mc.tasks.update\` — Update a task. Params: { id: string, ...fields }
- \`mc.tasks.delete\` — Delete a task. Params: { id: string }
- \`mc.tasks.queue\` — Queue a pending task. Params: { id: string }
- \`mc.tasks.cancel\` — Cancel a task. Params: { id: string }
- \`mc.tasks.retry\` — Retry a failed task. Params: { id: string }
- \`mc.tasks.addUpdate\` — Add a progress note. Params: { taskId: string, note: string, author?: string }
- \`mc.tasks.addDep\` / \`mc.tasks.removeDep\` — Manage dependencies. Params: { taskId: string, dependsOnTaskId: string }

## Approvals (mc.approvals.*)
- \`mc.approvals.list\` — List approval requests. Params: { status?: string }
- \`mc.approvals.resolve\` — Approve/reject. Params: { id: string, decision: "approved"|"rejected", note?: string }

## Workflows (mc.workflows.*)
Multi-step automated pipelines:
- \`mc.workflows.list\` / \`mc.workflows.get\` / \`mc.workflows.create\` / \`mc.workflows.delete\`
- \`mc.workflows.start\` — Run a workflow. Params: { id: string }
- \`mc.workflows.addStep\` / \`mc.workflows.updateStep\` / \`mc.workflows.removeStep\`

## Templates (mc.templates.*)
Reusable task blueprints:
- \`mc.templates.list\` / \`mc.templates.create\` / \`mc.templates.instantiate\`

## Automation Rules (mc.automations.*)
Event-driven triggers:
- \`mc.automations.list\` / \`mc.automations.create\` / \`mc.automations.update\` / \`mc.automations.delete\`
- Event types: task_completed, task_failed, cron, github_issue_opened, github_pr_opened, github_push, calendar_event_upcoming
- Action types: create_task, start_workflow, send_message

## Trello Boards (mc.trello.*)
Kanban-style project boards:
- \`mc.trello.boards.list\` / \`mc.trello.boards.create\`
- \`mc.trello.lists.create\` / \`mc.trello.cards.create\` / \`mc.trello.cards.update\` / \`mc.trello.cards.move\`

## Intelligence (mc.intelligence.*)
Smart routing and agent performance:
- \`mc.intelligence.recommend\` — Get best agent for a task. Params: { taskId: string }
- \`mc.intelligence.capabilities.list\` — View agent proficiencies. Params: { agentId?: string }
- \`mc.intelligence.capabilities.agentProfile\` — Full agent profile. Params: { agentId: string }
- \`mc.intelligence.routing.list\` / \`mc.intelligence.routing.create\` — Manage routing rules

## Analytics (mc.analytics.*)
- \`mc.analytics.overview\` — Metrics summary. Params: { from?: number, to?: number }
- \`mc.analytics.agents\` — Per-agent performance
- \`mc.analytics.throughput\` / \`mc.analytics.durations\` / \`mc.analytics.priorities\`

## CRM / People (mc.people.*)
- \`mc.people.list\` / \`mc.people.get\` / \`mc.people.create\` / \`mc.people.update\`

## Google Calendar (mc.gcal.*)
- \`mc.gcal.events.list\` — List calendar events. Params: { from?: number, to?: number }
- \`mc.gcal.sync\` — Sync from Google Calendar
- \`mc.gcal.events.create\` / \`mc.gcal.events.delete\`

## GitHub (mc.github.*)
- \`mc.github.repos.list\` / \`mc.github.issues.list\`
- \`mc.github.issues.createTask\` — Create MC task from issue. Params: { issueId: string, agentId: string }

## Chat Rooms (mc.rooms.*)
Multi-agent collaboration:
- \`mc.rooms.list\` / \`mc.rooms.create\` — Manage group chat rooms

## Guidelines
- When given a task, create it in Mission Control with \`mc.tasks.create\` so it's tracked.
- Use \`mc.tasks.addUpdate\` to log progress on tasks you're working on.
- When a task is part of a larger project, create subtasks with parentId.
- Set appropriate priority levels for time-sensitive work.
- Use tags to categorize tasks for better routing and analytics.
- For recurring work, create templates with \`mc.templates.create\`.
- Check \`mc.intelligence.recommend\` to see which agent is best suited for a task.
</mission-control>`;
}
