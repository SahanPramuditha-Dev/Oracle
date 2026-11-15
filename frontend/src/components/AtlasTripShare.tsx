import { useEffect, useState } from 'react';
import { localApi } from '../utils/api';

type Point = { lat: number; lon: number };
type Trip = {
  originCoordinates: readonly [number, number];
  destination: Point & { name: string };
  stops: Point[];
  mode: 'driving' | 'walking' | 'cycling';
};

export function AtlasPlaceShare({ place }: { place: Point }) {
  const [share, setShare] = useState<{ url: string; svg: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function prepare() {
    setBusy(true);
    setError(false);
    try {
      setShare(await localApi<{ url: string; svg: string }>('geo/place-share', 'POST',
        { lat: place.lat, lon: place.lon }, AbortSignal.timeout(8000)));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return share ? <div className="atlas-trip-share">
    <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(share.svg)}
      alt="QR code for this place in Google Maps" width={216} height={216} />
    <p>Scan with your phone to open this place in Google Maps.</p>
    <a className="geo-mini-btn" href={share.url} target="_blank" rel="noreferrer">Open Google Maps</a>
  </div> : <>
    <button type="button" className="geo-mini-btn" disabled={busy} onClick={() => void prepare()}>
      {busy ? 'Preparing QR code…' : 'Send to phone'}
    </button>
    {error && <p role="alert">Could not prepare the place QR code. Try again.</p>}
  </>;
}

export function AtlasTripShare({ route }: { route: Trip }) {
  const [share, setShare] = useState<{ url: string; svg: string }>();
  const [status, setStatus] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [usePhoneLocation, setUsePhoneLocation] = useState(true);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>();
  const [deviceId, setDeviceId] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void localApi<{ devices: { id: string; label: string }[] }>(
      'companion/devices', 'GET', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
    ).then(result => {
      if (controller.signal.aborted) return;
      setDevices(result.devices);
      if (result.devices.length === 1) setDeviceId(result.devices[0].id);
    }).catch(() => {
      if (!controller.signal.aborted) setDeliveryStatus('Could not load paired phones.');
    });
    return () => controller.abort();
  }, []);

  async function sendToCompanion() {
    setSending(true);
    setDeliveryStatus('');
    const [lon, lat] = route.originCoordinates;
    try {
      await localApi(`companion/devices/${deviceId}/trip`, 'POST', {
        origin: usePhoneLocation ? undefined : { lat, lon },
        destination: route.destination,
        destination_name: route.destination.name.slice(0, 200) || 'Atlas destination',
        stops: route.stops,
        mode: route.mode
      }, AbortSignal.timeout(8000));
      setDeliveryStatus('Trip queued for the selected phone for 15 minutes.');
    } catch (error) {
      setDeliveryStatus(error instanceof Error ? error.message : 'Could not queue the trip.');
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setShare(undefined);
    setStatus('');
    const [lon, lat] = route.originCoordinates;
    const point = ({ lat, lon }: Point) => ({ lat, lon });
    void localApi<{ url: string; svg: string }>('geo/trip-share', 'POST', {
      origin: usePhoneLocation ? undefined : { lat, lon },
      destination: point(route.destination), stops: route.stops.map(point), mode: route.mode,
    }, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])).then(result => {
      if (!controller.signal.aborted) setShare(result);
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('Could not prepare the trip link.');
    });
    return () => controller.abort();
  }, [route, attempt, usePhoneLocation]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Trip link copied.');
    } catch {
      setStatus('Copy is unavailable. Use the Google Maps link or scan the QR code.');
    }
  }

  return <div className="atlas-trip-share">
    <label className="geo-pin-desc">
      Starting point{' '}
      <select disabled={sending} value={usePhoneLocation ? 'phone' : 'planned'} onChange={event => {
        setShare(undefined);
        setStatus('');
        setUsePhoneLocation(event.target.value === 'phone');
      }}>
        <option value="phone">Phone location</option>
        <option value="planned">Planned starting point</option>
      </select>
    </label>
    {!!devices?.length && <div className="geo-pin-actions">
      <select aria-label="Paired phone" disabled={sending} value={deviceId} onChange={event => {
        setDeviceId(event.target.value);
        setDeliveryStatus('');
      }}>
        <option value="">Choose a paired phone</option>
        {devices.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
      </select>
      <button type="button" className="geo-mini-btn" disabled={!deviceId || sending} onClick={() => void sendToCompanion()}>
        {sending ? 'Sending…' : 'Send to Companion'}
      </button>
    </div>}
    {deliveryStatus && <p role="status">{deliveryStatus}</p>}
    {!share ? <>
      <p role="status">{status || 'Preparing trip link…'}</p>
      {status && <button type="button" className="geo-mini-btn" onClick={() => {
        setStatus('');
        setAttempt(value => value + 1);
      }}>Retry</button>}
    </> : <>
    <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(share.svg)}
      alt="QR code for this trip in Google Maps" width={216} height={216} />
    <p>{usePhoneLocation
      ? 'Scan to open the trip in Google Maps. Allow location access or enter your starting point there.'
      : 'Scan to open the trip from your planned starting point in Google Maps.'}</p>
    {route.stops.length > 3 && <p>Mobile browsers may limit directions to three intermediate stops.</p>}
    <div className="geo-pin-actions">
      <button type="button" className="geo-mini-btn" onClick={() => void copy(share.url)}>Copy link</button>
      <a className="geo-mini-btn" href={share.url} target="_blank" rel="noreferrer">Open Google Maps</a>
    </div>
    {status && <p role="status">{status}</p>}
    </>}
  </div>;
}
