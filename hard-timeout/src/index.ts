import { Container } from '@cloudflare/containers';

interface Env {
  // Define your environment variables here
}

export class TimeoutContainer extends Container<Env> {
  constructor(ctx: DurableObject['ctx'], env: Env) {
    super(ctx, env, {
      defaultPort: 8080,
      timeout: '15s',      // Timeout: kill container after 15 seconds
      sleepAfter: '10s'    // Soft timeout: sleep after 10 seconds of inactivity
    });
  }

  /**
   * Custom timeout handler
   * Called when the timeout expires (15 seconds after container start)
   */
  async onHardTimeoutExpired(): Promise<void> {
    console.log('🚨 Timeout expired! Container has been running for 15+ seconds.');
    console.log('💀 Container will now be forcefully terminated with SIGKILL.');
    
    // Call parent implementation to destroy the container
    await super.onHardTimeoutExpired();
  }

  /**
   * Custom activity timeout handler  
   * Called when the soft timeout expires (10 seconds of inactivity)
   */
  async onActivityExpired(): Promise<void> {
    console.log('😴 Activity timeout expired! No requests for 10+ seconds.');
    console.log('💤 Container will now be gracefully stopped with SIGTERM.');
    
    // Call parent implementation to stop the container
    await super.onActivityExpired();
  }

  /**
   * Main request handler
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/':
          return this.handleHome();
        case '/basic':
          return this.handleBasicTimeout();
        case '/long-task':
          return this.handleLongTask();
        case '/compare':
          return this.handleTimeoutComparison();
        case '/status':
          return this.handleStatus();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('Request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private handleHome(): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Hard Timeout Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .demo-link { display: block; margin: 10px 0; padding: 10px; background: #f0f0f0; border-radius: 5px; text-decoration: none; color: #333; }
        .demo-link:hover { background: #e0e0e0; }
        .timeout-info { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .warning { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>🕐 Container Timeout Demo</h1>
    
    <div class="timeout-info">
        <h3>⚙️ Current Configuration:</h3>
        <ul>
            <li><strong>Timeout:</strong> 15 seconds (absolute from container start)</li>
            <li><strong>Soft Timeout:</strong> 10 seconds (since last activity)</li>
            <li><strong>Default Port:</strong> 8080</li>
        </ul>
    </div>

    <div class="warning">
        <strong>⚠️ Warning:</strong> These demos will cause the container to restart when timeouts expire. 
        This is expected behavior for demonstration purposes.
    </div>

    <h2>Demo Scenarios:</h2>
    
    <a href="/basic" class="demo-link">
        <strong>🟢 Basic Timeout</strong><br>
        Shows container being killed after 15 seconds regardless of activity
    </a>
    
    <a href="/long-task" class="demo-link">
        <strong>🔴 Long-Running Task</strong><br>
        Simulates a 20-second task that gets terminated by hard timeout
    </a>
    
    <a href="/compare" class="demo-link">
        <strong>🔵 Timeout Comparison</strong><br>
        Compare soft timeout (resets on activity) vs timeout (never resets)
    </a>
    
    <a href="/status" class="demo-link">
        <strong>📊 Container Status</strong><br>
        View current container state and timing information
    </a>

    <h2>How It Works:</h2>
    <ol>
        <li><strong>Timeout:</strong> Counts from container start time, never resets</li>
        <li><strong>Soft Timeout:</strong> Counts from last activity, resets on each request</li>
        <li><strong>Priority:</strong> Timeout takes precedence when both would trigger</li>
        <li><strong>Termination:</strong> Timeout uses SIGKILL, soft timeout uses SIGTERM</li>
    </ol>
</body>
</html>`;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  private handleBasicTimeout(): Response {
    const startTime = Date.now();
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Basic Timeout Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .timer { font-size: 24px; font-weight: bold; color: #d73027; margin: 20px 0; }
        .info { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
    <script>
        let startTime = ${startTime};
        let timeoutMs = 15000; // 15 seconds
        
        function updateTimer() {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, timeoutMs - elapsed);
            const seconds = Math.ceil(remaining / 1000);
            
            document.getElementById('timer').textContent = 
                remaining > 0 ? \`⏰ Timeout in: \${seconds}s\` : '💀 Container should be terminated!';
            
            if (remaining > 0) {
                setTimeout(updateTimer, 100);
            }
        }
        
        document.addEventListener('DOMContentLoaded', updateTimer);
    </script>
</head>
<body>
    <h1>🟢 Basic Timeout Demo</h1>
    
    <div class="info">
        This page demonstrates the timeout feature. The container will be automatically 
        terminated after <strong>15 seconds</strong> from container start, regardless of any activity.
    </div>
    
    <div id="timer" class="timer">⏰ Loading...</div>
    
    <p><strong>What happens:</strong></p>
    <ol>
        <li>Container starts when you first access it</li>
        <li>Timeout timer begins (15 seconds)</li>
        <li>After 15 seconds, <code>onHardTimeoutExpired()</code> is called</li>
        <li>Container is forcefully killed with SIGKILL</li>
        <li>Next request will start a fresh container</li>
    </ol>
    
    <p><strong>Check the logs:</strong> You should see "Timeout expired!" messages when the timeout occurs.</p>
    
    <p><a href="/">← Back to Home</a></p>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  private async handleLongTask(): Promise<Response> {
    const taskDuration = 20000; // 20 seconds - longer than our 15s timeout
    const startTime = Date.now();
    
    // This task will be interrupted by the timeout
    try {
      await new Promise(resolve => setTimeout(resolve, taskDuration));
      
      // This should never execute due to hard timeout
      return new Response(JSON.stringify({
        message: "Task completed successfully!",
        duration: Date.now() - startTime,
        warning: "This shouldn't happen - timeout should have killed the container"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({
        message: "Task was interrupted",
        error: error instanceof Error ? error.message : String(error),
        elapsed: Date.now() - startTime
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private handleTimeoutComparison(): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Timeout Comparison Demo</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .comparison { display: flex; gap: 20px; }
        .timeout-box { flex: 1; padding: 20px; border-radius: 10px; }
        .soft-timeout { background: #e8f5e8; border: 2px solid #4caf50; }
        .timeout { background: #ffeaea; border: 2px solid #f44336; }
        .timer { font-size: 18px; font-weight: bold; margin: 10px 0; }
        .description { margin: 15px 0; }
        button { padding: 10px 20px; margin: 5px; background: #2196f3; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #1976d2; }
    </style>
    <script>
        let pageLoadTime = Date.now();
        let lastActivityTime = Date.now();
        
        function updateTimers() {
            const now = Date.now();
            
            // Timeout: 15s from container start (page load)
            const hardElapsed = now - pageLoadTime;
            const hardRemaining = Math.max(0, 15000 - hardElapsed);
            
            // Soft timeout: 10s from last activity
            const softElapsed = now - lastActivityTime;
            const softRemaining = Math.max(0, 10000 - softElapsed);
            
            document.getElementById('hard-timer').textContent = 
                hardRemaining > 0 ? \`⏰ \${Math.ceil(hardRemaining/1000)}s remaining\` : '💀 EXPIRED';
                
            document.getElementById('soft-timer').textContent = 
                softRemaining > 0 ? \`😴 \${Math.ceil(softRemaining/1000)}s remaining\` : '💤 EXPIRED';
            
            setTimeout(updateTimers, 100);
        }
        
        function recordActivity() {
            lastActivityTime = Date.now();
            document.getElementById('activity-log').textContent = 'Activity recorded! Soft timeout reset.';
            setTimeout(() => {
                document.getElementById('activity-log').textContent = '';
            }, 2000);
        }
        
        document.addEventListener('DOMContentLoaded', updateTimers);
    </script>
</head>
<body>
    <h1>🔵 Timeout Comparison Demo</h1>
    
    <div class="comparison">
        <div class="timeout-box soft-timeout">
            <h3>💚 Soft Timeout (Activity-Based)</h3>
            <div id="soft-timer" class="timer">😴 Loading...</div>
            <div class="description">
                <strong>10 seconds</strong> since last activity<br>
                <strong>Resets</strong> on each request<br>
                <strong>Action:</strong> SIGTERM (graceful)
            </div>
            <button onclick="recordActivity()">🔄 Reset Soft Timeout</button>
        </div>
        
        <div class="timeout-box timeout">
            <h3>❤️ Timeout (Absolute)</h3>
            <div id="hard-timer" class="timer">⏰ Loading...</div>
            <div class="description">
                <strong>15 seconds</strong> from container start<br>
                <strong>Never resets</strong> regardless of activity<br>
                <strong>Action:</strong> SIGKILL (forceful)
            </div>
            <button disabled>🚫 Cannot Reset</button>
        </div>
    </div>
    
    <div id="activity-log" style="text-align: center; color: green; font-weight: bold; margin: 20px 0;"></div>
    
    <div style="background: #f0f0f0; padding: 20px; border-radius: 10px; margin: 20px 0;">
        <h3>🧪 Experiment:</h3>
        <ol>
            <li>Watch both timers count down</li>
            <li>Click "Reset Soft Timeout" to see how only the soft timeout resets</li>
            <li>Notice that the timeout never resets, regardless of activity</li>
            <li>The timeout will kill the container even if you're actively using it</li>
        </ol>
        <p><strong>Result:</strong> Timeout takes precedence and will terminate the container at 15 seconds.</p>
    </div>
    
    <p><a href="/">← Back to Home</a></p>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  private async handleStatus(): Promise<Response> {
    const state = await this.getState();
    
    const status = {
      containerState: state,
      currentTime: new Date().toISOString(),
      timeout: '15s',
      softTimeout: '10s',
      lastChange: new Date(state.lastChange).toISOString(),
      uptime: `${Math.round((Date.now() - state.lastChange) / 1000)}s`
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Container Status</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        .status-card { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .status-item { margin: 10px 0; }
        .status-label { font-weight: bold; color: #666; }
        .status-value { color: #333; }
        .refresh-btn { padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; }
    </style>
    <script>
        function refreshPage() {
            window.location.reload();
        }
        
        // Auto-refresh every 2 seconds
        setTimeout(refreshPage, 2000);
    </script>
</head>
<body>
    <h1>📊 Container Status</h1>
    
    <div class="status-card">
        <div class="status-item">
            <span class="status-label">Container State:</span>
            <span class="status-value">${state.status}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Current Time:</span>
            <span class="status-value">${status.currentTime}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Last State Change:</span>
            <span class="status-value">${status.lastChange}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Uptime:</span>
            <span class="status-value">${status.uptime}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Timeout:</span>
            <span class="status-value">${status.timeout}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Soft Timeout:</span>
            <span class="status-value">${status.softTimeout}</span>
        </div>
    </div>
    
    <button class="refresh-btn" onclick="refreshPage()">🔄 Refresh Status</button>
    
    <p><em>This page auto-refreshes every 2 seconds</em></p>
    <p><a href="/">← Back to Home</a></p>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Export the Durable Object
export { TimeoutContainer as default };
