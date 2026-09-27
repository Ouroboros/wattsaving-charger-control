// 官方 iOS App 的 0x23 原始字节帧；仅在用户确认查询后发送，不记录设备字段或查询内容。
export type ExperimentalQuery = "vin-list" | "network-info";
export type ExperimentalFrame =
  | { type: "identity-report"; pile: string; gun: string }
  | { type: "vin-list-reply"; accepted: boolean }
  | { type: "network-info-reply" };

function byteHex(value: number): string { return value.toString(16).padStart(2, "0").toUpperCase(); }
export function experimentalQueryCommand(pile: string, gun: string, query: ExperimentalQuery): Uint8Array<ArrayBuffer> {
  if (query !== "vin-list" && query !== "network-info") throw new Error("未知的 APP 查询操作");
  if (!/^[0-9a-fA-F]{8}$/.test(pile) || !/^[0-9a-fA-F]{2}$/.test(gun)) throw new Error("缺少设备状态帧中的桩编码或枪号，禁止猜测报文字段");
  const frame = new Uint8Array(new ArrayBuffer(10));
  frame.set([0x23, 0x0a, query === "vin-list" ? 0x25 : 0x44]);
  for (let i = 0; i < 4; i++) frame[3 + i] = Number.parseInt(pile.slice(i * 2, i * 2 + 2), 16);
  frame[7] = Number.parseInt(gun, 16);
  frame[8] = 0x66;
  frame[9] = frame.slice(0, 9).reduce((sum, byte) => sum + byte, 0) & 0xff;
  return frame;
}

export function parseExperimentalFrame(bytes: Uint8Array): ExperimentalFrame | null {
  if (bytes.length < 5 || bytes.length !== bytes[1] || bytes[0] !== 0x23 || bytes[bytes.length - 2] !== 0x66 ||
    (bytes.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 0xff) !== bytes[bytes.length - 1]) return null;
  // APP 用 75 回报第 8 字节的结果码；返回的 VIN 内容不能展示或保存。
  if (bytes[2] === 0x75 && bytes.length >= 11) return { type: "vin-list-reply", accepted: bytes[8] === 1 };
  // 94 返回 4G 网络资料；只确认收到格式有效的回报，不解析/展示/保存其敏感内容。
  if (bytes[2] === 0x94) return { type: "network-info-reply" };
  // 54 只用于取得当前设备身份字段；不解析功率或档位，也不自动发送指令。
  if (bytes[2] === 0x54 && bytes.length >= 55) return {
    type: "identity-report", pile: [...bytes.slice(3, 7)].map(byteHex).join(""), gun: byteHex(bytes[7])
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
