# App Store screenshots — index

Central registry of the rendered listing screenshots. All are 1600×900, light UI,
`device_scale_factor=1`, on the Mannon brand (indigo `#4F46E5` / lime `#A3E635`).
The **core 5** are the store gallery + the ≤60s reel; extras are gallery
candidates. Regenerate each from the live UI once the feature ships (these are
faithful mocks built in the container, which can't reach a store).

| # | File | Feature | Shows | Gallery |
|---|------|---------|-------|---------|
| 1 | `f1-ai-quote.png` | F1 AI Quote Assistant | Quote detail with the AI suggestion panel (price + margin + draft) | core |
| 2 | `f2-net-terms.png` | F2 Net Terms + Credit | Aging dashboard + a buyer invoice with due date | core |
| 3 | `f3-price-lists.png` | F3 Price Lists | Price-list grid (prices + volume breaks) + buyer "you save X%" | core |
| 4 | `f4-order-pad.png` | F4 Bulk Order Pad | Order pad with pasted SKUs + a live subtotal | core |
| 5 | `f5-company-accounts.png` | F5 Company Accounts | Team tab with roles + an approval-request state | core |
| 6 | `f6-wholesale-registration.png` | F6 Wholesale Registration | Admin approval queue with a pending application open | candidate (funnel story) |
| 7 | `f7-quote-analytics.png` | F7 Quote Analytics | Analytics dashboard: KPI cards + trend sparklines + top accounts | candidate (strong — promote into store 7) |
| 8 | `f8-followups.png` | F8 Quote Follow-ups | A quote with its expiry + scheduled follow-up timeline (day 3/7/12 + expiry) | candidate |
| 9 | `f9-moq-rules.png` | F9 MOQ / Order Rules | Buyer order pad rounding qty 20→24 (case of 12) + a minimum-order progress bar | candidate (docs GIF) |

## Reel order (extended cut)

Opening → **F4** order pad · **F1** AI counter-offer (hero) · **F2** net-terms
invoice · **F3** custom pricing · **F5** team approvals (closing) · **F6** wholesale
sign-up (extended B-roll) · **F7** analytics (standalone 15s social cut). Keep the
core store reel ≤ 60s — see `marketing/video-script.md`.
