const { createNotification } = require("./notifications");
const { getNotificationDefinition } = require("./notificationRegistry");

function notify(eventType, context = {}) {
  const key = String(eventType || "").trim().toUpperCase();
  const definition = getNotificationDefinition(key);
  if (!definition) throw new Error(`Unknown notification event: ${key || "(blank)"}`);

  const built = definition.build(context) || {};
  return createNotification({
    ...built,
    eventType: key,
    type: definition.type || key,
    category: definition.category || "GENERAL",
    mandatory: built.mandatory === undefined ? !!definition.mandatory : !!built.mandatory,
    requiresAck: built.requiresAck === undefined ? !!definition.defaultRequiresAck : !!built.requiresAck,
    deliveryChannels:
      Array.isArray(built.deliveryChannels) && built.deliveryChannels.length
        ? built.deliveryChannels
        : definition.deliveryChannels,
    sourceEventId: context?.sourceEventId || built.sourceEventId || "",
    idempotencyKey: context?.idempotencyKey || built.idempotencyKey || ""
  });
}

function notifySafe(eventType, context = {}) {
  try {
    return notify(eventType, context);
  } catch (error) {
    console.error(`Notification event ${eventType} failed:`, error?.message || error);
    return null;
  }
}

module.exports = { notify, notifySafe };
