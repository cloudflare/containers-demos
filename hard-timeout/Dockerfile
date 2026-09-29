# syntax=docker/dockerfile:1

FROM node:18-slim

WORKDIR /app

# Create a simple HTTP server for demonstration
RUN echo 'const http = require("http"); \
const server = http.createServer((req, res) => { \
  res.writeHead(200, {"Content-Type": "text/plain"}); \
  res.end("Hard Timeout Demo Container\\n"); \
}); \
server.listen(8080, () => { \
  console.log("Server running on port 8080"); \
});' > server.js

EXPOSE 8080

CMD ["node", "server.js"]
