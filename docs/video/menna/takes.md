# Menna narration — generated takes (2026-11-03)

Cloned voice **Menna** (consented), on one ElevenLabs flow:

https://elevenlabs.io/app/flows/qhG7rdINn0dPF6IVY0du

Two sets exist on the flow. **Use set 2.**

| Set | Model | Direction | Why |
|---|---|---|---|
| 1 | `eleven_multilingual_v2` | none | first pass, brighter and a touch quick |
| 2 | `eleven_v4` | `[warmly] [softly]` at the top of every scene | the warm, quiet read that was asked for; same words, no speed change |

Set 2's prompts start with the tags, so they are easy to tell apart on the canvas. Download
each chosen take as `docs/video/menna/vo/NN.mp3`, then normalise before the edit:
`ffmpeg -i NN.mp3 -af loudnorm=I=-16:TP=-1:LRA=3 NN.wav`. "Quiet" in the final mix comes
from that −16 LUFS target, not from the take.

**Listen to every take before using it.** Picks below are by fit only (the take must end at
least 0.6 s before its slot); the ear decides between A and B.

| Scene | Slot | Take A | Take B | Pick by fit | Note |
|---|---|---|---|---|---|
| 01 Cold open | 16 s | 14.3 s | 14.7 s | A | |
| 02 Embedded | 13 s | 11.8 s | 12.1 s | A | |
| 03 Home | 9 s | 7.5 s | 7.5 s | either | |
| 04 Inbox | 11 s | 9.1 s | 9.4 s | either | |
| 05 Totals from Shopify | 16 s | 14.6 s | pending | A | second take was still queued |
| 06 Draft with Claude | 18 s | 16.5 s | 16.9 s | A | check "Use this price" is read as a label |
| 07 Send counter | 10 s | 8.9 s | 8.9 s | either | |
| 08 Magic link | 12 s | 11.2 s | 11.1 s | B | tight: 0.9 s margin |
| 09 Buyer accept | 21 s | 19.8 s | 19.8 s | either | |
| 10 Draft order | 13 s | 12.2 s | 12.4 s | A | tight: 0.8 s margin |
| 11 Reorder | 17 s | 15.2 s | pending | A | |
| 12 Order Pad | 15 s | 14.1 s | 13.8 s | B | |
| 13 Analytics | 14 s | 12.7 s | 12.7 s | either | |
| 14 Beyond the loop | 18 s | 16.3 s | 16.2 s | either | |
| 15 Try the demo | 23 s | 21.8 s | 21.8 s | either | |
| 16 Close | 14 s | pending | 13.1 s | B | let the last line settle, then fade |

Pronunciation to check on every take: "Mannon", "Shopify", "B2B", "PO", "Net thirty",
"manosh dot fly dot dev". Re-generate a single scene from its `vo/NN.txt` (with the two
tags in front) if any is wrong.
