# Contributing

Thanks for helping. The most useful contributions are a rule we missed, a false positive, and a server that confuses the checker.

## Adding or changing a rule

1. Find the requirement in a public source: a Claude docs page or the MCP specification. A rule with no public source does not go in.
2. Add it to `src/rules.js` with its level, the source key and a one-line fix written for someone who has never seen the rule.
3. Implement the check in `src/checks/`. Keep it read-only: no tool calls, no resource reads, no client registration.
4. Add a test that fails without your change, in `test/`. Fixtures live in `test/fixture-server.js`.
5. `npm test`, then open a pull request that links the source.

If the source is a page we do not track yet, add it to `SOURCES` and run `node scripts/watch-sources.mjs --update`.

## Reporting a false positive

Open an issue with the tool definition (or the metadata JSON) that was flagged, and why you think it is fine. The instruction-wording check is a pattern match, so false positives there are expected and worth fixing.

## Style

Plain British English in messages. Every failure says what is wrong, what to do, and where the rule comes from.
