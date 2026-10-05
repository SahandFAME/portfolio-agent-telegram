export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, service: "Portfolio Agent Telegram Bot" });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = req.headers["x-telegram-bot-api-secret-token"];
  if (secret && supplied !== secret) {
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
    reply = "Portfolio Agent is connected. Live portfolio calculations will be enabled after the data-source and market-data environment variables are configured.";
  } else if (text === "/allocation") {
    reply = "Allocation reporting is not configured yet. The next deployment will connect the persistent portfolio configuration and live price layer.";
  } else {
    reply = "Command received. Available commands: /status /allocation /assets /gold /crypto /cash /refresh";
  }

  await sendTelegramMessage(chatId, reply);
  return res.status(200).json({ ok: true });
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });

  if (!response.ok) {
    console.error("Telegram API error:", await response.text());
  }
}
