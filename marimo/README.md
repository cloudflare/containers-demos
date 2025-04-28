# Marimo Notebook example

This example showcases how you can run a Marimo Notebook from a DO attached container.

## Deployment

0) npm install -g pnpm
1) open docker desktop / start docker via CLI
2) pnpm install

### Dev
> pnpm run dev

Local Notebook Server
> http://localhost:8787/

### Propduction
> pnpm run deploy

Production Notebook Server
https://marimo.edge-notebooks.workers.dev/

## View Deployment

### View image in Cloudchamber
> npx wrangler@latest cloudchamber images list

### Deployment History
> npx wrangler@latest deployments list

### Deployment Status
> npx wrangler@latest deployments status

### Delete deployment
> wrangler delete

TODO - fix this error so we can do clean deployments each time
```
╭ Deploy a container application deploy changes to your application
│
│ Container application changes
│ 
╰  ERROR  Application "container-marimo" is assigned to durable object 86b1576996c84ead953af7469c0b0a0a, but a new DO namespace is being assigned to the application,
                                        you should delete the container application and deploy again
 ELIFECYCLE  Command failed with exit code 1.
```

## Connect to the deployment

### Dev
Local Notebook Server
> http://localhost:8787/

### Propduction
Production Notebook Server
https://marimo.edge-notebooks.workers.dev/

### Tail Logs
> wrangler tail container-marimo

### Browser UI
> TODO - how do we connect to the instance on :8080 ?
