/**
 * Runs once before the server accepts requests. The boot-time validation itself is Node.js-only
 * (it may exit the process), so it lives in ./instrumentation-node and is loaded only on that runtime.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
