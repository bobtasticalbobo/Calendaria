import { invoke } from "@tauri-apps/api/core";
import type { Found, Transport } from "./lan";

/** How long to wait for a device to pick up before trying the next address. */
const CONNECT_MS = 2_000;
/** How long to listen for devices announcing themselves on the network. */
const BROWSE_MS = 1_500;

export const tauriTransport: Transport = {
  async post(url, body) {
    const [status, text] = await invoke<[number, string]>("lan_post", { url, body, connectMs: CONNECT_MS });
    return { status, body: text };
  },
  browse: () => invoke<Found[]>("lan_browse", { ms: BROWSE_MS }),
};

export const serve = (preferred: number) => invoke<number>("lan_serve", { preferred });
export const reply = (id: number, status: number, body: string) => invoke("lan_reply", { id, status, body });
export const advertise = (id: string, name: string, group: string, port: number) =>
  invoke("lan_advertise", { id, name, group, port });
export const localAddresses = () => invoke<string[]>("lan_addresses");
export const deviceName = () => invoke<string>("lan_device_name");
