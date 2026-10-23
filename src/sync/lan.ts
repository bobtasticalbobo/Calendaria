import type { SqlDriver } from "../db/driver";
import { type Clock, newId, systemClock } from "../db/records";
import type { SettingsRepository } from "../db/settings";
import { SyncError } from "./sync";
import { type Snapshot, syncDatabase } from "./merge";

/**
 * Sync over the home network (or Tailscale), straight between devices.
 *
 * Devices that sync form a group sharing one random 256-bit key. A device
 * joins by typing or scanning a one-time pairing code shown by a PC already
 * in the group; the code encrypts the handover of the key, so the key itself
 * never crosses the network in the clear. After that every message is
 * AES-256-GCM with the group key: a device that doesn't have it can neither
 * read nor change anything.
 *
 * PCs run a small server; the phone only calls out. A round sends this
 * device's rows, the other side merges them (newest change wins per row) and
 * answers with the merged rows, which are merged here in turn.
 */

export const DEVICE_KEY = "lan.device";
export const GROUP_KEY = "lan.group";
export const PEERS_KEY = "lan.peers";
export const DEFAULT_PORT = 47213;
/** A pairing code works for this long, once. */
export const PAIRING_MS = 10 * 60_000;
const PAIRING_ITERATIONS = 200_000;
/** Wrong codes allowed before the code is cancelled, against guessing. */
const PAIRING_ATTEMPTS = 5;
/** Letters and digits that can't be mistaken for each other. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Another Calendaria seen on the network. */
export interface Found {
  id: string;
  name: string;
  group: string;
  port: number;
  addresses: string[];
}

/** What the app needs from the platform; Tauri commands in the app, a fake in tests. */
export interface Transport {
  /** Throws when nothing answers. */
  post(url: string, body: string): Promise<{ status: number; body: string }>;
  browse(): Promise<Found[]>;
}

/** How a device describes itself to the others. `port` is null for a phone, which serves nothing. */
export interface DeviceInfo {
  id: string;
  name: string;
  port: number | null;
  addresses: string[];
}

export interface Peer extends DeviceInfo {
  lastSync: string | null;
}

interface Envelope {
  v: 1;
  kind: "sync" | "synced" | "join" | "joined";
  /** The group's public id, so a device can tell another group's message from a broken one. */
  g?: string;
  iv: string;
  data: string;
}

export class PairingError extends SyncError {}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function seal(key: CryptoKey, kind: Envelope["kind"], payload: unknown, g?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload)));
  const envelope: Envelope = { v: 1, kind, g, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
  return JSON.stringify(envelope);
}

/** Null when the key doesn't fit (wrong group, wrong code, or tampered). */
async function unseal<T>(key: CryptoKey, envelope: Envelope): Promise<T | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data),
    );
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}

function groupKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** The group's public id: a hash of the key, which says nothing about the key. */
export async function groupId(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`calendaria-group:${secret}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const codeKeys = new Map<string, Promise<CryptoKey>>();

function codeKey(code: string): Promise<CryptoKey> {
  let key = codeKeys.get(code);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey(
          { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("calendaria-pairing-v1"), iterations: PAIRING_ITERATIONS },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    codeKeys.set(code, key);
  }
  return key;
}

/** A new pairing code, e.g. "K7QF-2M9X-HD4P" (about 59 bits). */
export function newPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = [...bytes].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** Accepts the code as typed: any case, with or without dashes or spaces. */
export function normalizeCode(text: string): string {
  const chars = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return chars.length === 12 ? `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}` : chars;
}

/** What the QR code holds: the pairing code and where to find the PC. */
export function pairingLink(code: string, addresses: string[], port: number): string {
  return `calendaria://pair?c=${encodeURIComponent(code)}&h=${addresses.join(",")}&p=${port}`;
}

export function parsePairing(text: string): { code: string; addresses: string[]; port: number | null } {
  const trimmed = text.trim();
  if (trimmed.startsWith("calendaria://pair?")) {
    const params = new URLSearchParams(trimmed.slice("calendaria://pair?".length));
    const port = Number(params.get("p"));
    return {
      code: normalizeCode(params.get("c") ?? ""),
      addresses: (params.get("h") ?? "").split(",").filter(Boolean),
      port: Number.isInteger(port) && port > 0 ? port : null,
    };
  }
  return { code: normalizeCode(trimmed), addresses: [], port: null };
}

function urlOf(address: string, port: number): string {
  return `http://${address}:${port}/calendaria`;
}

export class LanSync {
  private device: string | null = null;
  private secret: string | null = null;
  private peers = new Map<string, Peer>();
  private pairing: { code: string; until: number; misses: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: SqlDriver,
    private readonly settings: SettingsRepository,
    private readonly transport: Transport,
    /** This device's name, server port (null on the phone) and addresses. */
    private readonly self: () => Promise<Omit<DeviceInfo, "id">>,
    private readonly clock: Clock = systemClock,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    this.device = await this.settings.get(DEVICE_KEY);
    if (!this.device) {
      this.device = newId();
      await this.settings.set(DEVICE_KEY, this.device);
    }
    this.secret = await this.settings.get(GROUP_KEY);
    const stored = await this.settings.get(PEERS_KEY);
    this.peers = new Map((stored ? (JSON.parse(stored) as Peer[]) : []).map((p) => [p.id, p]));
  }

  get id(): string {
    if (!this.device) throw new Error("LanSync used before load()");
    return this.device;
  }

  /** In a group, so there is something to sync with. */
  get paired(): boolean {
    return this.secret !== null;
  }

  peerList(): Peer[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async group(): Promise<string | null> {
    return this.secret ? groupId(this.secret) : null;
  }

  /** One thing at a time touches the database: a round here, or a request from another device. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async info(): Promise<DeviceInfo> {
    return { id: this.id, ...(await this.self()) };
  }

  private async savePeers(): Promise<void> {
    await this.settings.set(PEERS_KEY, JSON.stringify([...this.peers.values()]));
  }

  private async remember(info: DeviceInfo, synced: boolean): Promise<void> {
    if (info.id === this.id) return;
    const old = this.peers.get(info.id);
    this.peers.set(info.id, {
      ...info,
      // Keep addresses learned earlier (e.g. a Tailscale one) after the new ones.
      addresses: [...new Set([...info.addresses, ...(old?.addresses ?? [])])],
      lastSync: synced ? this.clock().toISOString() : (old?.lastSync ?? null),
    });
    await this.savePeers();
  }

  /** Shows a code another device can join with, making the group if there isn't one yet. */
  async startPairing(): Promise<{ code: string; link: string; until: number }> {
    if (!this.secret) {
      this.secret = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      await this.settings.set(GROUP_KEY, this.secret);
    }
    const code = newPairingCode();
    this.pairing = { code, until: this.now() + PAIRING_MS, misses: 0 };
    const me = await this.info();
    return { code, link: pairingLink(code, me.addresses, me.port ?? DEFAULT_PORT), until: this.pairing.until };
  }

  cancelPairing(): void {
    this.pairing = null;
  }

  get pairingOpen(): boolean {
    return this.pairing !== null && this.now() < this.pairing.until;
  }

  /** Answers another device. `onChange` runs when its rows changed this device's data. */
  handle(body: string, onChange: () => void = () => {}): Promise<{ status: number; body: string }> {
    return this.exclusive(async () => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(body) as Envelope;
      } catch {
        return { status: 400, body: "" };
      }
      if (envelope.kind === "join") return this.answerJoin(envelope);
      if (envelope.kind !== "sync" || !this.secret) return { status: 403, body: "" };
      const key = await groupKey(this.secret);
      const request = await unseal<{ from: DeviceInfo; snapshot: Snapshot }>(key, envelope);
      if (!request) return { status: 403, body: "" };
      const result = await syncDatabase(this.db, request.snapshot, this.clock);
      await this.remember(request.from, true);
      if (result.localChanged) onChange();
      const reply = { from: await this.info(), snapshot: result.snapshot };
      return { status: 200, body: await seal(key, "synced", reply, await groupId(this.secret)) };
    });
  }

  private async answerJoin(envelope: Envelope): Promise<{ status: number; body: string }> {
    const pairing = this.pairing;
    if (!pairing || this.now() >= pairing.until || !this.secret) return { status: 403, body: "" };
    const key = await codeKey(pairing.code);
    const request = await unseal<{ from: DeviceInfo }>(key, envelope);
    if (!request) {
      if (++pairing.misses >= PAIRING_ATTEMPTS) this.pairing = null;
      return { status: 403, body: "" };
    }
    this.pairing = null;
    await this.remember(request.from, false);
    const reply = { key: this.secret, from: await this.info() };
    return { status: 200, body: await seal(key, "joined", reply) };
  }

  /**
   * Joins the group of the PC showing `text` (its code, or the QR's link).
   * Without addresses in the link it asks every Calendaria on the network,
   * plus `address` if given (e.g. a Tailscale address).
   */
  async join(text: string, address?: string): Promise<Peer> {
    const { code, addresses, port } = parsePairing(text);
    if (code.length !== 14) throw new PairingError("That code doesn't look right. It has 12 letters and digits.");
    const key = await codeKey(code);
    const targets: { address: string; port: number }[] = addresses.map((a) => ({ address: a, port: port ?? DEFAULT_PORT }));
    if (address?.trim()) targets.push({ address: address.trim(), port: port ?? DEFAULT_PORT });
    if (targets.length === 0) {
      for (const found of await this.transport.browse().catch(() => [])) {
        if (found.id === this.id) continue;
        for (const a of found.addresses) targets.push({ address: a, port: found.port });
      }
    }
    if (targets.length === 0) {
      throw new PairingError("No PC with Calendaria found on this network. Check both are on the same router (Wi-Fi or cable), or enter the PC's address.");
    }
    const body = await seal(key, "join", { from: await this.info() });
    let refused = false;
    for (const target of targets) {
      let res: { status: number; body: string };
      try {
        res = await this.transport.post(urlOf(target.address, target.port), body);
      } catch {
        continue;
      }
      if (res.status !== 200) {
        refused ||= res.status === 403;
        continue;
      }
      const reply = await unseal<{ key: string; from: DeviceInfo }>(key, JSON.parse(res.body) as Envelope);
      if (!reply) continue;
      return this.exclusive(async () => {
        if (reply.key !== this.secret) {
          // A new group: peers from an old one can't be reached with this key.
          this.peers.clear();
          this.secret = reply.key;
          await this.settings.set(GROUP_KEY, reply.key);
        }
        const from = { ...reply.from, addresses: [target.address, ...reply.from.addresses] };
        await this.remember(from, false);
        return this.peers.get(from.id)!;
      });
    }
    throw new PairingError(
      refused
        ? "The PC didn't accept that code. Check it, or make a new one (codes last 10 minutes)."
        : "Couldn't get through to the PC. On the phone, allow Calendaria to find nearby devices (Android settings > Apps > Calendaria > Permissions). On the PC, set the network to Private and allow Calendaria through Windows Firewall.",
    );
  }

  /**
   * Syncs with every PC in the group that answers: the ones paired with, and
   * any others in the group found on the network. Returns whether data here
   * changed, and the peers reached.
   */
  syncAll(): Promise<{ localChanged: boolean; reached: string[] }> {
    return this.exclusive(async () => {
      if (!this.secret) return { localChanged: false, reached: [] };
      const g = await groupId(this.secret);
      const key = await groupKey(this.secret);
      const targets = new Map<string, { port: number; addresses: string[] }>();
      for (const peer of this.peers.values()) {
        if (peer.port !== null) targets.set(peer.id, { port: peer.port, addresses: peer.addresses });
      }
      for (const found of await this.transport.browse().catch(() => [])) {
        if (found.group !== g || found.id === this.id) continue;
        const known = targets.get(found.id)?.addresses ?? [];
        targets.set(found.id, { port: found.port, addresses: [...new Set([...found.addresses, ...known])] });
      }

      let localChanged = false;
      const reached: string[] = [];
      for (const [id, target] of targets) {
        const local = (await syncDatabase(this.db, null, this.clock)).snapshot;
        const body = await seal(key, "sync", { from: await this.info(), snapshot: local }, g);
        for (const address of target.addresses) {
          let res: { status: number; body: string };
          try {
            res = await this.transport.post(urlOf(address, target.port), body);
          } catch {
            continue;
          }
          if (res.status !== 200) continue;
          const reply = await unseal<{ from: DeviceInfo; snapshot: Snapshot }>(key, JSON.parse(res.body) as Envelope);
          if (!reply || reply.from.id !== id) continue;
          if ((await syncDatabase(this.db, reply.snapshot, this.clock)).localChanged) localChanged = true;
          await this.remember({ ...reply.from, addresses: [address, ...reply.from.addresses] }, true);
          reached.push(id);
          break;
        }
      }
      return { localChanged, reached };
    });
  }

  async forget(peerId: string): Promise<void> {
    this.peers.delete(peerId);
    await this.savePeers();
  }

  /** Leaves the group. This device keeps its data; the others keep theirs. */
  async leave(): Promise<void> {
    this.secret = null;
    this.pairing = null;
    this.peers.clear();
    await this.settings.remove(GROUP_KEY);
    await this.settings.remove(PEERS_KEY);
  }
}
