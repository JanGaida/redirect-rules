# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/JanGaida/redirect-rules/security/advisories/new). Do not open a public issue.

Include:

- affected version from the About tab or the `@version` tag in the userscript header
- browser and userscript manager
- a minimal rule set or exported JSON that reproduces the issue
- expected and actual behavior
- whether page data, stored settings, or the dashboard takeover is affected

## Scope

In scope:

- URL rewriting and redirect-loop handling
- dashboard takeover protocol and storage keys
- settings export and import parsing
- userscript metadata and update URLs

Out of scope:

- defects in Tampermonkey or the browser
- behavior of third-party sites or rules you author
- social engineering and physical access

## Response

This is a single-maintainer project. Reports are acknowledged as soon as possible. No bug bounty is offered.
