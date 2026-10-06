import { put, get } from "@vercel/blob";

const PORTFOLIO_SNAPSHOT_PATH = "portfolio/latest.json";

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // GET
  // ---------------------------------------------------------
  if (req.method === "GET") {
    const setup = req.query?.setup;

    if (setup === "webhook") {
      return showWebhookSetupPage(req, res);
    }

    return res.status(200).json({
      ok: true,
      service: "Portfolio Agent Telegram Bot"
    });
  }

  // ---------------------------------------------------------
  // POST
  // ---------------------------------------------------------

  if (req.method === "POST" && req.query?.sync === "portfolio") return handlePortfolioSync(req, res);
  if (req.method === "GET" && req.query?.data === "portfolio") return handlePortfolioData(req, res);

  if (req.method === "POST") {
    return handleTelegramWebhook(req, res);
  }

  return res.status(405).json({
    ok: false,
    error: "Method not allowed"
  });
}


async function handlePortfolioSync(req, res) {
  const expected = process.env.PORTFOLIO_SYNC_SECRET;
  const supplied = req.headers["x-portfolio-sync-secret"];

  if (!expected || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const body = req.body || {};
  if (!body.version || !body.updated_at || typeof body.assets !== "object" || Array.isArray(body.assets)) {
    return res.status(400).json({ ok: false, error: "Invalid portfolio payload" });
  }

  const assets = {};
  for (const [name, value] of Object.entries(body.assets)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ ok: false, error: "Invalid quantity for " + name });
    }
    assets[name] = n;
  }

  const snapshot = {
    version: String(body.version),
    updated_at: String(body.updated_at),
    workbook_updated_at: body.workbook_updated_at ? String(body.workbook_updated_at) : null,
    assets
  };

  try {
    await put(
      PORTFOLIO_SNAPSHOT_PATH,
      JSON.stringify(snapshot, null, 2),
      {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json"
      }
    );
  } catch (error) {
    console.error("Portfolio snapshot storage error:", error);
    return res.status(500).json({ ok: false, error: "Unable to store portfolio snapshot" });
  }

  return res.status(200).json({
    ok: true,
    received: Object.keys(assets).length,
    updated_at: snapshot.updated_at,
    stored: true
  });
}

async function handlePortfolioData(req, res) {
  const expected = process.env.PORTFOLIO_SYNC_SECRET;
  const supplied = req.headers["x-portfolio-sync-secret"];

  if (!expected || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const result = await get(PORTFOLIO_SNAPSHOT_PATH, {
      access: "private",
      useCache: false
    });

    if (!result) {
      return res.status(404).json({ ok: false, error: "No portfolio snapshot available" });
    }

    const chunks = [];
    const reader = result.stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }

    const snapshot = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    return res.status(200).json({
      ok: true,
      snapshot
    });
  } catch (error) {
    console.error("Portfolio snapshot read error:", error);
    return res.status(404).json({ ok: false, error: "No portfolio snapshot available" });
  }
}

// =========================================================
// WEBHOOK SETUP PAGE
// =========================================================

function showWebhookSetupPage(req, res) {
  const key = req.query?.key;

  // If a key was submitted, perform the setup.
  if (key !== undefined) {
    return performWebhookSetup(key, req, res);
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Portfolio Agent - Webhook Setup</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 600px;
      margin: 60px auto;
      padding: 20px;
    }

    h1 {
      font-size: 24px;
    }

    input {
      width: 100%;
      padding: 12px;
      margin: 10px 0;
      box-sizing: border-box;
      font-size: 16px;
    }

    button {
      padding: 12px 20px;
      font-size: 16px;
      cursor: pointer;
    }
  </style>
</head>

<body>

<h1>Portfolio Agent Telegram Webhook</h1>

<p>Enter the SETUP_SECRET configured in Vercel.</p>

<form method="GET" action="/api/telegram">
  <input type="hidden" name="setup" value="webhook">

  <input
    type="password"
    name="key"
    placeholder="SETUP_SECRET"
    required
  >

  <button type="submit">
    Configure Webhook
  </button>
</form>

</body>
</html>
`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}


// =========================================================
// PERFORM WEBHOOK SETUP
// =========================================================

async function performWebhookSetup(key, req, res) {
  try {
    const setupSecret = process.env.SETUP_SECRET;

    if (!setupSecret) {
      return sendHtmlResult(
        res,
        "Configuration Error",
        "SETUP_SECRET is not configured in Vercel."
      );
    }

    if (key !== setupSecret) {
      return sendHtmlResult(
        res,
        "Authentication Failed",
        "The SETUP_SECRET is incorrect."
      );
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      return sendHtmlResult(
        res,
        "Configuration Error",
        "TELEGRAM_BOT_TOKEN is not configured in Vercel."
      );
    }

    const host = req.headers.host;

    if (!host) {
      return sendHtmlResult(
        res,
        "Configuration Error",
        "Unable to determine the Vercel deployment host."
      );
    }

    const webhookUrl = `https://${host}/api/telegram`;

    const webhookSecret =
      process.env.TELEGRAM_WEBHOOK_SECRET;

    const body = {
      url: webhookUrl
    };

    if (webhookSecret) {
      body.secret_token = webhookSecret;
    }

    console.log("Attempting Telegram webhook setup:", webhookUrl);

    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const result = await response.json();

    console.log("Telegram setWebhook response:", result);

    if (!response.ok || !result.ok) {
      const description =
        result?.description ||
        "Telegram rejected the webhook configuration.";

      return sendHtmlResult(
        res,
        "Webhook Setup Failed",
        description
      );
    }

    return sendHtmlResult(
      res,
      "Webhook Configured Successfully",
      `
Webhook URL:

<strong>${escapeHtml(webhookUrl)}</strong>

<br><br>

Telegram accepted the webhook configuration.
<br><br>

You can now open your Telegram bot and send:
<br>
<strong>/start</strong>
`
    );

  } catch (error) {
    console.error("Webhook setup exception:", error);

    return sendHtmlResult(
      res,
      "Server Error",
      error?.message || "An unexpected error occurred."
    );
  }
}


// =========================================================
// TELEGRAM WEBHOOK HANDLER
// =========================================================

async function handleTelegramWebhook(req, res) {
  const webhookSecret =
    process.env.TELEGRAM_WEBHOOK_SECRET;

  const suppliedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (
    webhookSecret &&
    suppliedSecret !== webhookSecret
  ) {
    return res.status(401).json({
      ok: false
    });
  }

  const update = req.body || {};
  const message = update.message;

  if (!message?.chat?.id) {
    return res.status(200).json({
      ok: true
    });
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
      "Portfolio Agent is connected.";
  } else if (text === "/allocation") {
    reply =
      "Allocation reporting is not configured yet.";
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

  return res.status(200).json({
    ok: true
  });
}


// =========================================================
// SEND TELEGRAM MESSAGE
// =========================================================

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  if (!response.ok) {
    console.error(
      "Telegram API error:",
      await response.text()
    );
  }
}


// =========================================================
// HTML HELPERS
// =========================================================

function sendHtmlResult(res, title, message) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 700px;
      margin: 60px auto;
      padding: 20px;
    }

    h1 {
      font-size: 24px;
    }

    .message {
      margin-top: 25px;
      padding: 20px;
      border: 1px solid #ccc;
      border-radius: 8px;
      line-height: 1.6;
      word-break: break-word;
    }

    a {
      display: inline-block;
      margin-top: 25px;
    }
  </style>
</head>

<body>

<h1>${escapeHtml(title)}</h1>

<div class="message">
  ${message}
</div>

<a href="/api/telegram?setup=webhook">
  Back to setup
</a>

</body>
</html>
`;

  res.setHeader(
    "Content-Type",
    "text/html; charset=utf-8"
  );

  return res.status(200).send(html);
}


function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
