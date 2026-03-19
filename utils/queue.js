export class TaskQueue {
  constructor() {
    this.queue = [];
    this.running = null; 
  }

  async add(id, tabId, taskFn, forceImmediate = false) {
    if (this.running) {
      if (forceImmediate) {
        console.log(`[Queue] Aborting running task ${this.running.id} for ${id}`);
        this.running.controller.abort();
        this.running = null;
      } else {
        console.log(`[Queue] Enqueuing task ${id}`);
        // For simplicity in this global=1 model, we just reject/ignore the new task if not forced, 
        // OR we could queue it. Given "Global concurrency limit = 1 + interruptible", 
        // if user switches tab and clicks manually (force), it interrupts.
        // If it's auto task, it might just wait.
        // Let's implement a simple wait for non-force.
        while (this.running) {
            await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    const controller = new AbortController();
    this.running = { id, tabId, controller };

    try {
      const result = await taskFn(controller.signal);
      return result;
    } finally {
      if (this.running && this.running.id === id) {
          this.running = null;
      }
    }
  }

  getRunningTask() {
    return this.running;
  }
}

export const globalQueue = new TaskQueue();
