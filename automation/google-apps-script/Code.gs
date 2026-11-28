/**
 * Gomez Aviator Intelligence — optional Google Apps Script backup poller.
 *
 * Store GAMEDATA365_API_KEY and INGEST_API_TOKEN in Script Properties.
 * This is a backup poller, not a continuous stream. The provider returns only
 * the latest completed round, so rounds between polls can still be missed.
 */

const CONFIG = Object.freeze({
  providerUrl: "https://api.gamedata365.com/v1/crash/live",
  collectorUrl: "https://gomez-aviator-collector.onrender.com/api/v1/ingest",
  runtimeBudgetMsPerDay: 75 * 60 * 1000,
  lockWaitMs: 1000
});

function installFiveMinuteTrigger() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("GAMEDATA365_API_KEY")) {
    throw new Error("Add GAMEDATA365_API_KEY to Project Settings > Script Properties first.");
  }
  if (!props.getProperty("INGEST_API_TOKEN")) {
    throw new Error("Add INGEST_API_TOKEN to Project Settings > Script Properties first.");
  }

  // Avoid creating duplicate triggers for this function.
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "captureLatestAviatorRound")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("captureLatestAviatorRound")
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log("Installed one five-minute backup trigger.");
}

function captureLatestAviatorRound() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.lockWaitMs)) {
    Logger.log("Skipped: another capture is already running.");
    return;
  }

  const startedAt = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty("GAMEDATA365_API_KEY");
    const ingestToken = props.getProperty("INGEST_API_TOKEN");
    if (!apiKey || !ingestToken) {
      throw new Error("Missing required Script Properties.");
    }

    const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
    const budgetKey = "RUNTIME_MS_" + today;
    const usedMs = Number(props.getProperty(budgetKey) || 0);
    if (usedMs >= CONFIG.runtimeBudgetMsPerDay) {
      Logger.log("Daily safety budget reached; skipping this poll.");
      return;
    }

    const providerResponse = UrlFetchApp.fetch(CONFIG.providerUrl, {
      method: "get",
      headers: { "X-API-Key": apiKey, accept: "application/json" },
      muteHttpExceptions: true
    });
    const providerCode = providerResponse.getResponseCode();
    if (providerCode < 200 || providerCode >= 300) {
      throw new Error("GameData365 request failed with HTTP " + providerCode + ".");
    }

    const payload = JSON.parse(providerResponse.getContentText());
    if (payload.status !== "ok" || !Array.isArray(payload.games)) {
      throw new Error("Unexpected GameData365 live response.");
    }

    const game = payload.games.find(item => {
      const id = String(item.game_id || "").trim().toLowerCase();
      const name = String(item.game_name || "").trim().toLowerCase().replace(/\s+/g, "-");
      return id === "aviator" || name === "aviator";
    });

    if (!game || game.stale === true || !game.latest) {
      Logger.log("No fresh Aviator round returned; nothing ingested.");
      return;
    }

    const latest = game.latest;
    const roundId = String(latest.round_id || "").trim();
    const multiplier = Number(latest.multiplier);
    const rawTime = String(latest.timestamp || "").trim();
    const normalizedTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(rawTime)
      ? rawTime.replace(" ", "T") + "Z"
      : rawTime;
    const endedAt = new Date(normalizedTime);

    if (!roundId || roundId.length > 180 ||
        !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100000000 ||
        isNaN(endedAt.getTime()) || endedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new Error("GameData365 returned an invalid latest Aviator round.");
    }

    const ingestResponse = UrlFetchApp.fetch(CONFIG.collectorUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ingestToken },
      payload: JSON.stringify({
        source: "gamedata365",
        rounds: [{
          game: "aviator",
          roundId: roundId,
          multiplier: multiplier,
          endedAt: endedAt.toISOString()
        }]
      }),
      muteHttpExceptions: true
    });
    const ingestCode = ingestResponse.getResponseCode();
    const ingestBody = ingestResponse.getContentText();
    if (ingestCode < 200 || ingestCode >= 300) {
      throw new Error("Collector ingest failed with HTTP " + ingestCode + ".");
    }

    const result = JSON.parse(ingestBody || "{}");
    Logger.log(JSON.stringify({
      status: "capture-complete",
      roundId: roundId,
      multiplier: multiplier,
      endedAt: endedAt.toISOString(),
      accepted: result.accepted || 0,
      duplicates: result.duplicates || 0
    }));
  } finally {
    const elapsed = Date.now() - startedAt;
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
    const budgetKey = "RUNTIME_MS_" + today;
    const current = Number(props.getProperty(budgetKey) || 0);
    props.setProperty(budgetKey, String(current + elapsed));
    lock.releaseLock();
  }
}

/** Run once manually after adding Script Properties to test the connection. */
function testCaptureOnce() {
  captureLatestAviatorRound();
}
