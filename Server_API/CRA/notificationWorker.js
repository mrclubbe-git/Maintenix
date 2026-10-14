const {
  claimNextDelivery,
  completeDelivery,
  failDelivery
} = require("./lib/notificationDelivery");
const { sendNotificationPush } = require("./lib/pushNotifications");

const WORKER_ID = `notification-worker:${process.pid}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processOne(job) {
  if (!job?.id || !job?.notification) {
    if (job?.id) failDelivery(job.id, new Error("Notification delivery job is invalid."));
    return;
  }

  try {
    const result = await sendNotificationPush(job.notification);
    if (result?.configured === false) throw new Error("Web Push is not configured.");

    if (Number(result?.retryableFailed || 0) > 0 && Number(result?.sent || 0) === 0) {
      const firstError = Array.isArray(result?.errors) ? result.errors[0] : null;
      throw new Error(firstError?.message || "Web Push delivery failed and will be retried.");
    }

    completeDelivery(job.id, result || {});
  } catch (error) {
    failDelivery(job.id, error);
  }
}

async function main() {
  console.log("Notification delivery worker started.");
  while (true) {
    const job = claimNextDelivery(WORKER_ID);
    if (!job) {
      await sleep(1500);
      continue;
    }
    await processOne(job);
  }
}

main().catch((error) => {
  console.error("Notification delivery worker fatal:", error);
  process.exit(1);
});
