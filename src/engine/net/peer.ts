/**
 * Peer-to-peer transport for two-player sessions, with *manual* signaling:
 * instead of a signaling server, the connection bootstrap (WebRTC's SDP
 * offer/answer) is exported as a compact text code the players exchange
 * themselves (chat, email, QR). After the two paste-rounds the browsers
 * talk directly over an RTCDataChannel — no server, ever.
 *
 * Handshake:
 *   host:  const link = await PeerLink.host()        → link.code (send it)
 *   guest: const link = await PeerLink.join(code)    → link.code (send back)
 *   host:  await link.accept(guestCode)
 *   both:  onOpen fires; send()/onMessage carry JSON strings.
 *
 * Codes are deflate-compressed + base64url (CompressionStream when the
 * browser has it, plain base64url otherwise — both sides auto-detect).
 * ICE is gathered non-trickle (we wait for completion) so one code
 * carries everything. STUN via Google's public server; peers behind
 * strict symmetric NATs may still fail (no TURN — that would be a server).
 */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
/** Compressed codes get this prefix so decode() knows to inflate. */
const COMPRESSED = 'c.';
const PLAIN = 'p.';

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** SDP text → shareable code. */
export async function encodeSignal(sdp: string): Promise<string> {
  const raw = new TextEncoder().encode(sdp);
  if (typeof CompressionStream !== 'undefined') {
    return COMPRESSED + b64urlEncode(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return PLAIN + b64urlEncode(raw);
}

/** Shareable code → SDP text (throws on garbage). */
export async function decodeSignal(code: string): Promise<string> {
  const text = code.trim();
  const body = text.slice(2);
  if (text.startsWith(COMPRESSED)) {
    return new TextDecoder().decode(await pipe(b64urlDecode(body), new DecompressionStream('deflate-raw')));
  }
  if (text.startsWith(PLAIN)) return new TextDecoder().decode(b64urlDecode(body));
  throw new Error('unrecognized code');
}

/** Wait until ICE gathering finishes so the SDP contains all candidates. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    // Safety valve: some networks never report 'complete'; ship what we have.
    setTimeout(() => { pc.removeEventListener('icegatheringstatechange', check); resolve(); }, 3000);
  });
}

export type PeerRole = 'host' | 'guest';

export class PeerLink {
  /** The signal code to hand to the other player. */
  code = '';
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;

  private channel: RTCDataChannel | null = null;

  private constructor(
    public readonly role: PeerRole,
    private pc: RTCPeerConnection,
  ) {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.onClose?.();
      }
    });
  }

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  private adopt(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.addEventListener('open', () => this.onOpen?.());
    ch.addEventListener('close', () => this.onClose?.());
    ch.addEventListener('message', (e) => {
      if (typeof e.data === 'string') this.onMessage?.(e.data);
    });
  }

  /** Start hosting: resolves once `code` (the offer) is ready to share. */
  static async host(): Promise<PeerLink> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link = new PeerLink('host', pc);
    link.adopt(pc.createDataChannel('game', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    link.code = await encodeSignal(pc.localDescription!.sdp);
    return link;
  }

  /** Join with the host's code: resolves once the answer `code` is ready. */
  static async join(offerCode: string): Promise<PeerLink> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link = new PeerLink('guest', pc);
    pc.addEventListener('datachannel', (e) => link.adopt(e.channel));
    await pc.setRemoteDescription({ type: 'offer', sdp: await decodeSignal(offerCode) });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    link.code = await encodeSignal(pc.localDescription!.sdp);
    return link;
  }

  /** Host: accept the guest's answer code; the channel opens shortly after. */
  async accept(answerCode: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: await decodeSignal(answerCode) });
  }

  /** Send a message (JSON string). Silently dropped until the channel opens. */
  send(data: string): void {
    if (this.open) this.channel!.send(data);
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}
