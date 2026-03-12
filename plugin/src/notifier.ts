import type { PluginApi } from "./types.js";

export type NotifyTarget =
  | { mode: "chat"; channelId: string }
  | { mode: "cli" }
  | { mode: "tool" };

/**
 * Sends progress messages to the user through whichever channel is available.
 * - Chat mode: uses api.sendChatMessage if available, falls back to logger
 * - CLI mode: uses console.log
 * - Tool mode: buffers messages (tools can only return output at the end)
 */
export class ClinicNotifier {
  private buffer: string[] = [];

  constructor(
    private api: PluginApi,
    private target: NotifyTarget,
  ) {}

  async status(msg: string): Promise<void> {
    await this.send(`[Claw Clinic] ${msg}`);
  }

  async progress(stepIndex: number, totalSteps: number, description: string): Promise<void> {
    await this.send(`[Claw Clinic] Step ${stepIndex + 1}/${totalSteps}: ${description}`);
  }

  async success(msg: string): Promise<void> {
    await this.send(`[Claw Clinic] ${msg}`);
  }

  async error(msg: string): Promise<void> {
    await this.send(`[Claw Clinic] Error: ${msg}`);
  }

  /** Get all buffered messages (for tool mode). */
  getBuffer(): string[] {
    return [...this.buffer];
  }

  /** Flush buffer and return joined text. */
  flush(): string {
    const text = this.buffer.join("\n");
    this.buffer = [];
    return text;
  }

  private async send(text: string): Promise<void> {
    this.buffer.push(text);

    switch (this.target.mode) {
      case "chat":
        if (this.api.sendChatMessage) {
          try {
            await this.api.sendChatMessage(this.target.channelId, text);
          } catch {
            this.api.logger.info(text);
          }
        } else {
          this.api.logger.info(text);
        }
        break;
      case "cli":
        console.log(text);
        break;
      case "tool":
        // Tool mode: only buffer, caller reads via getBuffer()/flush()
        this.api.logger.info(text);
        break;
    }
  }
}
