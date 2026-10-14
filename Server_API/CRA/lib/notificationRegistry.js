const { userLabel } = require("./notifications");

function actorFields(actor) {
  return {
    createdByUserId: actor?.id || "",
    createdByEmail: actor?.email || "",
    createdByName: userLabel(actor)
  };
}

function userTarget(user) {
  return {
    targetUserId: user?.id || "",
    targetUserEmail: user?.email || ""
  };
}

function compactError(error) {
  return String(error?.message || error || "Unknown error").replace(/\s+/g, " ").trim().slice(0, 500);
}

const REGISTRY = Object.freeze({
  ADMIN_BROADCAST: {
    type: "ADMIN_BROADCAST", category: "ADMIN",
    description: "Administrative broadcast to all users or selected roles.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      return {
        scope: "GLOBAL",
        title: String(context?.title || "").trim(),
        message: String(context?.message || "").trim(),
        severity: context?.requiresAck ? "warning" : "info",
        requiresAck: !!context?.requiresAck,
        targetRoles: Array.isArray(context?.targetRoles) ? context.targetRoles : [],
        ...actorFields(context?.actor)
      };
    }
  },
  PLANNER_ASSIGNED: {
    type: "PLANNER_TASK_ASSIGNED", category: "PLANNER",
    description: "Daily Planner task allocated or reallocated to a user.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: true, mandatory: true,
    build(context) {
      const task = context?.task || {};
      const actor = context?.actor || {};
      const assignee = context?.assignee || {};
      return {
        scope: "USER",
        title: "Daily planner task allocated",
        message: `${userLabel(actor)} allocated you a planner task: ${task.title || "Untitled task"}${task.startDate ? ` starting ${task.startDate}` : ""}. Please open Daily Planner and acknowledge the allocation.`,
        severity: "warning", requiresAck: true,
        ...actorFields(actor), ...userTarget(assignee),
        relatedEntityType: "daily_planner_task", relatedEntityId: task.id || "",
        actionUrl: `#/daily-planner?date=${encodeURIComponent(task.date || "")}`
      };
    }
  },
  REPORT_APPROVED: {
    type: "REPORT_STATUS", category: "REPORTS",
    description: "Report owner notified that a report was approved.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      return {
        scope: "USER", title: "Report approved",
        message: `Your report ${context?.fileName || "Report"} was approved by ${userLabel(context?.actor)}.`,
        severity: "success", ...actorFields(context?.actor),
        targetUserId: context?.targetUserId || "", targetUserEmail: context?.targetUserEmail || "",
        relatedEntityType: "report", relatedEntityId: context?.fileName || "", actionUrl: "#/reports"
      };
    }
  },
  REPORT_REJECTED: {
    type: "REPORT_STATUS", category: "REPORTS",
    description: "Report owner notified that a report was rejected.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      const reason = String(context?.reason || "").trim();
      return {
        scope: "USER", title: "Report rejected",
        message: `Your report ${context?.fileName || "Report"} was rejected by ${userLabel(context?.actor)}.${reason ? ` Reason: ${reason}` : ""}`,
        severity: "danger", ...actorFields(context?.actor),
        targetUserId: context?.targetUserId || "", targetUserEmail: context?.targetUserEmail || "",
        relatedEntityType: "report", relatedEntityId: context?.fileName || "", actionUrl: "#/reports"
      };
    }
  },
  STANDBY_UPDATED: {
    type: "STANDBY_CHANGE", category: "STANDBY",
    description: "Standby rotation created or updated.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      const first = context?.first || null;
      return {
        scope: "GLOBAL", title: "Standby rotation updated",
        message: `Standby rotation was updated by ${userLabel(context?.actor)} for ${context?.startDate || ""} to ${context?.endDate || ""}. Current first rotation: ${first?.userName || "—"}${first ? ` (${first.startDate} to ${first.endDate})` : ""}.`,
        severity: "info", ...actorFields(context?.actor),
        relatedEntityType: "standby", relatedEntityId: `${context?.startDate || ""}:${context?.endDate || ""}`, actionUrl: "#/standby"
      };
    }
  },
  STANDBY_CLEARED: {
    type: "STANDBY_CHANGE", category: "STANDBY",
    description: "Standby rotation cleared.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      return {
        scope: "GLOBAL", title: "Standby rotation cleared",
        message: `Standby rotation was cleared by ${userLabel(context?.actor)}.`,
        severity: "warning", ...actorFields(context?.actor),
        relatedEntityType: "standby", relatedEntityId: "cleared", actionUrl: "#/standby"
      };
    }
  },
  SERVICING_COMPLETE: {
    type: "SERVICING_COMPLETE", category: "SERVICING",
    description: "Queued servicing report generation completed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      return {
        scope: "USER", title: "Servicing report ready",
        message: `Your servicing report ${context?.fileName || context?.reportId || ""} has been generated successfully.`,
        severity: "success", ...userTarget(context?.owner),
        relatedEntityType: "servicing_report", relatedEntityId: context?.reportId || "", actionUrl: "#/reports"
      };
    }
  },
  SERVICING_FAILED: {
    type: "SERVICING_FAILED", category: "SERVICING",
    description: "Queued servicing report generation failed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: true, mandatory: true,
    build(context) {
      return {
        scope: "USER", title: "Servicing report failed",
        message: `Servicing report ${context?.reportId || ""} could not be generated. ${compactError(context?.error)}`,
        severity: "danger", requiresAck: true, ...userTarget(context?.owner),
        relatedEntityType: "servicing_report", relatedEntityId: context?.reportId || "", actionUrl: "#/Servicing"
      };
    }
  },
  CALLOUT_COMPLETE: {
    type: "CALLOUT_COMPLETE", category: "CALLOUT",
    description: "Queued Call Out report generation completed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      return {
        scope: "USER", title: "Call Out report ready",
        message: `Your Call Out report ${context?.fileName || context?.reportId || ""} has been generated successfully.`,
        severity: "success", ...userTarget(context?.owner),
        relatedEntityType: "callout_report", relatedEntityId: context?.reportId || "", actionUrl: "#/reports"
      };
    }
  },
  CALLOUT_FAILED: {
    type: "CALLOUT_FAILED", category: "CALLOUT",
    description: "Queued Call Out report generation failed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: true, mandatory: true,
    build(context) {
      return {
        scope: "USER", title: "Call Out report failed",
        message: `Call Out report ${context?.reportId || ""} could not be generated. ${compactError(context?.error)}`,
        severity: "danger", requiresAck: true, ...userTarget(context?.owner),
        relatedEntityType: "callout_report", relatedEntityId: context?.reportId || "", actionUrl: "#/CallOut"
      };
    }
  },
  FORMAL_REPORT_COMPLETE: {
    type: "FORMAL_REPORT_COMPLETE", category: "FORMAL_REPORTING",
    description: "Formal/Section report generation completed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: false, mandatory: false,
    build(context) {
      const count = Number(context?.outputCount || 0);
      return {
        scope: "USER", title: "Formal report ready",
        message: `Formal report generation completed successfully${count ? ` (${count} output${count === 1 ? "" : "s"})` : ""}.`,
        severity: "success", ...userTarget(context?.owner),
        relatedEntityType: "formal_report", relatedEntityId: context?.reportId || "", actionUrl: "#/section-reports"
      };
    }
  },
  FORMAL_REPORT_FAILED: {
    type: "FORMAL_REPORT_FAILED", category: "FORMAL_REPORTING",
    description: "Formal/Section report generation failed.",
    deliveryChannels: ["IN_APP", "PUSH"], defaultRequiresAck: true, mandatory: true,
    build(context) {
      return {
        scope: "USER", title: "Formal report failed",
        message: `Formal report generation failed. ${compactError(context?.error)}`,
        severity: "danger", requiresAck: true, ...userTarget(context?.owner),
        relatedEntityType: "formal_report", relatedEntityId: context?.reportId || "", actionUrl: "#/section-reports"
      };
    }
  }
});

function getNotificationDefinition(eventType) {
  return REGISTRY[String(eventType || "").trim().toUpperCase()] || null;
}

function listNotificationEventDefinitions() {
  return Object.entries(REGISTRY).map(([eventType, definition]) => ({
    eventType,
    type: definition.type,
    category: definition.category,
    description: definition.description,
    deliveryChannels: [...definition.deliveryChannels],
    defaultRequiresAck: !!definition.defaultRequiresAck,
    mandatory: !!definition.mandatory
  }));
}

module.exports = { getNotificationDefinition, listNotificationEventDefinitions };
