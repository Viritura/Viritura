export const prerender = true;

export function GET() {
  return new Response("User-agent: *\nAllow: /\nSitemap: https://viritura.com/sitemap.xml\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
