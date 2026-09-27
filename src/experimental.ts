// 官方 iOS App 的 0x23 原始字节帧；仅用于独立的实验性档位操作与被动通知。
export interface PowerReport {
  type: "power-report";
  gear: number;
  powerTenths: number; // App 按此数值除以 10；单位尚未由设备实包核实。
}
export interface GearReply { type: "gear-reply"; code: number; accepted: boolean; }
export type ExperimentalFrame = PowerReport | GearReply;

export function experimentalGearCommand(pile: string, gun: string, gear: number): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{8}$/.test(pile)) throw new Error("桩编码须为从 App 实包核实的 8 位十六进制数");
  if (!/^[0-9a-fA-F]{2}$/.test(gun)) throw new Error("枪号须为从 App 实包核实的 2 位十六进制数");
  if (!Number.isInteger(gear) || gear < 0 || gear > 3) throw new Error("实验性档位仅允许 0～3");
  const frame = new Uint8Array(new ArrayBuffer(11));
  frame.set([0x23, 0x0b, 0x32]);
  for (let i = 0; i < 4; i++) frame[3 + i] = Number.parseInt(pile.slice(i * 2, i * 2 + 2), 16);
  frame[7] = Number.parseInt(gun, 16);
  frame[8] = gear;
  frame[9] = 0x66;
  frame[10] = frame.slice(0, 10).reduce((sum, byte) => sum + byte, 0) & 0xff;
  return frame;
}

export function parseExperimentalFrame(bytes: Uint8Array): ExperimentalFrame | null {
  if (bytes.length < 5 || bytes.length !== bytes[1] || bytes[0] !== 0x23 || bytes[bytes.length - 2] !== 0x66 ||
    (bytes.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 0xff) !== bytes[bytes.length - 1]) return null;
  // App 将完整帧的第八字节作为 82 的成功码（十六进制字符串偏移 0x10）。
  if (bytes[2] === 0x82 && bytes.length >= 11) return { type: "gear-reply", code: bytes[8], accepted: bytes[8] === 1 };
  // 54 消息体的第 47/48 字节是小端的功率原始值，第 49 字节是档位。
  if (bytes[2] === 0x54 && bytes.length >= 55) return {
    type: "power-report", powerTenths: bytes[50] | bytes[51] << 8, gear: bytes[52]
  };
  return null;
}

// 分片 BLE 通知中分离二进制帧，不把它们塞进现有的 ASCII FrameDecoder。
export class ExperimentalDecoder {
  private buffer: number[] = [];
  reset(): void { this.buffer = []; }
  feed(chunk: Uint8Array): { frames: ExperimentalFrame[]; text: Uint8Array } {
    const frames: ExperimentalFrame[] = [];
    const text: number[] = [];
    for (const byte of chunk) {
      this.buffer.push(byte);
      while (this.buffer.length) {
        if (this.buffer[0] !== 0x23) { text.push(this.buffer.shift()!); continue; }
        if (this.buffer.length < 2) break;
        const length = this.buffer[1];
        if (length < 5 || length > 128) { text.push(this.buffer.shift()!); continue; }
        if (this.buffer.length < length) break;
        const packet = Uint8Array.from(this.buffer.slice(0, length));
        // 先验证整帧；合法但未知的操作号也不作为 ASCII 报文处理。
        const valid = packet[0] === 0x23 && packet[1] === length && packet[length - 2] === 0x66 &&
          (packet.slice(0, -1).reduce((sum, part) => sum + part, 0) & 0xff) === packet[length - 1];
        if (!valid) { text.push(this.buffer.shift()!); continue; }
        this.buffer.splice(0, length);
        const parsed = parseExperimentalFrame(packet);
        if (parsed) frames.push(parsed);
      }
    }
    return { frames, text: Uint8Array.from(text) };
  }
}
