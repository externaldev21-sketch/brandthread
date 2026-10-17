import { PassThrough, Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { disconnectSafeStorageStream } from "./disconnectSafeStorageStream";

describe("storage responses survive client disconnects", () => {
  it("preserves streamed bytes and normal completion", async () => {
    const bytes: Buffer[] = [];
    const destination = new Writable({ write(chunk, _encoding, done) { bytes.push(Buffer.from(chunk)); done(); } });
    await pipeline(disconnectSafeStorageStream(Readable.from([Buffer.from("video-range")])), destination);
    expect(Buffer.concat(bytes).toString()).toBe("video-range");
  });
  it("does not destroy a lazy SDK source when the response closes before headers arrive", async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const transfer = pipeline(disconnectSafeStorageStream(source), destination);
    destination.destroy();
    await expect(transfer).rejects.toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
    // The SDK's delayed onResponse must still find its destination alive.
    expect(source.destroyed).toBe(false);
    const done = finished(source);
    source.end(Buffer.from("late-cloud-response"));
    await done;
    expect(source.readableEnded).toBe(true);
  });
  it("consumes a late cloud error after cancellation without an unhandled event", async () => {
    const source = new PassThrough(), destination = new PassThrough();
    const transfer = pipeline(disconnectSafeStorageStream(source), destination);
    destination.destroy();
    await expect(transfer).rejects.toBeTruthy();
    source.destroy(new Error("late storage failure"));
    await new Promise(resolve => setImmediate(resolve));
    expect(source.destroyed).toBe(true);
  });
  it("propagates real storage errors while the client is connected", async () => {
    const source = new PassThrough();
    const transfer = pipeline(disconnectSafeStorageStream(source), new PassThrough());
    source.destroy(new Error("storage unavailable"));
    await expect(transfer).rejects.toThrow("storage unavailable");
  });
});
