"""Compatibility entry point for the verified Microsoft consent helper.

Run consent through microsoft-consent.yml outside the Codex GitHub proxy.
"""
from authorize_microsoft import main

if __name__ == '__main__':
    raise SystemExit(main())
