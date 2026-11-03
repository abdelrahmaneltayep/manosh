# Menna narration — generated takes (2026-11-03)

Generated through ElevenLabs with the cloned voice **Menna** (consented), model
`eleven_multilingual_v2`, two takes per scene. All takes live on one flow:

https://elevenlabs.io/app/flows/qhG7rdINn0dPF6IVY0du

Download each chosen take from the flow as `docs/video/menna/vo/NN.mp3`, then normalise
to −16 LUFS before the edit (`ffmpeg -i NN.mp3 -af loudnorm=I=-16:TP=-1:LRA=3 NN.wav`).

**Listen to every take before using it.** The picks below are by fit to the slot only
(the take must end at least 0.6 s before the slot does); the ear decides between A and B.

| Scene | Slot | Take A | Take B | Pick by fit | Note |
|---|---|---|---|---|---|
| 01 Cold open | 16 s | 14.3 s | 12.7 s | B | both fit |
| 02 Embedded | 14 s | 10.0 s | 9.4 s | either | |
| 03 Home | 12 s | 5.6 s | 5.2 s | either | short scene, let the UI breathe |
| 04 Inbox | 12 s | 6.6 s | 7.4 s | either | |
| 05 Totals from Shopify | 16 s | 12.2 s | 11.3 s | either | |
| 06 Draft with Claude | 18 s | 12.9 s | 13.9 s | either | check "Use this price" is read as a label |
| 07 Send counter | 10 s | 6.6 s | 6.3 s | either | |
| 08 Magic link | 12 s | 9.9 s | pending | A | second take was still generating |
| 09 Buyer accept | 20 s | 17.2 s | 18.8 s | A | B ends 1.2 s before the slot, tight |
| 10 Draft order | 12 s | 10.6 s | 9.1 s | B | A ends 1.4 s before the slot |
| 11 Reorder | 14 s | 12.6 s | 12.9 s | A | both tight; cut the clip 1 s longer if needed |
| 12 Order Pad | 16 s | 14.4 s | 13.3 s | B | |
| 13 Analytics | 12 s | 11.1 s | 11.0 s | either | tight: both end 0.9 s before the slot |
| 14 Beyond the loop | 18 s | 15.3 s | 15.4 s | either | |
| 15 Try the demo | 26 s | 21.4 s | 19.9 s | either | slot shortened from 28 s |
| 16 Close | 12 s | 11.2 s | 11.6 s | A | slot lengthened from 10 s so the close can settle |

Pronunciation to check on every take: "Mannon", "Shopify", "B2B", "PO", "Net thirty",
"manosh dot fly dot dev". Re-generate a single scene from its `vo/NN.txt` if any is wrong.
