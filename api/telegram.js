export default async function handler(req, res) {
  // ------------------------------------------------------------
  // Telegram webhook
  // ------------------------------------------------------------
  if (req.method === "POST") {
    return handleTelegramWebhook(req, res);
  }

  // ------------------------------------------------------------
  // Browser-accessible webhook setup
  // ------------------------------------------------------------
  if (req.method === "GET" && req.query?.setup === "webhook") {
    return handleWebhookSetupPage(req, res);
  }

  return res.status(200).json({
    ok: true,
    service: "Portfolio Agent Telegram Bot"
  });
}


// ============================================================
// Telegram webhook handler
// ============================================================

async function handleTelegramWebhook(req, res) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const suppliedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (webhookSecret && suppliedSecret !== webhookSecret) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body || {};
  const message = update.message;

  if (!message?.chat?.id) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text || "";

  let reply;

  if (text === "/start" || text === "/help") {
    reply =
      "Portfolio Agent is online.\n\n" +
      "/status — portfolio status\n" +
      "/allocation — asset allocation\n" +
      "/assets — asset list\n" +
      "/gold — gold/precious metals\n" +
      "/crypto — crypto holdings\n" +
      "/cash — cash holdings\n" +
      "/refresh — refresh market data";
  } else if (text === "/status") {
    reply =
      "Portfolio Agent is connected.\n\n" +
      "Live portfolio calculations will be enabled after " +
      "the data-source and market-data layers are configured.";
  } else if (text === "/allocation") {
    reply =
      "Allocation reporting is not configured yet.\n\n" +
      "The next stage will connect the persistent portfolio " +
      "configuration and live price layer.";
  } else {
    reply =
      "Command received.\n\n" +
      "Available commands:\n" +
      "/status\n" +
      "/allocation\n" +
      "/assets\n" +
      "/gold\n" +
      "/crypto\n" +
      "/cash\n" +
      "/refresh";
  }

  await sendTelegramMessage(chatId, reply);

  return res.status(200).json({ ok: true });
}


// ============================================================
// Browser setup page
// ============================================================

async function handleWebhookSetupPage(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const setupSecret = process.env.SETUP_SECRET;

  if (!setupSecret) {
    return res.status(500).send("SETUP_SECRET is not configured.");
  }

  const providedSecret = req.query?.key;

  if (!providedSecret || providedSecret !== setupSecret) {
    return res.status(401).send(`
      <!doctype html>
      <html>
        <body style="font-family:Arial,sans-serif;padding:40px">
          <h2>Portfolio Agent</h2>
          <p>Authorization required.</p>
          <form method="GET">
            <input type="hidden" name="setup" value="webhook">
            <input
              type="password"
              name="key"
              placeholder="Setup secret"
              style="padding:10px;width:300px"
            >
            <button
              type="submit"
              style="padding:10px 16px;margin-left:8px"
            >
              Configure Webhook
            </button>
          </form>
        </body>
      </html>
    `);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return res.status(500).send("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const host = req.headers.host;

  if (!host) {
    return res.status(500).send("Unable to determine deployment host.");
  }

  const webhookUrl = `https://${host}/api/telegram`;

  const body = {
    url: webhookUrl
  };

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (webhookSecret) {
    body.secret_token = webhookSecret;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    console.error("Telegram webhook setup failed");
    return res.status(500).send(`
      <!doctype html>
      <html>
        <body style="font-family:Arial,sans-serif;padding:40px">
          <h2>Webhook setup failed</h2>
          <p>Telegram did not accept the webhook configuration.</p>
        </body>
      </html>
    `);
  }

  return res.status(200).send(`
    <!doctype html>
    <html>
      <body style="font-family:Arial,sans-serif;padding:40px">
        <h2>Webhook configured successfully</h2>
        <p>Telegram is now connected to Portfolio Agent.</p>
        <p>
          Webhook endpoint:
          <code>${webhookUrl}</code>
        </p>
      </body>
    </html>
  `);
}


// ============================================================
// Telegram API helper
// ============================================================

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  if (!response.ok) {
    console.error("Telegram API error");
  }
}
