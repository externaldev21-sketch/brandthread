/**
 * Glue between a WebSocket hub and the realtime bus (lib/realtime/bus.ts).
 *
 * A hub keeps its own local delivery code untouched and adds two lines:
 *
 *   fanout.publish("broadcast", roomId, payload)   at the top of its broadcast
 *   fanout.start()                                  when its ws server attaches
 *
 * `publish` sends the event to the other instances. When one arrives, the
 * fanout calls the hub's own local function (e.g. broadcastToRoom) with a
 * re-entrancy flag set, so that call delivers to local sockets and does NOT
 * publish again. Delivery on the sending instance is unchanged and immediate.
 */
import { getRealtimeBus, type RealtimeBus } from "./bus";
import { logger } from "../logger";

export type FanoutApply = (room: string, payload: Record<string, unknown>) => void;

export interface RoomFanout {
  publish(kind: string, room: string, payload: Record<string, unknown>): void;
  /** Subscribes to the bus. Idempotent. */
  start(): void;
  /** True while a remote event is being delivered locally. */
  readonly applyingRemote: boolean;
}

type Wire = { k: string; r: string; p: Record<string, unknown> };

export function createRoomFanout(opts: {
  topic: string;
  apply: Record<string, FanoutApply>;
  /** Events every instance already produces for itself (never published). */
  localOnly?: (kind: string, payload: Record<string, unknown>) => boolean;
  bus?: () => RealtimeBus;
}): RoomFanout {
  const bus = opts.bus ?? getRealtimeBus;
  let applying = false;
  let started = false;

  return {
    get applyingRemote() { return applying; },

    publish(kind, room, payload) {
      if (applying) return;
      if (opts.localOnly?.(kind, payload)) return;
      try {
        bus().publish(opts.topic, { k: kind, r: room, p: payload } satisfies Wire);
      } catch (err) {
        logger.warn({ err, topic: opts.topic }, "realtime fanout publish failed");
      }
    },

    start() {
      if (started) return;
      started = true;
      bus().subscribe((topic, data) => {
        if (topic !== opts.topic) return;
        const wire = data as Partial<Wire> | null;
        if (!wire || typeof wire.k !== "string" || typeof wire.r !== "string") return;
        const fn = opts.apply[wire.k];
        if (!fn) return;
        applying = true;
        try {
          fn(wire.r, (wire.p ?? {}) as Record<string, unknown>);
        } catch (err) {
          logger.warn({ err, topic, kind: wire.k }, "realtime fanout delivery failed");
        } finally {
          applying = false;
        }
      });
    },
  };
}
