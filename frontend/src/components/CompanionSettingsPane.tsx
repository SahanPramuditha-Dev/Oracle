import { OracleSelect } from './OracleSelect';
import { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { localApi } from '../utils/api';
import './CompanionSettingsPane.css';

type Adapter = { name: string; address: string };
type Network = { adapters: Adapter[] | null; preferred: Adapter | null; pairedLabel: string | null; remoteAddress?: string; autoTailscale?: boolean };
type PairingCode = { image: string; expiresIn: number; address: string; pairingId: string };
type Phone = { id: string; label: string; lastSeen: number | null; transport: 'lan' | 'tailscale' | null };

export function CompanionSettingsPane() {
  const [selection, setSelection] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [remoteInput, setRemoteInput] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState('');
  const [network, setNetwork] = useState<Network | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [pairing, setPairing] = useState<(PairingCode & { expiresAt: number; automatic: boolean }) | null>(null);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pairedLabel, setPairedLabel] = useState<string | null>(null);
  const [phones, setPhones] = useState<Phone[]>();
  const [phonesUnavailable, setPhonesUnavailable] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string>();
  const [revoking, setRevoking] = useState(false);
  const [deviceMessage, setDeviceMessage] = useState('');
  const [deviceRefresh, setDeviceRefresh] = useState(0);
  const remoteAddress = remoteInput ?? network?.remoteAddress ?? '';
  const address = selection === 'manual' ? manualAddress.trim() : selection;
  const effectiveAddress = selection ? address : network?.preferred?.address;
  const addressChanged = pairing && (pairing.automatic
    ? network?.adapters != null && network.preferred?.address !== pairing.address
    : network?.adapters != null && !network.adapters.some(adapter => adapter.address === pairing.address));
  const seconds = pairing && !addressChanged && pairedLabel === null
    ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;
  const pairingId = pairing?.pairingId;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      try {
        const query = pairingId ? '?pairing_id=' + encodeURIComponent(pairingId) : '';
        const result = await localApi<Network>('companion/network' + query, 'GET', undefined, controller.signal);
        if (controller.signal.aborted) return;
        setNetwork(result);
        setNetworkError(false);
        if (result.pairedLabel !== null) setPairedLabel(result.pairedLabel);
      } catch {
        if (!controller.signal.aborted) setNetworkError(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pairingId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      try {
        const result = await localApi<{ devices: Phone[] }>('companion/devices', 'GET', undefined, controller.signal);
        if (controller.signal.aborted) return;
        setPhones(result.devices);
        setPhonesUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setPhonesUnavailable(true);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 4000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [deviceRefresh, pairedLabel]);

  async function revoke(phone: Phone) {
    setRevoking(true);
    setDeviceMessage('');
    try {
      await localApi('companion/devices/' + encodeURIComponent(phone.id), 'DELETE');
      setPhones(previous => previous?.filter(device => device.id !== phone.id));
      setDeviceMessage(`Access revoked for ${phone.label || 'Android phone'}.`);
      setRevokeTarget(undefined);
    } catch (failure) {
      setDeviceMessage(failure instanceof Error ? failure.message : 'Could not revoke access.');
    } finally {
      setRevoking(false);
      setDeviceRefresh(value => value + 1);
    }
  }

  useEffect(() => {
    if (!pairing || seconds === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(1000, pairing.expiresAt - now));
    return () => window.clearTimeout(timer);
  }, [pairing, now, seconds]);

  async function configureRemote(automatic: boolean) {
    setRemoteBusy(true);
    setRemoteError('');
    try {
      const result = await localApi<Pick<Network, 'autoTailscale' | 'remoteAddress'>>(
        'companion/remote', 'POST', { automatic },
      );
      setRemoteInput(null);
      setNetwork(previous => previous ? { ...previous, ...result } : previous);
    } catch (failure) {
      setRemoteError(failure instanceof Error ? failure.message : 'Could not save Tailscale settings.');
    } finally {
      setRemoteBusy(false);
    }
  }

  async function createCode() {
    setBusy(true);
    setError('');
    setPairing(null);
    setPairedLabel(null);
    try {
      const result = await localApi<PairingCode>(
        'companion/pairing', 'POST', {
          ...(address ? { address } : {}),
          ...(remoteInput === null || network?.autoTailscale ? {} : { remote_address: remoteAddress.trim() || null }),
        },
      );
      const issued = Date.now();
      setNow(issued);
      setPairing({ ...result, automatic: !address, expiresAt: issued + result.expiresIn * 1000 });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not generate a pairing code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="pane-header-strip">
        <div className="pane-title-block">
          <h2>Oracle Companion</h2>
          <p>Pair the Android app with Oracle Central.</p>
        </div>
      </header>
      <div className="settings-grid-2col companion-settings">
        <form className="settings-tile companion-settings-form" onSubmit={(event) => { event.preventDefault(); void createCode(); }}>
          <div className="settings-tile-info">
            <h3 className="settings-tile-title">Pair a phone</h3>
            <p className="settings-tile-desc">Connect both devices to the same Wi-Fi network.</p>
          </div>
          <div className="settings-tile-row">
            <span className="settings-tile-title">Pairing address</span>
            {effectiveAddress && <span className="settings-mono-badge">{effectiveAddress}</span>}
          </div>
          {!effectiveAddress && !selection && <p className="settings-tile-desc" role="status">
            {networkError || network?.adapters === null ? 'Network detection is unavailable. Enter an address under Advanced.'
              : network ? 'Connect this PC to Wi-Fi or choose a network adapter under Advanced.'
              : 'Detecting Wi-Fi address…'}
          </p>}
          <details className="companion-settings-advanced">
            <summary>Advanced</summary>
            <div className="companion-settings-field">
              <label className="settings-tile-title" htmlFor="companion-adapter">Network adapter</label>
              <OracleSelect
                id="companion-adapter"
                aria-label="Network adapter"
                value={selection}
                disabled={busy}
                onChange={setSelection}
                options={[
                  { value: '', label: 'Automatic (Wi-Fi)' },
                  ...(selection && selection !== 'manual' && !network?.adapters?.some(adapter => adapter.address === selection)
                    ? [{ value: selection, label: `${selection} (unavailable)` }]
                    : []),
                  ...(network?.adapters?.map(adapter => ({
                    value: adapter.address,
                    label: adapter.name,
                    desc: adapter.address,
                  })) ?? []),
                  { value: 'manual', label: 'Enter address manually' },
                ]}
              />
              {selection === 'manual' && <>
                <label className="settings-tile-title" htmlFor="companion-address">PC IPv4 address</label>
                <input className="settings-input" id="companion-address" value={manualAddress}
                  onChange={event => setManualAddress(event.target.value)} placeholder="192.168.1.25"
                  disabled={busy} autoComplete="off" spellCheck={false} />
              </>}
            </div>
          </details>
          <div className="companion-settings-field">
            <label className="settings-tile-title">
              <input type="checkbox" checked={network?.autoTailscale ?? false}
                disabled={!network || busy || remoteBusy}
                onChange={event => void configureRemote(event.target.checked)} />
              {' '}Use Tailscale automatically
            </label>
            {network?.autoTailscale ? (
              <p className="settings-tile-desc" role="status">
                {network.remoteAddress ? `Listening on ${network.remoteAddress}` : 'Waiting for the Tailscale listener…'}
              </p>
            ) : <>
              <label className="settings-tile-title" htmlFor="companion-remote">Tailscale IPv4 address (optional)</label>
              <input className="settings-input" id="companion-remote" value={remoteAddress}
                onChange={event => setRemoteInput(event.target.value)} placeholder="100.x.x.x"
                disabled={busy || remoteBusy} autoComplete="off" spellCheck={false} />
              <p className="settings-tile-desc">Join the same Tailscale network on both devices. Generate a QR code to save this setting. Clear the address and generate a new code to disable remote access.</p>
            </>}
            {remoteError && <p className="companion-settings-error" role="alert">{remoteError}</p>}
          </div>
          <button className="settings-option-pill active" type="submit" disabled={busy || remoteBusy || !effectiveAddress}>
            <QrCode size={12} aria-hidden="true" />
            {busy ? 'Generating…' : pairing ? 'Generate new QR code' : 'Generate QR code'}
          </button>
          {error && <p className="companion-settings-error" role="alert">{error}</p>}
        </form>
        <section className="settings-tile companion-settings-code" aria-labelledby="companion-code-title">
          <div className="settings-tile-row">
            <h3 className="settings-tile-title" id="companion-code-title">{pairedLabel !== null ? 'Phone paired' : 'Pairing QR code'}</h3>
            {seconds > 0 && <span className="settings-mono-badge">Expires in {seconds}s</span>}
          </div>
          {pairedLabel === null && <div className="companion-settings-preview">
            {pairing && seconds > 0 ? (
              <img alt="Oracle Companion pairing QR code" width={320} height={320}
                src={'data:image/svg+xml;base64,' + pairing.image} />
            ) : <QrCode size={28} aria-hidden="true" />}
          </div>}
          <p className="settings-tile-desc" role="status">
            {busy ? 'Generating pairing code…'
              : pairedLabel !== null ? (pairedLabel || 'Android phone')
              : addressChanged ? 'The PC address changed. Generate a new QR code.'
              : seconds > 0 ? <>In Oracle Companion, tap <strong>Scan QR</strong>, then <strong>Pair this phone</strong>.</>
              : pairing ? 'Pairing code expired. Generate a new QR code.'
              : 'Generate a QR code to scan with the Companion app.'}
          </p>
        </section>
        <section className="settings-tile companion-settings-devices" aria-labelledby="companion-devices-title">
          <h3 className="settings-tile-title" id="companion-devices-title">Connected devices</h3>
          {phonesUnavailable ? <p role="status" className="settings-tile-desc">Device list is unavailable.</p>
            : !phones ? <p className="settings-tile-desc">Loading paired phones…</p>
            : phones.length === 0 ? <p className="settings-tile-desc">No phones paired.</p>
            : <ul className="companion-device-list">
              {phones.map(phone => <li key={phone.id} className="settings-tile-row">
                <div>
                  <p className="settings-tile-title">{phone.label || 'Android phone'}</p>
                  <p className="settings-tile-desc">
                    {phone.lastSeen == null ? 'Awaiting first connection'
                      : <>Last seen {new Date(phone.lastSeen * 1000).toLocaleString()} · {phone.transport === 'tailscale' ? 'Tailscale' : 'Local network'}</>}
                  </p>
                </div>
                <div className="companion-device-actions">
                  {revokeTarget === phone.id ? <>
                    <button type="button" className="settings-option-pill" disabled={revoking}
                      onClick={() => void revoke(phone)}>Confirm revoke</button>
                    <button type="button" className="settings-option-pill" disabled={revoking}
                      onClick={() => setRevokeTarget(undefined)}>Cancel</button>
                  </> : <button type="button" className="settings-option-pill" disabled={revoking}
                    aria-label={`Revoke access for ${phone.label || 'Android phone'}`}
                    onClick={() => { setDeviceMessage(''); setRevokeTarget(phone.id); }}>Revoke</button>}
                </div>
              </li>)}
            </ul>}
          {deviceMessage && <p className="settings-tile-desc" role="status">{deviceMessage}</p>}
        </section>
      </div>
    </>
  );
}
