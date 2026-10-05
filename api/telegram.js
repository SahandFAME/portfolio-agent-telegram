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
  if (req.method === "POST") {
    return handleTelegramWebhook(req, res);
  }

  return res.status(405).json({
    ok: false,
    error: "Method not allowed"
  });
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
