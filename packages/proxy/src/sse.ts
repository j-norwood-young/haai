import type { FastifyReply } from "fastify";
import { EventEmitter } from "node:events";

export type SseEventType =
  | "backend-health"
  | "vmodel-health"
  | "usage-event"
  | "key-event"
  | "log"
  | "system"
  | "request-start"
  | "request-end"
  | "live-tick";

export interface SseEvent {
  type: SseEventType;
  data: unknown;
  timestamp: number;
}

export class SseEmitter extends EventEmitter {
  private clients = new Set<FastifyReply>();

  addClient(reply: FastifyReply): void {
    this.clients.add(reply);
    reply.raw.on("close", () => {
      this.clients.delete(reply);
    });
  }

  emit(event: SseEventType, data: unknown): boolean {
    const payload: SseEvent = { type: event, data, timestamp: Date.now() };
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      try {
        client.raw.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
    return this.clients.size > 0;
  }

  broadcast(event: SseEventType, data: unknown): void {
    this.emit(event, data);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
