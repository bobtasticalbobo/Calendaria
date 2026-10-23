import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { Temporal } from "../time/temporal";
import { parsePairing } from "../sync/lan";
import { formatTime } from "./dates";
import { QrScanner } from "./QrScanner";
import type { useSync } from "./useSync";

type Sync = ReturnType<typeof useSync>;

function clock(date: Date | string): string {
  const at = Temporal.Instant.fromEpochMilliseconds(new Date(date).getTime());
  return formatTime(at.toZonedDateTimeISO(Temporal.Now.timeZoneId()));
}

/** The pairing code a PC shows, as a QR code for the phone and as text for another PC. */
function PairingCode({ sync }: { sync: Sync }) {
  const pairing = sync.pairing!;
  const [svg, setSvg] = useState("");
  const [left, setLeft] = useState(pairing.until - Date.now());
  const addresses = parsePairing(pairing.link).addresses;

  useEffect(() => {
    QRCode.toString(pairing.link, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } }).then(setSvg);
  }, [pairing.link]);

  useEffect(() => {
    const timer = setInterval(() => setLeft(pairing.until - Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing.until]);

  if (left <= 0) {
    return (
      <div className="sync">
        <p className="muted">The code ran out.</p>
        <div className="sync-actions">
          <button type="button" className="link accent" onClick={sync.startPairing}>
            New code
          </button>
          <button type="button" className="link" onClick={sync.stopPairing}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sync pairing">
      <div className="pairing-qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="pairing-code">{pairing.code}</p>
      {addresses.length > 0 && <p className="muted">This PC: {addresses.join(", ")}</p>}
      <p className="muted">
        On your phone, tap Scan code. On another PC, type the code. It works once, for {Math.ceil(left / 60_000)} more
        min.
      </p>
      <button type="button" className="link" onClick={sync.stopPairing}>
        Done
      </button>
    </div>
  );
}

/** Joins a PC's sync: by scanning its QR code on the phone, or typing its code. */
function JoinForm({ sync, onCancel }: { sync: Sync; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(text: string, at?: string) {
    setBusy(true);
    setError(null);
    try {
      await sync.join(text, at);
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) run(code, address);
  }

  return (
    <form className="sync" onSubmit={submit}>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            run(text);
          }}
        />
      )}
      <p className="muted">On a PC that already syncs (or the first one), open Settings and tap Show pairing code.</p>
      {!sync.canHost && (
        <button type="button" className="primary" onClick={() => setScanning(true)} disabled={busy}>
          Scan code
        </button>
      )}
      <div className="add-calendar">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          aria-label="Pairing code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
      <input
        className="sync-address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="PC address (only if it isn't found)"
        aria-label="PC address"
        inputMode="decimal"
        autoComplete="off"
      />
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/**
 * The sync section in Settings. Devices sync straight with each other over
 * the home Wi-Fi (or Tailscale), after pairing once with a code.
 */
export function SyncPanel({ sync }: { sync: Sync }) {
  const [joining, setJoining] = useState(false);

  if (!sync.ready) return <p className="muted">Starting…</p>;
  if (sync.pairing) return <PairingCode sync={sync} />;
  if (joining) return <JoinForm sync={sync} onCancel={() => setJoining(false)} />;

  const addButtons = (
    <>
      {sync.canHost && (
        <button type="button" className="link accent" onClick={sync.startPairing}>
          Show pairing code
        </button>
      )}
      <button type="button" className="link" onClick={() => setJoining(true)}>
        {sync.canHost ? "Join with a code" : "Scan or type a code"}
      </button>
    </>
  );

  if (!sync.paired) {
    return (
      <div className="sync">
        <p className="muted">
          Sync straight between your phone and PCs over your home network. Nothing goes through the internet, and
          everything sent is encrypted. Pair each device once.
        </p>
        {sync.error && <p className="error-text">{sync.error}</p>}
        <div className="sync-actions">{addButtons}</div>
      </div>
    );
  }

  const pcs = sync.peers.filter((p) => p.port !== null);
  let status: string;
  if (sync.syncing) status = "Syncing…";
  else if (pcs.length === 0 && sync.canHost) status = "Paired. Your other devices sync with this PC when they're on the same network.";
  else if (sync.lastSynced) status = `Synced at ${clock(sync.lastSynced)}`;
  else status = "None of your PCs answered. They sync when you're on the same network (or Tailscale) and they're on.";

  return (
    <div className="sync">
      <p className="muted">{status}</p>
      {sync.error && <p className="error-text">{sync.error}</p>}
      {sync.peers.length > 0 && (
        <ul className="sync-peers">
          {sync.peers.map((peer) => (
            <li key={peer.id}>
              <span className={sync.reached.includes(peer.id) ? "sync-dot online" : "sync-dot"} />
              <span className="sync-peer-name">{peer.name}</span>
              <span className="muted">{peer.lastSync ? clock(peer.lastSync) : "not yet"}</span>
              <button type="button" className="link" onClick={() => sync.forget(peer.id)}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="sync-actions">
        <button type="button" className="link" onClick={sync.syncNow}>
          Sync now
        </button>
        {addButtons}
        <button type="button" className="link" onClick={sync.leave}>
          Stop syncing
        </button>
      </div>
      <p className="muted sync-hint">
        Away from home: install Tailscale on this device and your PCs, signed in to the same account, and they keep
        syncing anywhere.
      </p>
    </div>
  );
}
