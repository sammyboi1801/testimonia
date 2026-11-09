// Library requests to testimonia.web.app/api/** come here (a Firebase Hosting rewrite) and are fetched from the
// Testimonia server. Firebase Hosting's CDN keeps the answers the server marks cacheable (Cache-Control: public),
// so most readers are answered from Google's edge near them and never reach the small server.
// The assistant (/api/agent) does not come through here: it streams, and goes to the server directly.
const { onRequest } = require("firebase-functions/v2/https");

const ORIGIN = process.env.TESTIMONIA_ORIGIN || "https://35-209-1-30.sslip.io";

exports.api = onRequest({ region: "us-central1", memory: "256MiB", timeoutSeconds: 60, maxInstances: 5, concurrency: 40 }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("read only");
    return;
  }
  if (req.path.startsWith("/api/agent")) {
    res.status(404).send("the assistant is served directly");
    return;
  }
  try {
    const upstream = await fetch(ORIGIN + req.originalUrl, { headers: { "accept-encoding": "gzip" } });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "application/json");
    // the CDN keeps good answers for a day (s-maxage), browsers for an hour; errors are never kept
    if (upstream.ok && req.method === "GET") res.set("cache-control", "public, max-age=3600, s-maxage=86400");
    else res.set("cache-control", "no-store");
    res.send(body);
  } catch (e) {
    res.set("cache-control", "no-store");
    res.status(502).send("the library server did not answer");
  }
});
