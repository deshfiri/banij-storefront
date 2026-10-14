/**
 * DEVELOPMENT ONLY. Terminates TLS on 127.0.0.1:8443 with a self-signed certificate and forwards
 * the request byte-for-byte (method, raw path + query, headers, body) to the ERP dev server on
 * 127.0.0.1:8001. The storefront trusts the certificate through NODE_EXTRA_CA_CERTS, so the
 * storefront code path is plain HTTPS with full verification — no insecure flag anywhere.
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

const options = {
  key: readFileSync(new URL("./tls/erp-dev.key", import.meta.url)),
  cert: readFileSync(new URL("./tls/erp-dev.crt", import.meta.url)),
};

createServer(options, (incoming, outgoing) => {
  const upstream = request(
    { host: "127.0.0.1", port: 8001, method: incoming.method, path: incoming.url, headers: incoming.headers },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    outgoing.writeHead(502, { "content-type": "text/plain" });
    outgoing.end("erp dev server unreachable");
  });
  incoming.pipe(upstream);
}).listen(8443, "127.0.0.1", () => console.log("erp tls proxy on https://127.0.0.1:8443"));
