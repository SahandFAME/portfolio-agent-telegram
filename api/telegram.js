import { put, get } from "@vercel/blob";

const PORTFOLIO_SNAPSHOT_PATH = "portfolio/latest.json";

const PORTFOLIO_ASSET_NAMES = [
  "طلا","عیار","گوهر","آلتون","امرالد","زرفام","نهال","طعام",
  "استیل","فلز فارابی","پتروآگاه","خودران","بلک راک","سجام","فملی",
  "شمش نقره 999","BTC","ETH","Tether","Link","ADA","SOL","ONDO",
  "سکه تمام","ربع سکه غیره","ربع سکه بانکی","آبشده (طلب)","آبشده (شمش زربد)","دلار"
];

const MANUAL_QUANTITIES = {
  "سکه تمام": 3,
  "ربع سکه غیره": 3,
  "ربع سکه بانکی": 1,
  "آبشده (طلب)": 1.37,
  "آبشده (شمش زربد)": 20,
  "دلار": 3030
};

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
