/**
 * Seeds Mission Control with business workflow templates and automation rules.
 * Runs once on startup — skips if templates already exist.
 */

import { getMcDb } from "./mc-db.js";
import { createTemplate } from "./template-store.js";
import { createRule } from "./automation-engine.js";
import { createWorkflow, addStep } from "./workflow-engine.js";

export function seedIfEmpty(): void {
  const db = getMcDb();
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM task_templates").get() as any)?.cnt ?? 0;
  if (count > 0) return; // already seeded

  console.log("[mission-control] Seeding templates, automation rules, and workflows...");

  // ── Task Templates ──────────────────────────────────────────────────────────

  const tplListingMarketing = createTemplate({
    name: "New Listing Marketing Launch",
    agentId: "faith",
    description: "Create full marketing package for a new listing: MLS copy, social posts, email blast, flyer text. Follow SKILL.md §2 New Listing Marketing Launch playbook.",
    priority: "high",
    taskType: "automated",
    requiresApproval: false,
    tags: ["marketing", "listing", "new-listing"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §2", deliverables: ["MLS copy", "social posts (3)", "email blast", "flyer text"] }),
  });

  const tplWeeklyAnalytics = createTemplate({
    name: "Weekly Marketing Summary",
    agentId: "faith",
    description: "Compile weekly marketing performance summary. Pull analytics from reports/, aggregate trends, list content published, recommend next week focus.",
    priority: "normal",
    taskType: "automated",
    tags: ["marketing", "analytics", "weekly", "report"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §5", reportPath: "reports/" }),
  });

  const tplTransactionSetup = createTemplate({
    name: "New Transaction Setup",
    agentId: "brett",
    description: "Set up a new real estate transaction with all milestone subtasks, deadline tracking, and document collection. Follow SKILL.md §2 New Transaction Setup playbook.",
    priority: "high",
    taskType: "automated",
    tags: ["transaction", "active", "new-deal"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §2" }),
  });

  const tplCommissionReview = createTemplate({
    name: "Commission Reconciliation",
    agentId: "william",
    description: "Calculate commission breakdown for a closed deal: gross commission, brokerage split, agent split, referral fees, net to brokerage. Follow SKILL.md §2.",
    priority: "normal",
    taskType: "automated",
    requiresApproval: true,
    tags: ["finance", "commission", "review"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §2" }),
  });

  const tplMonthlyPnl = createTemplate({
    name: "Monthly P&L Report",
    agentId: "william",
    description: "Generate monthly P&L report: revenue, cost of sales, operating expenses, net income, MoM and YoY comparisons.",
    priority: "normal",
    taskType: "automated",
    requiresApproval: true,
    tags: ["finance", "pnl", "monthly", "report"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §3" }),
  });

  const tplMarketPulse = createTemplate({
    name: "Weekly Market Pulse",
    agentId: "mason",
    description: "Produce weekly market pulse: active inventory, median DOM, median PPSF, notable trend callouts, watchlist neighborhoods.",
    priority: "normal",
    taskType: "automated",
    tags: ["market", "report", "weekly"],
    contextJson: JSON.stringify({ playbook: "SKILL.md - Neighborhood Trend Watch" }),
  });

  const tplCma = createTemplate({
    name: "Comparative Market Analysis",
    agentId: "mason",
    description: "Build a CMA for a specific property: select 5-7 comps, record structured data, draft narrative summary with price range and recommendations.",
    priority: "high",
    taskType: "automated",
    tags: ["market", "cma"],
    contextJson: JSON.stringify({ playbook: "SKILL.md - CMA Build Workflow" }),
  });

  const tplLeadFollowUp = createTemplate({
    name: "Lead Follow-Up",
    agentId: "apollo",
    description: "Follow up on a lead through the qualification pipeline: attempt contact, run BANT, assign nurture cadence or book appointment.",
    priority: "high",
    taskType: "automated",
    tags: ["lead", "follow-up"],
    contextJson: JSON.stringify({ playbook: "SKILL.md - Speed-to-Lead + Qualification" }),
  });

  const tplClientTouch = createTemplate({
    name: "Client Touchpoint",
    agentId: "jordan",
    description: "Execute a scheduled client touchpoint: homeversary, birthday, closing anniversary, or general check-in. Select appropriate touch type and log outcome.",
    priority: "normal",
    taskType: "automated",
    tags: ["retention", "touch"],
    contextJson: JSON.stringify({ playbook: "SKILL.md - Retention Cadence" }),
  });

  const tplTestimonialRequest = createTemplate({
    name: "Testimonial & Review Request",
    agentId: "jordan",
    description: "Request testimonial/review from a recently closed client. Send review links for Google/Zillow/Facebook. Follow up after 7 days if not posted.",
    priority: "normal",
    taskType: "automated",
    tags: ["retention", "review", "testimonial"],
    contextJson: JSON.stringify({ playbook: "SKILL.md - Review Harvesting" }),
  });

  const tplSocialMonitoring = createTemplate({
    name: "Daily Social Monitoring",
    agentId: "xavier",
    description: "Daily X/Twitter monitoring: search brand mentions, intent signals, competitor activity. Produce top 3 opportunities with suggested responses.",
    priority: "normal",
    taskType: "automated",
    tags: ["social", "x-twitter", "report", "daily"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §2 - Daily Monitoring Workflow" }),
  });

  const tplSocialPost = createTemplate({
    name: "Social Media Post Draft",
    agentId: "xavier",
    description: "Draft X/Twitter post with 3 options (safe/bold/short). Requires approval before posting.",
    priority: "normal",
    taskType: "automated",
    requiresApproval: true,
    tags: ["social", "x-twitter", "draft", "needs-approval"],
    contextJson: JSON.stringify({ playbook: "SKILL.md §3 - Post/Reply Drafting" }),
  });

  // ── Automation Rules ────────────────────────────────────────────────────────

  // When a listing task completes → trigger Faith marketing
  createRule({
    name: "New Listing → Faith Marketing",
    description: "When a task tagged 'new-listing' completes, create a marketing launch task for Faith.",
    eventType: "task_completed",
    eventFilterJson: JSON.stringify({ tags: ["new-listing"] }),
    actionType: "create_task",
    actionConfigJson: JSON.stringify({
      templateId: tplListingMarketing.id,
      title: "Marketing launch for completed listing",
    }),
    cooldownMs: 300000, // 5 min cooldown to prevent duplicates
  });

  // When a deal closes → trigger commission review for William
  createRule({
    name: "Deal Closed → Commission Review",
    description: "When a transaction task tagged 'closing' completes, create a commission review for William.",
    eventType: "task_completed",
    eventFilterJson: JSON.stringify({ tags: ["closing"] }),
    actionType: "create_task",
    actionConfigJson: JSON.stringify({
      templateId: tplCommissionReview.id,
      title: "Commission review for closed deal",
    }),
    cooldownMs: 300000,
  });

  // When a deal closes → trigger testimonial request for Jordan
  createRule({
    name: "Deal Closed → Testimonial Request",
    description: "When a transaction tagged 'post-closing' completes, create a testimonial request for Jordan.",
    eventType: "task_completed",
    eventFilterJson: JSON.stringify({ tags: ["post-closing"] }),
    actionType: "create_task",
    actionConfigJson: JSON.stringify({
      templateId: tplTestimonialRequest.id,
      title: "Request testimonial from closed client",
    }),
    cooldownMs: 300000,
  });

  // When Faith's marketing completes → trigger Xavier social post
  createRule({
    name: "Marketing Done → Xavier Social Post",
    description: "When a Faith marketing task tagged 'listing' completes, create a social post draft for Xavier.",
    eventType: "task_completed",
    eventFilterJson: JSON.stringify({ tags: ["listing", "marketing"], agentId: "faith" }),
    actionType: "create_task",
    actionConfigJson: JSON.stringify({
      templateId: tplSocialPost.id,
      title: "X/Twitter post for new listing",
    }),
    cooldownMs: 300000,
  });

  // When any task fails → send notification
  createRule({
    name: "Task Failed → Alert",
    description: "When any automated task fails, broadcast a notification for operator attention.",
    eventType: "task_failed",
    eventFilterJson: JSON.stringify({}),
    actionType: "send_message",
    actionConfigJson: JSON.stringify({
      message: "An automated task failed and may need attention.",
    }),
    cooldownMs: 60000, // 1 min cooldown
  });

  // ── Workflows ───────────────────────────────────────────────────────────────

  // New Listing Pipeline: CMA → Transaction Setup → Marketing → Social
  const listingPipeline = createWorkflow({
    name: "New Listing Pipeline",
    description: "End-to-end new listing process: market analysis → transaction setup → marketing package → social media promotion.",
    triggerType: "manual",
  });
  if (listingPipeline) {
    addStep(listingPipeline.id, {
      name: "Market Analysis (CMA)",
      templateId: tplCma.id,
      stepOrder: 0,
      onFailure: "stop",
    });
    addStep(listingPipeline.id, {
      name: "Transaction Setup",
      templateId: tplTransactionSetup.id,
      stepOrder: 1,
      onFailure: "continue",
    });
    addStep(listingPipeline.id, {
      name: "Marketing Launch",
      templateId: tplListingMarketing.id,
      stepOrder: 2,
      onFailure: "continue",
    });
    addStep(listingPipeline.id, {
      name: "Social Media Promotion",
      templateId: tplSocialPost.id,
      stepOrder: 3,
      onFailure: "continue",
    });
  }

  // Post-Closing Pipeline: Commission → Testimonial → Client Touch
  const closingPipeline = createWorkflow({
    name: "Post-Closing Pipeline",
    description: "Post-closing workflow: commission reconciliation → testimonial request → client retention touchpoint.",
    triggerType: "manual",
  });
  if (closingPipeline) {
    addStep(closingPipeline.id, {
      name: "Commission Review",
      templateId: tplCommissionReview.id,
      stepOrder: 0,
      onFailure: "continue",
    });
    addStep(closingPipeline.id, {
      name: "Testimonial Request",
      templateId: tplTestimonialRequest.id,
      stepOrder: 1,
      onFailure: "continue",
    });
    addStep(closingPipeline.id, {
      name: "Client Retention Touch",
      templateId: tplClientTouch.id,
      stepOrder: 2,
      onFailure: "continue",
    });
  }

  // Weekly Ops Pipeline: Analytics → Market Pulse → Pipeline Review
  const weeklyPipeline = createWorkflow({
    name: "Weekly Operations Review",
    description: "Weekly recurring reports: marketing analytics → market pulse → social monitoring summary.",
    triggerType: "manual",
  });
  if (weeklyPipeline) {
    addStep(weeklyPipeline.id, {
      name: "Marketing Analytics Summary",
      templateId: tplWeeklyAnalytics.id,
      stepOrder: 0,
      onFailure: "continue",
    });
    addStep(weeklyPipeline.id, {
      name: "Market Pulse Report",
      templateId: tplMarketPulse.id,
      stepOrder: 1,
      onFailure: "continue",
    });
  }

  console.log("[mission-control] Seeded: 12 templates, 5 automation rules, 3 workflows.");
}
