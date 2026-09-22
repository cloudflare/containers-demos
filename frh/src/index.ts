import { Container, getContainer, getRandom } from "@cloudflare/containers";
import { Hono } from "hono";

export class MyContainer extends Container<Env> {
	// Port the container listens on (default: 8080)
	defaultPort = 8080;
	// Time before container sleeps due to inactivity (default: 30s)
	sleepAfter = "2m";
	// Environment variables passed to the container
	envVars = {
		MESSAGE: "I was passed in via the container class!",
	};

	// Optional lifecycle hooks
	override onStart() {
		console.log("Container successfully started");
	}

	override onStop() {
		console.log("Container successfully shut down");
	}

	override onError(error: unknown) {
		console.log("Container error:", error);
	}
}

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
	Bindings: Env;
}>();

// Home route with available endpoints
app.get("/", (c) => {
	return c.text(
		"Available endpoints:\n" +
      "FRH mode: These endpoints specifies jurisdiction='fedramp-high' when getting the DO namespace.\n\n" +
			"GET /container/<ID> - Start a container for each ID with a 2m timeout\n" +
			"GET /lb - Load balance requests over multiple containers\n" +
			"GET /error - Start a container that errors (demonstrates error handling)\n" +
			"GET /singleton - Get a single specific container instance \n" +
      "Retail Mode: These endpoints do not set jurisdiction in their get DO calls.\n\n" +
      "GET /test/container/<ID> - Start a container for each ID without specifyin FRH jurisdiction"
	);
});

// retial: Route requests to a specific container using the container ID
app.get("/test/container/:id", async (c) => {
	const id = c.req.param("id");
  const containerNS = c.env.MY_CONTAINER;
	const containerId = containerNS.idFromName(`/container/${id}`);
	const container = containerNS.get(containerId);
	return await container.fetch(c.req.raw);
});


// FRH mode:
// Route requests to a specific container using the container ID
app.get("/container/:id", async (c) => {
	const id = c.req.param("id");
  const containerNS = c.env.MY_CONTAINER.jurisdiction("fedramp-high");
	const containerId = containerNS.idFromName(`/container/${id}`);
	const container = containerNS.get(containerId);
	return await container.fetch(c.req.raw);
});

// Demonstrate error handling - this route forces a panic in the container
app.get("/error", async (c) => {
	const container = getContainer(c.env.MY_CONTAINER.jurisdiction("fedramp-high"), "error-test");
	return await container.fetch(c.req.raw);
});

// Load balance requests across multiple containers
app.get("/lb", async (c) => {
	const container = await getRandom(c.env.MY_CONTAINER.jurisdiction("fedramp-high"), 3);
	return await container.fetch(c.req.raw);
});

// Get a single container instance (singleton pattern)
app.get("/singleton", async (c) => {
	const container = getContainer(c.env.MY_CONTAINER.jurisdiction("fedramp-high"));
	return await container.fetch(c.req.raw);
});

export default app;
