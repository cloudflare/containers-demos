export const TERMINAL_HOST = 'terminal-server';

// Terminal server code that runs inside the container.
// Uses node-pty for proper PTY support and ws for WebSocket handling.
export const terminalServerCode = `
const os = require("os");
const pty = require("node-pty"); // Pseudo-terminal spawner
const WebSocket = require("ws"); // WebSocket library

const PORT = process.env.PORT || 3001; // Port for the WebSocket server
const WS_PATH = "/terminal/ws"; // Path for WebSocket connections

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ port: PORT, path: WS_PATH });

console.log(\`🚀 WebSocket server started on ws://localhost:\${PORT}\${WS_PATH}\`);
if (os.platform() !== "win32" && process.getuid && process.getuid() === 0) {
  console.warn(
    "\\x1b[33m⚠️ WARNING: Server is running as root. This is not recommended for production.\\x1b[0m",
  );
}
console.log("Waiting for client connections...");

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(\`\\n🔗 Client connected: \${clientIp}\`);

  // --- PTY Process Setup ---
  // Determine the shell based on the OS
  const shell =
    os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "sh";
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color", // Terminal type
    cols: 80, // Initial columns
    rows: 30, // Initial rows
    cwd: process.env.HOME || process.env.USERPROFILE, // User's home directory
    env: { ...process.env, LANG: "en_US.UTF-8" }, // Ensure UTF-8 for proper character display
  });

  console.log(
    \`  ��� PTY process created for \${clientIp} (PID: \${ptyProcess.pid}, Shell: \${shell})\`,
  );

  // --- Data Flow: WebSocket -> PTY ---
  ws.on("message", (message) => {
    try {
      // The message from xterm-addon-attach is what the user types.
      // It can be a string or Buffer. node-pty's write method handles both.
      ptyProcess.write(message);
    } catch (e) {
      console.error(\`Error writing to PTY for \${clientIp}:\`, e);
      return;
    }
  });

  // --- Data Flow: PTY -> WebSocket ---
  ptyProcess.onData((data) => {
    try {
      // Send data from PTY (shell output) to the WebSocket client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch (e) {
      // This can happen if the WebSocket closes abruptly.
      console.error(
        \`Error sending PTY data to WebSocket for \${clientIp}:\`,
        e.message,
      );
    }
  });

  // --- PTY Process Exit ---
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(
      \`  ↳ PTY process for \${clientIp} (PID: \${ptyProcess.pid}) exited. Code: \${exitCode}, Signal: \${signal}\`,
    );
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        \`\\r\\n\\x1b[31mShell process exited (Code: \${exitCode || "N/A"}, Signal: \${signal || "N/A"}). Session terminated.\\x1b[0m\\r\\n\`,
      );
      ws.close(1000, \`PTY exited. Code: \${exitCode}, Signal: \${signal}\`);
    }
  });

  // --- WebSocket Close ---
  ws.on("close", (code, reason) => {
    console.log(
      \`🔌 Client disconnected: \${clientIp}. Code: \${code}, Reason: \${reason || "N/A"}\`,
    );
    // Clean up the PTY process when the WebSocket connection closes
    if (ptyProcess && ptyProcess.pid && !ptyProcess.killed) {
      try {
        ptyProcess.kill();
        console.log(
          \`  ↳ Killed PTY process for \${clientIp} (PID: \${ptyProcess.pid}) due to WebSocket close.\`,
        );
      } catch (e) {
        console.error(\`Error killing PTY for \${clientIp}:\`, e);
      }
    }
  });

  // --- WebSocket Error ---
  ws.on("error", (error) => {
    console.error(\`WebSocket error for client \${clientIp}:\`, error);
    // ptyProcess cleanup will be handled by 'close' event which usually follows 'error'
  });
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(\`\\n\${signal} received. Shutting down server...\`);
  wss.close(() => {
    console.log("WebSocket server closed.");
    // Give PTYs a moment to be cleaned up by their respective ws.on('close') handlers
    setTimeout(() => {
      console.log("Exiting.");
      process.exit(0);
    }, 500);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
`;

// HTML page for the terminal UI, served by the worker on /terminal
export const terminalHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Container Terminal</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; display: flex; align-items: center; justify-content: center; height: 100vh; }
    #terminal { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script>
    const term = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: '#1e1e1e' } });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('terminal'));
    fit.fit();
    window.addEventListener('resize', () => fit.fit());

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/terminal/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => term.write('\\r\\nConnected to container.\\r\\n');
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
      term.write(data);
    };
    ws.onclose = () => term.write('\\r\\n[Connection closed]\\r\\n');
    ws.onerror = () => term.write('\\r\\n[Connection error]\\r\\n');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  </script>
</body>
</html>
`;
