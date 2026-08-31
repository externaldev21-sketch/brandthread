import { ReplitConnectors } from "@replit/connectors-sdk";

type ApiList<T> = { items?: T[]; next_page?: string | null };
type RevenueCatProject = { id: string; name: string };
type RevenueCatApp = { id: string; name: string; type: string };
type RevenueCatProduct = {
  id: string;
  app_id: string;
  store_identifier: string;
  display_name?: string;
};
type RevenueCatEntitlement = { id: string; lookup_key: string };
type RevenueCatOffering = { id: string; lookup_key: string; is_current: boolean };
type RevenueCatPackage = { id: string; lookup_key: string };
type RevenueCatWebhook = { id: string; name: string };

const PROJECT_NAME = "Brandthread";
const IOS_BUNDLE_ID = "com.brandthread.mobile";
const ANDROID_PACKAGE_NAME = "com.brandthread.mobile";
const ENTITLEMENT_LOOKUP_KEY = "seller_access";
const OFFERING_LOOKUP_KEY = "default";

const PLANS = [
  { id: "starter", name: "Starter", amountMicros: 29_000_000 },
  { id: "growth", name: "Growth", amountMicros: 79_000_000 },
  { id: "pro", name: "Pro", amountMicros: 199_000_000 },
] as const;

const connectors = new ReplitConnectors();

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await connectors.proxy("revenuecat", `/v2${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`RevenueCat ${init.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }
  return body ? JSON.parse(body) as T : {} as T;
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let nextPath: string | null = `${path}${path.includes("?") ? "&" : "?"}limit=100`;
  while (nextPath) {
    const page: ApiList<T> = await request<ApiList<T>>(nextPath);
    items.push(...(page.items ?? []));
    nextPath = page.next_page ?? null;
  }
  return items;
}

async function createOrGetProject(): Promise<RevenueCatProject> {
  const projects = await listAll<RevenueCatProject>("/projects");
  const existing = projects.find((project) => project.name === PROJECT_NAME);
  if (existing) return existing;
  return request<RevenueCatProject>("/projects", {
    method: "POST",
    body: { name: PROJECT_NAME },
  });
}

async function createOrGetApp(
  projectId: string,
  apps: RevenueCatApp[],
  type: string,
  name: string,
  body: Record<string, unknown>,
): Promise<RevenueCatApp> {
  const existing = apps.find((app) => app.type === type);
  if (existing) return existing;
  return request<RevenueCatApp>(`/projects/${projectId}/apps`, {
    method: "POST",
    body: { name, type, ...body },
  });
}

async function createOrGetProduct(
  projectId: string,
  app: RevenueCatApp,
  plan: (typeof PLANS)[number],
  storeIdentifier: string,
  isTestStore: boolean,
  products: RevenueCatProduct[],
): Promise<RevenueCatProduct> {
  const existing = products.find(
    (product) => product.app_id === app.id && product.store_identifier === storeIdentifier,
  );
  if (existing) return existing;
  return request<RevenueCatProduct>(`/projects/${projectId}/products`, {
    method: "POST",
    body: {
      app_id: app.id,
      store_identifier: storeIdentifier,
      type: "subscription",
      display_name: `Brandthread ${plan.name} Monthly`,
      ...(isTestStore
        ? {
            title: `Brandthread ${plan.name}`,
            subscription: { duration: "P1M" },
          }
        : {}),
    },
  });
}

async function attachProducts(path: string, body: unknown): Promise<void> {
  const response = await connectors.proxy("revenuecat", `/v2${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const errorText = await response.text();
  // RevenueCat returns 422 when an already-attached product is attached again.
  if (response.status === 422) return;
  throw new Error(`RevenueCat POST ${path} failed (${response.status}): ${errorText}`);
}

async function ensureTestStorePrice(projectId: string, productId: string, amountMicros: number): Promise<void> {
  const response = await connectors.proxy(
    "revenuecat",
    `/v2/projects/${projectId}/products/${productId}/test_store_prices`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prices: [{ amount_micros: amountMicros, currency: "USD" }] }),
    },
  );
  if (response.ok || response.status === 409 || response.status === 422) return;
  throw new Error(`RevenueCat test-store price failed (${response.status}): ${await response.text()}`);
}

async function getPublicApiKey(projectId: string, appId: string): Promise<string> {
  const result = await request<{ items?: Array<{ key: string }> }>(
    `/projects/${projectId}/apps/${appId}/public_api_keys`,
  );
  const key = result.items?.find((item) => item.key)?.key;
  if (!key) throw new Error(`No public API key found for RevenueCat app ${appId}`);
  return key;
}

async function ensureLifecycleWebhook(projectId: string): Promise<void> {
  const authorization = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION
    ?? (process.env.SESSION_SECRET ? `Bearer ${process.env.SESSION_SECRET}` : undefined);
  if (!authorization) {
    throw new Error("SESSION_SECRET or REVENUECAT_WEBHOOK_AUTHORIZATION is required to secure the lifecycle webhook");
  }
  const webhooks = await listAll<RevenueCatWebhook>(`/projects/${projectId}/integrations/webhooks`);
  const existing = webhooks.find((item) => item.name === "Brandthread Lifecycle");
  await request(
    existing
      ? `/projects/${projectId}/integrations/webhooks/${existing.id}`
      : `/projects/${projectId}/integrations/webhooks`,
    {
      method: "POST",
      body: {
        name: "Brandthread Lifecycle",
        url: "https://brandthread.app/api-server/api/webhooks/revenuecat",
        authorization_header: authorization,
        environment: null,
        event_types: null,
        app_id: null,
      },
    },
  );
}

async function main() {
  const project = await createOrGetProject();
  const apps = await listAll<RevenueCatApp>(`/projects/${project.id}/apps`);
  const testStore = await createOrGetApp(project.id, apps, "test_store", "Brandthread Test Store", {});
  const appStore = await createOrGetApp(project.id, apps, "app_store", "Brandthread iOS", {
    app_store: { bundle_id: IOS_BUNDLE_ID },
  });
  const playStore = await createOrGetApp(project.id, apps, "play_store", "Brandthread Android", {
    play_store: { package_name: ANDROID_PACKAGE_NAME },
  });

  const products = await listAll<RevenueCatProduct>(`/projects/${project.id}/products`);
  const productByPlan = new Map<string, RevenueCatProduct[]>();
  for (const plan of PLANS) {
    const testProduct = await createOrGetProduct(
      project.id, testStore, plan, `brandthread_${plan.id}_monthly`, true, products,
    );
    const iosProduct = await createOrGetProduct(
      project.id, appStore, plan, `brandthread_${plan.id}_monthly`, false, products,
    );
    const androidProduct = await createOrGetProduct(
      project.id, playStore, plan, `brandthread_${plan.id}_monthly:monthly`, false, products,
    );
    await ensureTestStorePrice(project.id, testProduct.id, plan.amountMicros);
    productByPlan.set(plan.id, [testProduct, iosProduct, androidProduct]);
  }

  const entitlements = await listAll<RevenueCatEntitlement>(`/projects/${project.id}/entitlements`);
  const entitlement = entitlements.find((item) => item.lookup_key === ENTITLEMENT_LOOKUP_KEY)
    ?? await request<RevenueCatEntitlement>(`/projects/${project.id}/entitlements`, {
      method: "POST",
      body: { lookup_key: ENTITLEMENT_LOOKUP_KEY, display_name: "Seller Subscription Access" },
    });
  await attachProducts(`/projects/${project.id}/entitlements/${entitlement.id}/actions/attach_products`, {
    product_ids: [...productByPlan.values()].flat().map((product) => product.id),
  });

  const offerings = await listAll<RevenueCatOffering>(`/projects/${project.id}/offerings`);
  const offering = offerings.find((item) => item.lookup_key === OFFERING_LOOKUP_KEY)
    ?? await request<RevenueCatOffering>(`/projects/${project.id}/offerings`, {
      method: "POST",
      body: { lookup_key: OFFERING_LOOKUP_KEY, display_name: "Brandthread Seller Plans" },
    });
  if (!offering.is_current) {
    await request(`/projects/${project.id}/offerings/${offering.id}`, {
      method: "POST",
      body: { is_current: true },
    });
  }

  const packages = await listAll<RevenueCatPackage>(`/projects/${project.id}/offerings/${offering.id}/packages`);
  for (const plan of PLANS) {
    const packageLookupKey = `$bt_${plan.id}`;
    const packageItem = packages.find((item) => item.lookup_key === packageLookupKey)
      ?? await request<RevenueCatPackage>(`/projects/${project.id}/offerings/${offering.id}/packages`, {
        method: "POST",
        body: { lookup_key: packageLookupKey, display_name: `${plan.name} Monthly` },
      });
    await attachProducts(`/projects/${project.id}/packages/${packageItem.id}/actions/attach_products`, {
      products: [...(productByPlan.get(plan.id) ?? [])].map((product) => ({
        product_id: product.id,
        eligibility_criteria: "all",
      })),
    });
  }

  const keys = {
    EXPO_PUBLIC_REVENUECAT_TEST_API_KEY: await getPublicApiKey(project.id, testStore.id),
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: await getPublicApiKey(project.id, appStore.id),
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: await getPublicApiKey(project.id, playStore.id),
  };
  await ensureLifecycleWebhook(project.id);
  console.log(JSON.stringify({
    projectId: project.id,
    testStoreAppId: testStore.id,
    appleAppStoreAppId: appStore.id,
    googlePlayStoreAppId: playStore.id,
    entitlementIdentifier: ENTITLEMENT_LOOKUP_KEY,
    ...keys,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});