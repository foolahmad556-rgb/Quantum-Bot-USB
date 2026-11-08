# Binance REST rate-limit sources

Research date: 2026-11-08

- Binance official API documentation: https://developers.binance.com/en/docs/llms-full.txt
  - HTTP 429 means a request rate limit was exceeded.
  - HTTP 418 means the IP was auto-banned after continuing to send requests following 429 responses.
  - Repeated violations can increase the ban duration from minutes to days.
  - `Retry-After` is returned with 418/429 and gives the wait time in seconds.
  - Limits are applied to the IP, not only the API key.
  - `X-MBX-USED-WEIGHT-(interval)` reports the current IP request weight.
  - WebSocket streams are preferred for live updates where applicable.

- Binance general derivatives information: https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info

The implementation uses a conservative local weight ceiling, serializes Binance REST execution, honors `Retry-After`, and enters a process-wide quarantine after 418/429.
