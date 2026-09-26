# Codex Instructions

## Testing policy

- Do not perform final runtime verification using an iOS Simulator or physical iPhone.
- The user will manually perform all simulator and physical-device testing.
- Codex may run static checks, lint, typecheck, unit tests, build checks, and inspect logs where appropriate.
- Do not treat simulator or physical-device execution as required for task completion.
- After making changes, clearly tell the user:
  1. what was changed,
  2. what automated checks were performed,
  3. what the user should verify manually on the simulator or physical device.
- Do not launch Xcode Simulator unless the user explicitly asks you to.