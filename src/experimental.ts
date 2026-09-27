// 官方 iOS App 的 0x23 原始字节帧；仅在用户操作后发送，不记录设备字段或查询内容。
export type ExperimentalQuery = "vin-list" | "network-info";
export interface PowerReport {
  type: "power-report";
  gear: number;
  powerTenths: number; // App 按此数值除以 10；单位尚未由设备实包核实。
  pile: string; // App 从完整 54 帧的字节 3–6 提取桩编码，不展示、不持久化。
  gun: string; // 完整帧字节 7：枪号。
}
export interface GearReply { type: "gear-reply"; code: number; accepted: boolean; }
export type ExperimentalFrame = PowerReport | GearReply |
  { type: "vin-list-reply"; accepted: boolean } |
  { type: "network-info-reply" };

function byteHex(value: number): string { return value.toString(16).padStart(2, "0").toUpperCase(); }
function frameFor(pile: string, gun: string, opcode: number, parameter?: number): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]{8}$/.test(pile) || !/^[0-9a-fA-F]{2}$/.test(gun)) throw new Error("缺少设备状态帧中的桩编码或枪号，禁止猜测报文字段");
  const frame = new Uint8Array(new ArrayBuffer(parameter === undefined ? 10 : 11));
  frame.set([0x23, frame.length, opcode]);
  for (let i = 0; i < 4; i++) frame[3 + i] = Number.parseInt(pile.slice(i * 2, i * 2 + 2), 16);
  frame[7] = Number.parseInt(gun, 16);
  if (parameter !== undefined) frame[8] = parameter;
  frame[frame.length - 2] = 0x66;
  frame[frame.length - 1] = frame.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 0xff;
  return frame;
}
export function experimentalGearCommand(pile: string, gun: string, gear: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(gear) || gear < 0 || gear > 3) throw new Error("实验性档位仅允许 0～3");
  return frameFor(pile, gun, 0x32, gear);
}
export function experimentalQueryCommand(pile: string, gun: string, query: ExperimentalQuery): Uint8Array<ArrayBuffer> {
  if (query !== "vin-list" && query !== "network-info") throw new Error("未知的 APP 查询操作");
  return frameFor(pile, gun, query === "vin-list" ? 0x25 : 0x44);
}

export function parseExperimentalFrame(bytes: Uint8Array): ExperimentalFrame | null {
  if (bytes.length < 5 || bytes.length !== bytes[1] || bytes[0] !== 0x23 || bytes[bytes.length - 2] !== 0x66 ||
    (bytes.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 0xff) !== bytes[bytes.length - 1]) return null;
  // App 将完整帧的第八字节作为 82 和 75 的结果码（十六进制字符串偏移 0x10）。
  if (bytes[2] === 0x82 && bytes.length >= 11) return { type: "gear-reply", code: bytes[8], accepted: bytes[8] === 1 };
  if (bytes[2] === 0x75 && bytes.length >= 11) return { type: "vin-list-reply", accepted: bytes[8] === 1 };
  // 94 返回 4G 网络资料；只确认收到格式有效的回报，不解析/展示/保存其敏感内容。
  if (bytes[2] === 0x94 && bytes.length >= 5) return { type: "network-info-reply" };
  // 54 消息体的第 47/48 字节是小端的功率原始值，第 49 字节是档位。
  if (bytes[2] === 0x54 && bytes.length >= 55) return {
    type: "power-report", powerTenths: bytes[50] | bytes[51] << 8, gear: bytes[52],
    pile: [...bytes.slice(3, 7)].map(byteHex).join(""), gun: byteHex(bytes[7])
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
        if (length < 5) { text.push(this.buffer.shift()!); continue; }
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
