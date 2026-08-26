export const dynamic = "force-static";

export function GET() {
  return new Response("did:plc:lmkzmvv6sdxntwtyxpg7fqqq\n", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
