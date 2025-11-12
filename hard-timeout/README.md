# Container Timeout Demo

This example demonstrates the timeout feature for Cloudflare Containers. The timeout automatically kills containers after a specified absolute time from container start, regardless of activity.

## Key Features

- **Timeout**: Absolute timeout from container start time (vs soft timeout based on inactivity)
- **Automatic termination**: Container is forcefully killed with SIGKILL when timeout expires
- **Lifecycle hook**: `onHardTimeoutExpired()` method called when timeout occurs
- **Complementary to soft timeout**: Works alongside existing activity-based timeout

## Timeout vs Soft Timeout

| Feature | Soft Timeout (sleepAfter) | Timeout |
|---------|---------------------------|---------|
| **Trigger** | Time since last activity | Time since container start |
| **Signal** | SIGTERM (graceful) | SIGKILL (forceful) |
| **Reset** | Reset on activity | Never resets |
| **Use Case** | Save resources during inactivity | Prevent runaway containers |

## Configuration

```typescript
export class TimeoutContainer extends Container {
  constructor(ctx: DurableObject['ctx'], env: Env) {
    super(ctx, env, {
      defaultPort: 8080,
      timeout: '30s',      // Kill container after 30 seconds regardless of activity
      sleepAfter: '10s'    // Soft timeout for inactivity (still works)
    });
  }
}
```

## Demo Scenarios

### 1. Basic Timeout (`/basic`)
- Container configured with 15-second timeout
- Shows automatic container termination after timeout
- Demonstrates `onHardTimeoutExpired()` lifecycle hook

### 2. Long-Running Task (`/long-task`)
- Simulates a long-running computation that would exceed timeout
- Shows how timeout takes precedence over activity

### 3. Timeout Comparison (`/compare`)
- Side-by-side comparison of soft vs timeout behavior
- Shows how activity resets soft timeout but not timeout

## Running the Demo

1. **Deploy the container:**
   ```bash
   npm run deploy
   ```

2. **Test different scenarios:**
   ```bash
   # Basic timeout demo
   curl https://timeout-demo.your-subdomain.workers.dev/basic
   
   # Long running task demo  
   curl https://timeout-demo.your-subdomain.workers.dev/long-task
   
   # Timeout comparison demo
   curl https://timeout-demo.your-subdomain.workers.dev/compare
   ```

3. **Monitor container lifecycle:**
   - Check Worker logs to see timeout events
   - Watch for "Timeout expired" messages
   - Observe container restart behavior

## Time Expression Formats

The `timeout` option supports various time expressions:

```typescript
timeout: '30s'    // 30 seconds
timeout: '5m'     // 5 minutes  
timeout: '1h'     // 1 hour
timeout: 120      // 120 seconds (number)
```

## Best Practices

1. **Set reasonable limits**: Choose timeouts based on your workload
2. **Override lifecycle hooks**: Implement `onHardTimeoutExpired()` for cleanup
3. **Monitor and alert**: Track timeout events for operational visibility
4. **Balance with soft timeout**: Use both timeouts for comprehensive resource management

## Implementation Notes

- Uses workerd's native `hardTimeout` option instead of alarms
- Timeout starts when container starts, not per request
- Uses `destroy()` by default for immediate termination
- Takes priority over soft timeout when both would trigger
