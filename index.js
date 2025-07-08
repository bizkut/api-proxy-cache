const config = require('./src/config');

const elasticApmNode = require('elastic-apm-node');
const elasticApmOptions = {
  ...config.elasticApm,
  frameworkName: 'Express.js',
  frameworkVersion: require('express/package.json').version,
  serviceName: 'api-proxy-cache',
  serviceVersion: require('./package').version
};
if (elasticApmOptions.serverUrl) elasticApmNode.start(elasticApmOptions);

const express = require('express');
const apicache = require('apicache');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');
const redis = require('redis');
const path = require('path'); // Ensure path is required
const zlib = require('zlib'); // For gzip/deflate handling

const apicacheOptions = {
  debug: config.enable.apicacheDebug
};

if (config.redis.url) {
  apicacheOptions.redisClient = redis.createClient(config.redis);
}

const app = express();

app.use(cors());
if (config.enable.logging) app.use(morgan('combined'));
if (config.enable.compression) app.use(compression());

// Serve specific index.html for /apidoc and /apidoc/
app.get('/apidoc', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'apidoc', 'index.html'));
});
app.get('/apidoc/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'apidoc', 'index.html'));
});

// Serve static files from the 'public' directory
// This can remain for other potential static assets, or be removed if not needed elsewhere.
app.use(express.static('public'));

const cache = apicache.options(apicacheOptions).middleware;

app.get('/', (req, res) => {
  res.type('text/plain');
  res.send('OK');
});

const onlyStatus200 = (req, res) => res.statusCode === 200;
const cacheSuccesses = cache(config.cacheDuration, onlyStatus200);

for (const path in config.proxy) {
  const target = config.proxy[path];
  app.use(
    path,
    cacheSuccesses,
    createProxyMiddleware({
      changeOrigin: true,
      target,
      onProxyRes: function (proxyRes, req, res) {
        const targetDomain = 'yts.mx';
        const replacementDomain = 'flixapi.gametrader.my'; // As per user's previous request, ensure this is correct

        // Only modify text-based content types
        const contentType = proxyRes.headers['content-type'];
        const isTextBased = contentType && (
          contentType.includes('application/json') ||
          contentType.includes('text/html') ||
          contentType.includes('text/xml') ||
          contentType.includes('text/javascript') || // common JS MIME type
          contentType.includes('application/javascript') ||
          contentType.includes('application/x-javascript')
        );

        if (!isTextBased) {
          return; // Don't modify non-text responses
        }

        let body = [];
        proxyRes.on('data', function (chunk) {
          body.push(chunk);
        });

        proxyRes.on('end', function () {
          body = Buffer.concat(body);
          const contentEncoding = proxyRes.headers['content-encoding'];

          const processBody = (rawBody) => {
            let bodyString = rawBody.toString('utf8');
            if (bodyString.includes(targetDomain)) {
              bodyString = bodyString.replace(new RegExp(targetDomain.replace(/\./g, '\\.'), 'g'), replacementDomain);
            }
            return Buffer.from(bodyString, 'utf8');
          };

          const finishResponse = (modifiedBodyBuffer) => {
            res.setHeader('Content-Length', Buffer.byteLength(modifiedBodyBuffer));
            // If original was gzipped, we should ideally re-gzip.
            // For simplicity here, sending uncompressed if we decompressed.
            // Client should handle it. Or remove original encoding header.
            if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
                 // If we decompressed, it's now plain text.
                 // To properly re-compress is more involved.
                 // For now, remove encoding and let client get plain text.
                 // A more robust solution would re-compress.
                delete proxyRes.headers['content-encoding'];
            }
            // Remove other headers that might be problematic after modification
            delete proxyRes.headers['transfer-encoding']; // if it was chunked, it's not anymore

            // Pass through original status and headers (minus what we changed)
            // Important: writeHead should be called only once
            // We are not calling proxyRes.pipe(res) anymore as we handle the body
            // res.writeHead(proxyRes.statusCode, proxyRes.headers); // This can cause issues if headers are not perfectly synced

            // Let's try setting headers directly on `res` before writing body
            Object.keys(proxyRes.headers).forEach(key => {
                if (proxyRes.headers[key] !== undefined) {
                    res.setHeader(key, proxyRes.headers[key]);
                }
            });
            res.setHeader('Content-Length', Buffer.byteLength(modifiedBodyBuffer)); // ensure it's set after other headers

            res.status(proxyRes.statusCode).end(modifiedBodyBuffer);
          };

          if (contentEncoding === 'gzip') {
            zlib.gunzip(body, (err, decompressed) => {
              if (err) {
                console.error('Error decompressing gzip:', err);
                res.status(500).send('Error processing response.');
                return;
              }
              const modifiedBody = processBody(decompressed);
              finishResponse(modifiedBody);
            });
          } else if (contentEncoding === 'deflate') {
            zlib.inflate(body, (err, decompressed) => {
              if (err) {
                console.error('Error decompressing deflate:', err);
                res.status(500).send('Error processing response.');
                return;
              }
              const modifiedBody = processBody(decompressed);
              finishResponse(modifiedBody);
            });
          } else { // No compression or unknown
            const modifiedBody = processBody(body);
            finishResponse(modifiedBody);
          }
        });
      }
    })
  );
}

const server = app.listen(config.port, () => {
  console.log('Listening on port ' + server.address().port);
});
