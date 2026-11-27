# Replace the website's Pi key with your Pi's key

## What happens
- When you approve, I open a secure box for the website's private Pi key.
- Paste the same key your Pi assistant saved on the Pi, then save. Don't paste it in chat.
- The key never shows in chat, and I never see it.
- After that, the Pi and the website trust each other. Your Pi assistant can then run the pairing command to get your 6-digit code.

## Quick check after saving
- Ask your Pi assistant to run the pairing command once.
- If it prints a 6-digit code, the key matches. If it says "unauthorized", the two keys are different. Paste it again.

## Technical details
- Use `update_secret` for the existing `AXON_PI_KEY` (it needs at least 16 characters). No code changes are needed.
