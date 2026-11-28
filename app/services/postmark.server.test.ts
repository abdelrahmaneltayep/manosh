import { describe, expect, it } from "vitest";
import { formatFrom, postmarkPayload, postmarkTransport, PostmarkError } from "./postmark.server";

const MESSAGE = {
  to: "buyer@example.com",
  subject: "Your quote",
  html: "Line one\nLine <two>",
  text: "Line one\nLine <two>",
  fromName: 'Acme "Wholesale"',
  attachments: [{ filename: "quote.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
};

describe("Postmark payload", () => {
  it("sends from the configured address with the store's name, replies to the same address", () => {
    const body = postmarkPayload(MESSAGE, "quotes@support-mannon.com", "outbound");
    expect(body.From).toBe('"Acme Wholesale" <quotes@support-mannon.com>');
    expect(body.ReplyTo).toBe("quotes@support-mannon.com");
    expect(body.To).toBe("buyer@example.com");
    expect(body.MessageStream).toBe("outbound");
    // Plain text passed as HTML keeps its line breaks and is escaped.
    expect(body.HtmlBody).toBe("Line one<br>Line &lt;two&gt;");
    expect(body.Attachments).toEqual([{ Name: "quote.pdf", Content: "AQID", ContentType: "application/pdf" }]);
  });

  it("leaves real HTML alone and handles a missing name", () => {
    expect(postmarkPayload({ to: "a@b.co", subject: "s", html: "<p>Hi</p>" }, "q@x.co", "outbound").HtmlBody).toBe("<p>Hi</p>");
    expect(formatFrom("q@x.co", null)).toBe("q@x.co");
  });
});

describe("Postmark transport", () => {
  const env = { POSTMARK_SERVER_TOKEN: "test-token", POSTMARK_API_URL: "https://postmark.test/email" };

  it("posts with the server token and returns the message id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: "abc-123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await postmarkTransport(env, fake)(MESSAGE, "quotes@support-mannon.com");
    expect(result).toEqual({ messageId: "abc-123" });
    expect(calls[0].url).toBe("https://postmark.test/email");
    expect((calls[0].init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("test-token");
  });

  it("throws Postmark's own reason when it refuses", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ ErrorCode: 400, Message: "The 'From' address you supplied is not a Sender Signature." }), { status: 422 })) as unknown as typeof fetch;
    await expect(postmarkTransport(env, fake)(MESSAGE, "x@y.co")).rejects.toThrow(/not a Sender Signature/);
  });

  it("refuses to run without a token", async () => {
    await expect(postmarkTransport({}, fetch)(MESSAGE, "x@y.co")).rejects.toBeInstanceOf(PostmarkError);
  });
});

describe("Postmark payload escaping", () => {
  it("never turns text a buyer typed into markup", () => {
    const typed = 'Need 10 units <b onclick="x">now</b>';
    const body = postmarkPayload({ to: "a@b.co", subject: "s", html: typed, text: typed }, "q@x.co", "outbound");
    expect(body.HtmlBody).toBe("Need 10 units &lt;b onclick=&quot;x&quot;&gt;now&lt;/b&gt;");
  });
});

describe("Postmark payload escaping, pre-converted text", () => {
  it("escapes text that a sender already turned into <br> lines", () => {
    const text = "From: <script>x</script>\nThanks";
    const body = postmarkPayload({ to: "a@b.co", subject: "s", html: text.replace(/\n/g, "<br>"), text }, "q@x.co", "outbound");
    expect(body.HtmlBody).toBe("From: &lt;script&gt;x&lt;/script&gt;<br>Thanks");
  });
});

describe("Postmark Reply-To", () => {
  it("uses the store's address when the message names one", () => {
    const body = postmarkPayload({ to: "buyer@x.co", subject: "s", html: "h", replyTo: "owner@store.example" }, "quotes@support-mannon.com", "outbound");
    expect(body.ReplyTo).toBe("owner@store.example");
  });
});
