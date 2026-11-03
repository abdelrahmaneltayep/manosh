# Menna narration — chosen takes (2026-11-03)

Cloned voice **Menna** (consented). Flow: https://elevenlabs.io/app/flows/qhG7rdINn0dPF6IVY0du

**Chosen: set 2 (eleven_v4, `[warmly] [softly]`), take B for every scene** — the owner's pick
after listening. B is the second take as the canvas lists them. Every take ends at least 0.6 s
before its slot; scene 10 is exactly at that margin, so keep its clip tight to the VO.

| Scene | Slot | Take B | Margin | ElevenLabs history id |
|---|---|---|---|---|
| 01 Cold open | 16 s | 14.7 s | 1.3 s | `puSmsPr2EZC1FJQ2UjAT` |
| 02 Embedded | 13 s | 11.8 s | 1.2 s | `N8lc5YP3ob0wN4m9jXDu` |
| 03 Home | 9 s | 7.5 s | 1.5 s | `sgDT1srfQPswJByH6R5a` |
| 04 Inbox | 11 s | 9.1 s | 1.9 s | `2IUoe5Op0UWOLylVbtFV` |
| 05 Totals from Shopify | 16 s | 14.6 s | 1.4 s | `4nGc9PsAgLIgYQ5xZvft` |
| 06 Draft with Claude | 18 s | 16.9 s | 1.1 s | `dZ39FXET5rg7zimIw35G` |
| 07 Send counter | 10 s | 8.9 s | 1.1 s | `09TWTjCIcUuzOvyOEOSu` |
| 08 Magic link | 12 s | 11.1 s | 0.9 s | `QV8xfGGPLJ4Nmg8Ji5x3` |
| 09 Buyer accept | 21 s | 19.8 s | 1.2 s | `YerN1pW8sXIao1B4JKjh` |
| 10 Draft order | 13 s | 12.4 s | 0.6 s | `O5KGXmXsAzFyQS4WsDe5` |
| 11 Reorder | 17 s | 15.3 s | 1.7 s | `XazFlXYLNUty4HJASJCG` |
| 12 Order Pad | 15 s | 13.8 s | 1.2 s | `10rXqCTUMZwnjTvNqohD` |
| 13 Analytics | 14 s | 12.7 s | 1.3 s | `0r5Tz0mGdvw6ezgMBSRO` |
| 14 Beyond the loop | 18 s | 16.2 s | 1.8 s | `o59yqMTmHZeLFfmpfqTv` |
| 15 Try the demo | 23 s | 21.8 s | 1.2 s | `00DWG1ts5Xsp6gLGdqzA` |
| 16 Close | 14 s | 13.1 s | 0.9 s | `yhO55Z6QDu1GjswBDt3N` |

## Download from the terminal (ElevenLabs API key in the environment)

```
export ELEVENLABS_API_KEY=your_key
mkdir -p docs/video/menna/vo
for pair in 01:puSmsPr2EZC1FJQ2UjAT 02:N8lc5YP3ob0wN4m9jXDu 03:sgDT1srfQPswJByH6R5a 04:2IUoe5Op0UWOLylVbtFV 05:4nGc9PsAgLIgYQ5xZvft 06:dZ39FXET5rg7zimIw35G 07:09TWTjCIcUuzOvyOEOSu 08:QV8xfGGPLJ4Nmg8Ji5x3 09:YerN1pW8sXIao1B4JKjh 10:O5KGXmXsAzFyQS4WsDe5 11:XazFlXYLNUty4HJASJCG 12:10rXqCTUMZwnjTvNqohD 13:0r5Tz0mGdvw6ezgMBSRO 14:o59yqMTmHZeLFfmpfqTv 15:00DWG1ts5Xsp6gLGdqzA 16:yhO55Z6QDu1GjswBDt3N; do
  n=${pair%%:*}; id=${pair##*:}
  curl -sS -o docs/video/menna/vo/$n.mp3 -H "xi-api-key: $ELEVENLABS_API_KEY" "https://api.elevenlabs.io/v1/history/$id/audio"
done
```

Then normalise to −16 LUFS for the edit:

```
cd docs/video/menna/vo && for f in *.mp3; do ffmpeg -y -i "$f" -af loudnorm=I=-16:TP=-1:LRA=3 "${f%.mp3}.wav"; done
```

Set 1 (multilingual v2, no tags) stays on the flow for reference only.
