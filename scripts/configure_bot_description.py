"""Apply or verify the public pre-Start introduction; never print credentials."""

import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DESCRIPTION_FILE = Path(__file__).resolve().parents[1] / "config/bot-description.fa.txt"
EXPECTED_USERNAME = "SaRoPortfolioAgentBot"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Set the default and Persian descriptions, then read them back")
    args = parser.parse_args()
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("TELEGRAM_BOT_TOKEN must be provided securely in the environment.")
    description = DESCRIPTION_FILE.read_text(encoding="utf-8").rstrip("\n")
    if not 0 < len(description) <= 512:
        raise SystemExit("Description must contain 1–512 characters.")

    def call(method, data=None):
        request = Request(
            f"https://api.telegram.org/bot{token}/{method}",
            data=json.dumps(data or {}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.load(response)
        except HTTPError as error:
            raise SystemExit(f"Telegram {method} failed: HTTP {error.code}.") from None
        except (URLError, TimeoutError, ValueError, OSError):
            # Exception text may contain the credential-bearing URL.
            raise SystemExit(f"Telegram {method} could not be completed.") from None
        if result.get("ok") is not True:
            raise SystemExit(f"Telegram {method} returned an unsuccessful response.")
        return result.get("result")

    identity = call("getMe")
    if identity.get("username") != EXPECTED_USERNAME:
        raise SystemExit("Configured credential belongs to a different bot; no settings changed.")
    verified = {}
    for language in ("", "fa"):
        parameters = {"language_code": language}
        if args.apply:
            call("setMyDescription", {**parameters, "description": description})
        actual = call("getMyDescription", parameters)
        verified[language or "default"] = actual.get("description") == description
    print(json.dumps({"bot_verified": True, "applied": args.apply, "description_verified": verified}))
    if not all(verified.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
