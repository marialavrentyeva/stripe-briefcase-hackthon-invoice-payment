import { createHash } from 'node:crypto';
import type { Evidence, IntegrationStatus } from '../shared/types.js';

type Json = Record<string, any>;
function config() {
  const apiKey = process.env.COGNEE_API_KEY?.trim();
  if (!apiKey) throw new Error('Set COGNEE_API_KEY locally to connect Cognee Cloud.');
  const configuredBase = process.env.COGNEE_BASE_URL?.trim();
  if (!configuredBase) throw new Error('Set COGNEE_BASE_URL to the tenant API Base URL from Cognee Cloud → API Keys → Connection Details.');
  const base = new URL(configuredBase);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('COGNEE_BASE_URL must be an HTTPS service URL without embedded credentials.');
  const datasetName = process.env.COGNEE_DATASET_NAME?.trim() || 'briefcase_demo';
  return { apiKey, baseUrl: base.toString().replace(/\/$/, ''), datasetName, tenantId: process.env.COGNEE_TENANT_ID?.trim() };
}
async function request(path: string, options: { method?: string; json?: unknown; form?: FormData; timeout?: number } = {}): Promise<unknown> {
  const { apiKey, baseUrl, tenantId } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { method: options.method || 'GET', redirect: 'error', signal: AbortSignal.timeout(options.timeout || 15_000), headers: { 'X-Api-Key': apiKey, ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}), ...(options.json ? { 'Content-Type': 'application/json' } : {}) }, body: options.form || (options.json ? JSON.stringify(options.json) : undefined) });
  } catch (error) {
    const failure = error as { name?: string; cause?: { code?: string } };
    const code = failure.cause?.code;
    const writeHint = options.form || path === '/api/v1/cognify' ? ' A submitted ingestion job may still be running; check Cloud before reseeding.' : '';
    if (failure.name === 'TimeoutError' || failure.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') throw new Error(`Cognee request timed out. Open the Cloud workspace if it is sleeping, then retry.${writeHint}`);
    if (code && /SSL|TLS|CERT/.test(code)) throw new Error('Cognee secure connection failed before an API response. Check the tenant API Base URL in Cloud → API Keys → Connection Details; the shared api.cognee.ai hostname may not serve your workspace.');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new Error('Cognee hostname could not be resolved. Check COGNEE_BASE_URL against your tenant Connection Details and check network connectivity.');
    throw new Error(`Cognee network connection failed. Check the tenant API Base URL and connectivity.${writeHint}`);
  }
  if (!response.ok) throw new Error(`Cognee returned HTTP ${response.status}. Check the API key, dataset access and Cloud service status.`);
  try { return await response.json(); } catch { throw new Error('Cognee returned an unreadable response.'); }
}
export async function getCogneeStatus(): Promise<IntegrationStatus> {
  const configured = Boolean(process.env.COGNEE_API_KEY?.trim());
  if (!configured) return { configured: false, connected: false, mode: 'cloud', message: 'Cognee Cloud is not configured. Local source documents remain available.' };
  try {
    // Health alone can be public; the dataset list verifies authentication as well.
    await request('/health');
    await request('/api/v1/datasets/');
    return { configured: true, connected: true, mode: 'cloud', message: `Cognee Cloud connected. Retrieval is scoped to ${config().datasetName}; seed documents before searching.` };
  } catch (error) { return { configured: true, connected: false, mode: 'cloud', message: error instanceof Error ? error.message : 'Cognee could not be verified.' }; }
}
export async function seedCognee(documents: { id: string; text: string }[]): Promise<{ datasetName: string; documentCount: number; accepted: true }> {
  const { datasetName } = config();
  if (!documents.length || documents.some(doc => !doc.id || !doc.text.trim())) throw new Error('Cognee seeding requires non-empty source documents with stable IDs.');
  const form = new FormData();
  form.set('datasetName', datasetName);
  form.set('run_in_background', 'false');
  for (const document of documents) {
    const filename = `${document.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${createHash('sha256').update(document.text).digest('hex').slice(0, 12)}.txt`;
    form.append('data', new Blob([`Source document: ${document.id}\n\n${document.text}`], { type: 'text/plain' }), filename);
  }
  const ingestion = await request('/api/v1/add', { method: 'POST', form, timeout: 60_000 });
  assertPipelineAccepted(ingestion);
  const processing = await request('/api/v1/cognify', { method: 'POST', json: { datasets: [datasetName], run_in_background: true }, timeout: 30_000 });
  assertPipelineAccepted(processing);
  return { datasetName, documentCount: documents.length, accepted: true };
}
function assertPipelineAccepted(value: unknown, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 6) return;
  const row = value as Json;
  if (row.error || (typeof row.status === 'string' && /error|fail|cancel/i.test(row.status))) throw new Error('Cognee reported a failed ingestion or processing job. Check the Cloud dashboard before reseeding.');
  for (const child of Object.values(row)) if (child && typeof child === 'object') assertPipelineAccepted(child, depth + 1);
}
/** Preserve actual chunk text and references. Do not turn completion prose or errors into source evidence. */
function normalizeChunks(response: unknown, datasetName: string): Evidence[] {
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth = 0, inheritedDataset?: string) => {
    if (depth > 8 || evidence.length >= 8 || value == null) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1, inheritedDataset); return; }
    if (typeof value !== 'object') return;
    const row = value as Json;
    const dataset = typeof row.dataset_id === 'string' ? row.dataset_id : inheritedDataset;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : row;
    if (typeof payload.text === 'string' && payload.text.trim()) {
      const reference = payload.id ?? payload.chunk_id ?? row.id;
      const text = payload.text;
      // Hash is explicitly a local response fingerprint only when the service omits an ID.
      const id = reference ? `cognee:${String(reference)}` : `cognee:response-sha256:${createHash('sha256').update(text).digest('hex').slice(0, 20)}`;
      if (!seen.has(id)) {
        seen.add(id);
        const origin = payload.source_document?.id ?? payload.document_id ?? payload.source ?? payload.file_name;
        const source = typeof origin === 'string' ? ` · source ${origin}` : '';
        evidence.push({ id, source: 'cognee', title: `Cognee chunk · ${datasetName}${dataset ? ` (${dataset})` : ''}${source}${reference ? ` · ${String(reference)}` : ' · service omitted chunk ID'}`, excerpt: text });
      }
      return;
    }
    for (const name of ['search_result', 'results', 'data', 'chunks']) if (row[name] != null) walk(row[name], depth + 1, dataset);
  };
  walk(response);
  return evidence;
}
export async function searchCognee(query: string): Promise<Evidence[]> {
  const { datasetName } = config();
  if (!query.trim() || query.length > 20_000) throw new Error('Cognee search needs a non-empty query under 20,000 characters.');
  const response = await request('/api/v1/search', { method: 'POST', json: { query, search_type: 'CHUNKS', datasets: [datasetName], top_k: 8 }, timeout: 30_000 });
  return normalizeChunks(response, datasetName);
}
