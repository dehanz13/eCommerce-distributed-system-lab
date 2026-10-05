'use client';
import { CheckoutRecoveryDialog } from './checkout-recovery-dialog';
import { v4 as newId } from 'uuid';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ShoppingBag,
  Boxes,
  Activity,
  Sun,
  Moon,
  RefreshCw,
  Play,
  Pause,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { request, ApiError, browserMetrics, browserActivity } from '@lab/client';
import type { Product, Cart, Order, Preview, CheckoutInput } from '@lab/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Architecture } from './architecture';
import { SystemControls } from './system-controls';
import { Help } from './ui/help';
import { LearningControls } from './learning-controls';
type RecordData = Record<string, unknown>;
type SystemData = {
  states: Array<{ status: string; count: number }>;
  outbox: RecordData[];
  jobs?: RecordData[];
  attempts?: RecordData[];
  settings?: { preset: string; paused: boolean };
  pendingOutbox?: string;
  consumedEvents?: string;
  database?: RecordData;
};
type Pending = { body: CheckoutInput; key: string; correlationId: string };
const dashboardHelp: Record<string, string> = {
  Overview: 'Owner state and availability at the last successful sample.',
  Architecture: 'Trace recorded requests and events across the ecosystem.',
  Cache: 'Observe catalog lookup, SQL fallback and cache fill.',
  Shoppers: 'Run bounded fictional shopping journeys with reproducible choices.',
  'Failure Lab': 'Engage a scoped fault and compare before, during and restored state.',
  Records: 'Inspect durable jobs, attempts and outbox records.',
  Timeline: 'Inspect input, processing and output records under a correlation ID.',
  Metrics: 'Read process counters and scoped host/broker measurements.',
  Controls: 'Start, stop, restart, verify cleanup and recover from the operator.',
};
const systemHelp: Record<string, string> = {
  status:
    'Readiness is observed by probing owner APIs. Reachability does not establish that all dependencies are healthy.',
  ordering: 'Ordering owns catalog, carts, checkout, orders, inbox and outbox.',
  fulfillment: 'Fulfillment owns jobs, attempts, settings, inbox and outbox.',
  broker: 'RabbitMQ management samples include only lab queues.',
  host: 'Operator host measurements include unrelated workloads. They are not container or remote-guest measurements.',
};
/** Format integer cents as USD for display.
 * Input: cents, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
/** Format observed metadata without fabricating absent values.
 * Input: x, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
const display = (x: unknown) => JSON.stringify(x, null, 2);
/** Render inspectable JSON supplied by a caller.
 * Input: props, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function Details({ data, label = 'Inspect metadata' }: { data: unknown; label?: string }) {
  return (
    <details className="mt-2">
      <summary className="hint">{label}</summary>
      <pre>{display(data)}</pre>
    </details>
  );
}
/** Render a textual status with accessible visual styling.
 * Input: props, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        'badge ' +
        (['fulfilled', 'completed', 'ready'].includes(value)
          ? 'badge-good'
          : ['failed', 'unavailable'].includes(value)
            ? 'badge-bad'
            : '')
      }
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
/** Coordinate shopper/admin/dashboard presentation through owner HTTP contracts.
 * Input: props, from React props, current browser state and explicit user actions.
 * Communicates with owner HTTP contracts through the shared client; never owner databases.
 */
export function Lab({ view }: { view: 'shop' | 'catalog' | 'system' }) {
  const needsShopperReload = useRef(true);
  const [dark, setDark] = useState(false),
    [products, setProducts] = useState<Product[]>([]),
    [cart, setCart] = useState<Cart | null>(null),
    [orders, setOrders] = useState<Order[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [pending, setPending] = useState<Pending | null>(null),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [message, setMessage] = useState(''),
    [backendUnavailable, setBackendUnavailable] = useState(false),
    [busy, setBusy] = useState(false),
    [shopper, setShopper] = useState('');
  const [editing, setEditing] = useState<Product | null>(null),
    [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [price, setPrice] = useState('12.00'),
    [stock, setStock] = useState('10'),
    [stockTarget, setStockTarget] = useState(''),
    [delta, setDelta] = useState('5');
  const [systems, setSystems] = useState<
      Record<string, { data?: unknown; error?: string; at?: string }>
    >({}),
    [poll, setPoll] = useState(true),
    [tab, setTab] = useState('Overview'),
    [journeyReference, setJourneyReference] = useState(''),
    [correlation, setCorrelation] = useState(''),
    [collected, setCollected] = useState<unknown>(null);
  useEffect(() => {
    if (view !== 'system') return;
    const reference = new URLSearchParams(window.location.search).get('submission');
    if (reference && /^[a-f0-9]{64}$/.test(reference)) {
      setJourneyReference(reference);
      setTab('Architecture');
    }
  }, [view]);
  useEffect(() => {
    const id = localStorage.getItem('lab.shopper') ?? newId();
    localStorage.setItem('lab.shopper', id);
    setShopper(id);
    const saved = localStorage.getItem('lab.checkout');
    if (saved) {
      try {
        setPending(JSON.parse(saved));
        setRecoveryOpen(true);
      } catch {
        localStorage.removeItem('lab.checkout');
      }
    }
    const theme = localStorage.getItem('lab.theme') === 'dark';
    setDark(theme);
    document.documentElement.classList.toggle('dark', theme);
  }, []);
  /** Read catalog, cart and orders for the current browser shopper.
   * Input: signal, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const p = await request<Product[]>('/api/v1/products', { signal });
        setProducts(p.data);
        if (shopper) {
          const c = await request<Cart>('/api/v1/carts', {
            method: 'POST',
            body: JSON.stringify({ shopperId: shopper }),
            signal,
          });
          setCart(c.data);
          const o = await request<Order[]>('/api/v1/orders?shopperId=' + shopper, { signal });
          setOrders(o.data);
          needsShopperReload.current = false;
        }
        setBackendUnavailable(false);
      } catch (e) {
        if (signal?.aborted) return;
        const unavailable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
        setBackendUnavailable(unavailable);
        if (unavailable) needsShopperReload.current = true;
        if (!unavailable) setMessage(String(e instanceof Error ? e.message : e));
      }
    },
    [shopper],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (view !== 'shop' || !shopper) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    /** Poll ordering's shopper records sequentially; cancel transport and scheduling when leaving Shop.
     * Input: no arguments; uses its current owner state, from the current shopper identity and view-owned cancellation signal.
     * Communicates with owner HTTP contracts through the shared client; never owner databases.
     */
    async function pollOrders() {
      try {
        const result = await request<Order[]>('/api/v1/orders?shopperId=' + shopper, {
          headers: { 'x-lab-observation': 'poll' },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setOrders(result.data);
          // Reload the idempotently acquired cart/catalog after a read outage; never replay checkout.
          if (needsShopperReload.current) await load(controller.signal);
          else setBackendUnavailable(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          needsShopperReload.current = true;
          setBackendUnavailable(true);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(pollOrders, 2000);
      }
    }
    timer = setTimeout(pollOrders, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [view, shopper, load]);
  /** Run one explicit UI action and surface its failure without replaying it.
   * Input: work, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  async function mutate(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500)
        setBackendUnavailable(true);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  /** Set or remove one cart quantity through ordering and refresh the preview state.
   * Input: productId, quantity, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  async function item(productId: string, quantity?: number) {
    if (!cart) return;
    await mutate(async () => {
      const result = await request<Cart>(`/api/v1/carts/${cart.id}/items/${productId}`, {
        method: quantity ? 'PUT' : 'DELETE',
        ...(quantity ? { body: JSON.stringify({ quantity }) } : {}),
      });
      setCart(result.data);
      setPreview(null);
      await load();
    });
  }
  /** Send the retained checkout once; preserve ambiguous outcomes for explicit recovery.
   * Input: p, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  async function submit(p: Pending) {
    await mutate(async () => {
      try {
        const result = await request<Order>('/api/v1/checkouts', {
          method: 'POST',
          headers: { 'idempotency-key': p.key, 'x-correlation-id': p.correlationId },
          body: JSON.stringify(p.body),
        });
        localStorage.removeItem('lab.checkout');
        setPending(null);
        setRecoveryOpen(false);
        setPreview(null);
        await load();
        setMessage(
          'Order accepted. Fulfillment continues in the background. Order ' + result.data.id,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          localStorage.removeItem('lab.checkout');
          setPending(null);
          setPreview(null);
        }
        if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
          setRecoveryOpen(true);
          throw new ApiError(
            0,
            'OUTCOME_UNKNOWN',
            'Outcome unknown. Recover the saved submission to discover whether it was accepted.',
          );
        }
        throw e;
      }
    });
  }
  /** Persist the shopper’s confirmed submission before sending it to ordering.
   * Input: no arguments; uses its current owner state, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  async function confirm() {
    if (!preview) return;
    const p: Pending = {
      body: {
        cartId: preview.cartId,
        revision: preview.revision,
        priceFingerprint: preview.priceFingerprint,
      },
      key: newId(),
      correlationId: newId(),
    };
    localStorage.setItem('lab.checkout', JSON.stringify(p));
    setPending(p);
    await submit(p);
  }
  const refreshing = useRef(false);
  /** Collect independent owner/operator observations and label unavailable sources.
   * Input: no arguments; uses its current owner state, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  const refreshSystems = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const paths: Record<string, string> = {
        status: '/operator/api/v1/status',
        cache: '/api/v1/cache',
        feeder: '/operator/api/v1/feeder',
        experiments: '/operator/api/v1/experiments',
        ordering: '/api/v1/system',
        fulfillment: '/fulfillment/api/v1/system',
        orderingMetrics: '/ordering/metrics',
        fulfillmentMetrics: '/fulfillment/metrics',
        operatorMetrics: '/operator/metrics',
        broker: '/operator/api/v1/broker',
        host: '/operator/api/v1/host',
        actions: '/operator/api/v1/actions',
        resources: '/operator/api/v1/resources',
        orderingLogs: '/ordering/activity',
        fulfillmentLogs: '/fulfillment/activity',
        operatorLogs: '/operator/activity',
      };
      await Promise.all(
        Object.entries(paths).map(async ([key, path]) => {
          try {
            const res = await request<unknown>(path);
            setSystems((previous) => ({
              ...previous,
              [key]: { data: res.data, at: res.meta.respondedAt },
            }));
          } catch (e) {
            setSystems((previous) => ({
              ...previous,
              [key]: { ...previous[key], error: e instanceof Error ? e.message : 'Unavailable' },
            }));
          }
        }),
      );
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    if (view !== 'system') return;
    void refreshSystems();
    if (!poll) return;
    const t = setInterval(() => void refreshSystems(), 2000);
    return () => clearInterval(t);
  }, [view, poll, refreshSystems]);
  /** Submit an allowlisted operator action and refresh its recorded outcome.
   * Input: action, service, preset, from React props, current browser state and explicit user actions.
   * Communicates with owner HTTP contracts through the shared client; never owner databases.
   */
  async function control(action: string, service?: string, preset?: string) {
    await mutate(async () => {
      await request('/operator/api/v1/actions', {
        method: 'POST',
        body: JSON.stringify({ name: action, service, preset }),
      });
      setMessage('Action requested. Follow its outcome below.');
      await refreshSystems();
    });
  }
  const ordering = systems.ordering?.data as SystemData | undefined,
    fulfillment = systems.fulfillment?.data as SystemData | undefined;
  const nav = [
    { href: '/', label: 'Shop', icon: ShoppingBag, id: 'shop' },
    { href: '/catalog', label: 'Catalog Admin', icon: Boxes, id: 'catalog' },
    { href: '/system', label: 'System Dashboard', icon: Activity, id: 'system' },
  ];
  return (
    <div className="min-h-screen">
      <CheckoutRecoveryDialog
        open={view === 'shop' && recoveryOpen && !!pending}
        busy={busy}
        onOpenChange={setRecoveryOpen}
        onRecover={() => {
          if (pending) void submit(pending);
        }}
      />
      <header className="border-b" style={{ background: 'var(--panel)' }}>
        <div className="mx-auto max-w-7xl px-5 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold text-lg flex gap-3 items-center">
            <span className="rounded-lg bg-blue-600 p-2 text-white">
              <Boxes size={19} />
            </span>
            Systems lab
          </Link>
          <div className="flex items-center gap-3">
            <span className="hint hidden sm:block">Local · fictional data · USD</span>
            <Button
              variant="ghost"
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              onClick={() => {
                setDark(!dark);
                document.documentElement.classList.toggle('dark', !dark);
                localStorage.setItem('lab.theme', !dark ? 'dark' : 'light');
              }}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl lg:grid lg:grid-cols-[210px_1fr]">
        <aside className="px-4 py-6 lg:min-h-[calc(100vh-73px)] lg:border-r">
          <nav aria-label="Main navigation" className="flex gap-2 lg:flex-col">
            {nav.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                aria-current={view === n.id ? 'page' : undefined}
                className={
                  'flex items-center gap-3 rounded-md px-3 py-3 text-sm ' +
                  (view === n.id ? 'bg-blue-600 text-white' : 'hover:bg-muted')
                }
              >
                <n.icon size={17} />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 hidden lg:block hint leading-6">
            One small system.
            <br />A complete data journey.
            <div className="mt-4 border-t pt-4">
              Start and recover from your terminal:<code className="block mt-2 text-xs">./lab</code>
            </div>
          </div>
        </aside>
        <main className="p-5 lg:p-8 min-w-0">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {view === 'shop'
                  ? 'A small shop. A real journey.'
                  : view === 'catalog'
                    ? 'Catalog Admin'
                    : 'System Dashboard'}
              </h1>
              <p className="hint mt-2">
                {view === 'shop'
                  ? 'Build a cart, confirm current prices, and follow your order.'
                  : view === 'catalog'
                    ? 'Change the catalog and observe what checkout protects.'
                    : 'Follow recorded state, inspect metadata, and control the lab.'}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void (view === 'system' ? refreshSystems() : load())}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>
          {backendUnavailable && view !== 'system' && (
            <div role="alert" className="mb-5 panel p-4 border-blue-400">
              <p>
                We’re having trouble connecting to the shop right now. Please try again shortly.
              </p>
              {pending && (
                <p className="mt-2">
                  Your pending checkout has been kept for recovery. Please recover it before placing
                  another order.
                </p>
              )}
              <Button
                variant="outline"
                className="mt-3"
                disabled={busy}
                onClick={() => void load()}
              >
                Check connection
              </Button>
            </div>
          )}
          {message && (
            <div role="status" className="mb-5 panel p-4 border-blue-400 flex gap-3">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{message}</span>
            </div>
          )}
          {view === 'shop' && (
            <>
              <div className="grid xl:grid-cols-[1fr_340px] gap-6">
                <section aria-label="Products" className="grid sm:grid-cols-2 gap-4 content-start">
                  {products
                    .filter((p) => p.active)
                    .map((p, i) => (
                      <article key={p.id} className="panel overflow-hidden">
                        <div
                          className="h-28 flex items-center justify-center"
                          style={{
                            background: ['#e7eefc', '#e5f0ed', '#f3ece4', '#ede9f5'][i % 4],
                            color: '#456188',
                          }}
                        >
                          <ShoppingBag size={40} strokeWidth={1.2} />
                        </div>
                        <div className="p-5">
                          <h2 className="font-semibold text-base">{p.name}</h2>
                          <p className="hint mt-2 min-h-10">{p.description}</p>
                          <div className="flex justify-between items-center mt-4">
                            <span className="text-lg font-semibold">{dollars(p.priceCents)}</span>
                            <span className="hint">{p.availableStock} available</span>
                          </div>
                          <Button
                            className="w-full mt-4"
                            disabled={busy || !cart || p.availableStock === 0 || !!pending}
                            onClick={() =>
                              void item(
                                p.id,
                                (cart?.items.find((x) => x.productId === p.id)?.quantity ?? 0) + 1,
                              )
                            }
                          >
                            Add {p.name} to cart
                          </Button>
                          <Details data={p} />
                        </div>
                      </article>
                    ))}
                  {!products.length && (
                    <div className="panel p-6 sm:col-span-2">
                      {backendUnavailable
                        ? 'Products could not be loaded. Please check the connection shortly.'
                        : 'No products yet. Start the lab or seed it from Controls.'}
                    </div>
                  )}
                </section>
                <section className="panel p-5 self-start" aria-label="Cart">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-lg">Your cart</h2>
                    <span className="badge">{cart?.items.length ?? 0} items</span>
                  </div>
                  {cart?.items.map((i) => (
                    <div key={i.id} className="py-4 border-b">
                      <div className="flex justify-between gap-3">
                        <div>
                          <strong>{i.name}</strong>
                          <div className="hint">
                            {dollars(i.priceCents)} each {!i.active && '· unavailable'}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          disabled={busy || !!pending}
                          aria-label={'Remove ' + i.name}
                          onClick={() => void item(i.productId)}
                        >
                          Remove
                        </Button>
                      </div>
                      <label className="flex gap-3 items-center mt-3 hint">
                        Quantity
                        <Input
                          key={i.quantity}
                          aria-label={'Quantity for ' + i.name}
                          className="w-20"
                          type="number"
                          min={1}
                          max={999}
                          defaultValue={i.quantity}
                          disabled={busy || !!pending}
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (n !== i.quantity && n > 0) void item(i.productId, n);
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  {!cart?.items.length && <p className="hint py-8">Add a product to begin.</p>}
                  {pending ? (
                    <div className="mt-4">
                      <p className="text-sm mb-3">
                        Outcome unknown. Reuse the saved submission and its original key to discover
                        the outcome.
                      </p>
                      <Button disabled={busy} onClick={() => void submit(pending)}>
                        Recover submission
                      </Button>
                      <Details data={pending} />
                    </div>
                  ) : preview ? (
                    <div className="mt-4">
                      <h3 className="font-semibold">Confirm current prices</h3>
                      <p className="hint mt-2">No inventory is held until acceptance.</p>
                      <p className="text-2xl font-semibold my-4">{dollars(preview.totalCents)}</p>
                      <Button className="w-full" disabled={busy} onClick={() => void confirm()}>
                        Confirm order
                        <ArrowRight size={14} />
                      </Button>
                      <Details data={preview} />
                    </div>
                  ) : (
                    <Button
                      className="w-full mt-5"
                      disabled={busy || !cart?.items.length}
                      onClick={() =>
                        void mutate(async () => {
                          const r = await request<Preview>(
                            '/api/v1/carts/' + cart!.id + '/preview',
                          );
                          setPreview(r.data);
                        })
                      }
                    >
                      Review checkout
                    </Button>
                  )}
                  <Details data={cart} />
                </section>
              </div>
              <section className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Your orders</h2>
                {!orders.length && (
                  <p className="hint">
                    Accepted orders will appear here. Their states update every two seconds.
                  </p>
                )}
                <div className="space-y-3">
                  {orders.map((o) => (
                    <article key={o.id} className="panel p-5">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div className="flex gap-3 items-center">
                          <CheckCircle2 size={18} />
                          <strong>{o.items.map((i) => i.name).join(', ')}</strong>
                          <Status value={o.status} />
                        </div>
                        <strong>{dollars(o.totalCents)}</strong>
                      </div>
                      <p className="hint mt-2">Accepted {new Date(o.createdAt).toLocaleString()}</p>
                      {o.submissionReference && (
                        <Link
                          className="inline-block mt-3 underline"
                          href={'/system?submission=' + o.submissionReference}
                        >
                          Follow this order
                        </Link>
                      )}
                      {o.status === 'failed' && (
                        <Button
                          variant="outline"
                          className="mt-3"
                          disabled={busy || !!pending}
                          onClick={() =>
                            void mutate(async () => {
                              const c = await request<Cart>('/api/v1/orders/' + o.id + '/recover', {
                                method: 'POST',
                              });
                              localStorage.setItem('lab.shopper', c.data.shopperId);
                              setShopper(c.data.shopperId);
                              setCart(c.data);
                              setPreview(null);
                              setMessage(
                                'Recovery cart created. Review its current prices and availability.',
                              );
                            })
                          }
                        >
                          Create recovery cart
                        </Button>
                      )}
                      <Details data={o} label={'Inspect order ' + o.id} />
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
          {view === 'catalog' && (
            <>
              <div className="grid lg:grid-cols-2 gap-5 mb-6">
                <form
                  className="panel p-5 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(async () => {
                      if (editing)
                        await request('/api/v1/products/' + editing.id, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            name,
                            description,
                            priceCents: Math.round(Number(price) * 100),
                          }),
                        });
                      else
                        await request('/api/v1/products', {
                          method: 'POST',
                          body: JSON.stringify({
                            name,
                            description,
                            priceCents: Math.round(Number(price) * 100),
                            availableStock: Number(stock),
                          }),
                        });
                      setEditing(null);
                      setName('');
                      setDescription('');
                      await load();
                      setMessage('Product saved.');
                    });
                  }}
                >
                  <h2 className="font-semibold text-lg">
                    {editing ? 'Edit product' : 'Create product'}
                  </h2>
                  <label className="block">
                    Name
                    <Input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label className="block">
                    Description
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={1000}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <label>
                      Price (USD)
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </label>
                    {!editing && (
                      <label>
                        Initial stock
                        <Input
                          type="number"
                          min={0}
                          required
                          value={stock}
                          onChange={(e) => setStock(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                  <Button disabled={busy}>{editing ? 'Save changes' : 'Create product'}</Button>
                  {editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                        setName('');
                        setDescription('');
                      }}
                    >
                      Cancel edit
                    </Button>
                  )}
                </form>
                <form
                  className="panel p-5 space-y-4 self-start"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(async () => {
                      await request('/api/v1/products/' + stockTarget + '/stock', {
                        method: 'POST',
                        body: JSON.stringify({ delta: Number(delta) }),
                      });
                      await load();
                      setMessage('Stock adjusted atomically.');
                    });
                  }}
                >
                  <h2 className="font-semibold text-lg">Adjust available stock</h2>
                  <p className="hint">
                    Add or remove units. Reserved inventory belongs to accepted orders.
                  </p>
                  <label className="block">
                    Product
                    <select
                      required
                      value={stockTarget}
                      onChange={(e) => setStockTarget(e.target.value)}
                      className="block w-full mt-1 rounded-md border bg-background p-2"
                    >
                      <option value="">Choose a product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    Units to add or remove
                    <Input
                      type="number"
                      required
                      value={delta}
                      onChange={(e) => setDelta(e.target.value)}
                    />
                  </label>
                  <Button disabled={busy || !stockTarget}>Adjust stock</Button>
                </form>
              </div>
              <div className="panel overflow-x-auto">
                <table>
                  <caption className="sr-only">Catalog products</caption>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Price</th>
                      <th>Available</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <Details data={p} />
                        </td>
                        <td>{dollars(p.priceCents)}</td>
                        <td>{p.availableStock}</td>
                        <td>
                          <Status value={p.active ? 'active' : 'inactive'} />
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                setEditing(p);
                                setName(p.name);
                                setDescription(p.description);
                                setPrice((p.priceCents / 100).toFixed(2));
                              }}
                            >
                              Edit {p.name}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy || !p.active}
                              onClick={() =>
                                void mutate(async () => {
                                  await request('/api/v1/products/' + p.id, { method: 'DELETE' });
                                  await load();
                                })
                              }
                            >
                              Deactivate
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {view === 'system' && (
            <>
              <div className="panel p-4 mb-5">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="badge">
                      {poll ? 'Live · 2-second polling' : 'Polling paused'}
                    </span>
                    <span className="hint">
                      Last status:{' '}
                      {systems.status?.at
                        ? new Date(systems.status.at).toLocaleTimeString()
                        : 'unavailable'}
                    </span>
                  </div>
                  <Button variant="outline" onClick={() => setPoll(!poll)}>
                    {poll ? <Pause size={14} /> : <Play size={14} />}{' '}
                    {poll ? 'Pause refresh' : 'Resume refresh'}
                  </Button>
                </div>
              </div>
              <nav aria-label="Dashboard views" className="flex flex-wrap gap-2 mb-5">
                {[
                  'Overview',
                  'Architecture',
                  'Cache',
                  'Shoppers',
                  'Failure Lab',
                  'Records',
                  'Timeline',
                  'Metrics',
                  'Controls',
                ].map((x) => (
                  <Button
                    key={x}
                    variant={tab === x ? 'default' : 'ghost'}
                    hint={dashboardHelp[x]}
                    aria-pressed={tab === x}
                    onClick={() => setTab(x)}
                  >
                    {x}
                  </Button>
                ))}
              </nav>
              {tab === 'Overview' && (
                <>
                  <div className="panel p-5 mb-5">
                    <h2 className="font-semibold">The data journey</h2>
                    <div className="flex flex-wrap gap-3 items-center mt-4">
                      {[
                        'Browser',
                        'Ordering',
                        'PostgreSQL',
                        'RabbitMQ',
                        'Fulfillment',
                        'Order outcome',
                      ].map((s, i) => (
                        <div key={s} className="flex gap-3 items-center">
                          <span className="badge">{s}</span>
                          {i < 5 && <ArrowRight size={14} />}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-4 mb-5">
                    {[
                      ['Orders', ordering?.states.reduce((s, x) => s + x.count, 0)],
                      ['Pending events', ordering?.pendingOutbox],
                      ['Fulfillment jobs', fulfillment?.states.reduce((s, x) => s + x.count, 0)],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="panel p-5">
                        <p className="hint">{label}</p>
                        <p className="hint">
                          {!poll ||
                          systems[label === 'Fulfillment jobs' ? 'fulfillment' : 'ordering']?.error
                            ? 'Stale observation'
                            : 'Polling every two seconds'}
                        </p>
                        <p className="metric mt-2">{value ?? 'Unavailable'}</p>
                      </div>
                    ))}
                  </div>
                  {['status', 'ordering', 'fulfillment', 'broker', 'host'].map((key) => (
                    <section key={key} className="panel p-5 mb-3">
                      <div className="flex justify-between">
                        <div className="flex gap-2 items-center">
                          <h2 className="font-semibold capitalize">{key}</h2>
                          <Help label={key}>
                            {systemHelp[key] ??
                              'Inspect the last recorded response, its source and sample time.'}
                          </Help>
                        </div>
                        <Status value={systems[key]?.error ? 'unavailable' : 'ready'} />
                      </div>
                      {systems[key]?.error && (
                        <p className="text-red-500 mt-2">
                          Stale or unavailable: {systems[key]?.error}
                        </p>
                      )}
                      <Details data={systems[key]?.data ?? null} label="Inspect recorded state" />
                    </section>
                  ))}
                </>
              )}
              {tab === 'Architecture' && (
                <Architecture
                  samples={systems}
                  polling={poll}
                  initialReference={journeyReference}
                />
              )}
              {['Cache', 'Shoppers', 'Failure Lab'].includes(tab) && (
                <LearningControls
                  mode={tab as 'Cache' | 'Shoppers' | 'Failure Lab'}
                  samples={systems}
                  polling={poll}
                  refresh={refreshSystems}
                  inspectJourney={(id) => {
                    setCorrelation(id);
                    setTab('Timeline');
                  }}
                />
              )}
              {tab === 'Records' && (
                <>
                  <h2 className="font-semibold mb-3">Fulfillment jobs and attempts</h2>
                  <div className="panel overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Job / order</th>
                          <th>Preset</th>
                          <th>Status</th>
                          <th>Attempt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fulfillment?.jobs?.map((j) => (
                          <tr key={String(j.id)}>
                            <td>
                              <code className="text-xs">{String(j.orderId)}</code>
                              <Details data={j} />
                            </td>
                            <td>{String(j.preset)}</td>
                            <td>
                              <Status value={String(j.status)} />
                            </td>
                            <td>{String(j.attemptNumber)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Details data={fulfillment?.attempts} label="Inspect attempt timestamps" />
                  <Details data={ordering?.outbox} label="Inspect ordering outbox" />
                  <Details data={fulfillment?.outbox} label="Inspect fulfillment outbox" />
                </>
              )}
              {tab === 'Timeline' && (
                <>
                  <div className="panel p-5 mb-4">
                    <div className="control-heading">
                      <h2 className="font-semibold">Collect recent owner activity</h2>
                      <Help label="Activity collection">
                        Collect up to 200 recent matching records from each owner. Missing producers
                        are labeled unavailable. Full retained logs remain on each owning host.
                      </Help>
                    </div>
                    <p className="hint">
                      One bounded report with source availability and ordered timestamps. Use a
                      valid correlation UUID below, or leave it empty.
                    </p>
                    <Button
                      className="mt-3"
                      variant="outline"
                      disabled={busy}
                      hint="Read the recent owner windows once. This does not copy full log archives or run a lifecycle command."
                      onClick={() =>
                        void mutate(async () => {
                          const result = await request(
                            '/operator/api/v1/activity' +
                              (correlation
                                ? '?correlationId=' + encodeURIComponent(correlation)
                                : ''),
                          );
                          setCollected(result.data);
                        })
                      }
                    >
                      Collect activity
                    </Button>
                    <Details
                      data={collected}
                      label="Inspect collected evidence and missing sources"
                    />
                  </div>
                  <label className="block mb-4">
                    Filter by correlation ID
                    <Input
                      placeholder="Leave empty to show recent activity"
                      value={correlation}
                      onChange={(e) => setCorrelation(e.target.value)}
                    />
                  </label>
                  <section className="panel p-4 mb-3">
                    <h2 className="font-semibold">Current browser activity</h2>
                    <p className="hint">
                      Bounded to 200 entries in this tab; reload clears it. These observations are
                      not collected from other browsers.
                    </p>
                    <Details
                      data={browserActivity
                        .filter((x) => !correlation || x.correlationId === correlation)
                        .slice(-30)
                        .reverse()}
                      label="Inspect browser input / process / output"
                    />
                  </section>
                  {['orderingLogs', 'fulfillmentLogs', 'operatorLogs'].map((key) => (
                    <section key={key} className="panel p-4 mb-3">
                      <h2 className="font-semibold mb-3">{key.replace('Logs', ' activity')}</h2>
                      {systems[key]?.error && <p className="text-red-500">Unavailable / stale</p>}
                      {((systems[key]?.data ?? []) as RecordData[])
                        .filter((x) => !correlation || x.correlationId === correlation)
                        .slice(0, 30)
                        .map((x) => (
                          <div key={String(x.id)} className="border-t py-3">
                            <div className="flex gap-3 flex-wrap">
                              <span className="hint">
                                {new Date(String(x.occurredAt)).toLocaleTimeString()}
                              </span>
                              <strong>{String(x.type)}</strong>
                            </div>
                            <Details data={x} />
                          </div>
                        ))}
                    </section>
                  ))}
                </>
              )}
              {tab === 'Metrics' && (
                <>
                  <p className="hint mb-4">
                    Process counters reset on restart. Each measurement includes its source and
                    sampling time. Unsupported measurements are unavailable.
                  </p>
                  <section className="panel p-5 mb-4">
                    <h2 className="font-semibold">Current browser</h2>
                    <pre>{display(browserMetrics)}</pre>
                  </section>
                  {[
                    'orderingMetrics',
                    'fulfillmentMetrics',
                    'operatorMetrics',
                    'broker',
                    'host',
                  ].map((key) => (
                    <section key={key} className="panel p-5 mb-4">
                      <h2 className="font-semibold">{key}</h2>
                      <p className="hint">
                        Sampled {systems[key]?.at ?? 'unavailable'}{' '}
                        {systems[key]?.error && '· stale'}
                      </p>
                      <pre>{display(systems[key]?.data ?? { unavailable: true })}</pre>
                    </section>
                  ))}
                </>
              )}
              {tab === 'Controls' && (
                <SystemControls samples={systems} busy={busy} control={control} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
