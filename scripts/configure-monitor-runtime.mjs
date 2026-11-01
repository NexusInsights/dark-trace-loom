import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsFor, freshOutput, publicBackend, readConfiguration, relocateConfiguration, secureOrigin, writeFreshJson } from './configure-public-bindings.mjs';

export function configureMonitorRuntime(argv) {
  const options = argumentsFor(argv, ['--pages-config', '--worker-config', '--pages-output', '--worker-output', '--expected-project-ref', '--expected-pages-name', '--expected-worker-name', '--app-origin']);
  const inputs = [options['--pages-config'], options['--worker-config']];
  const pagesOutput = freshOutput(options['--pages-output'], inputs);
  const workerOutput = freshOutput(options['--worker-output'], inputs);
  if (pagesOutput.toLowerCase() === workerOutput.toLowerCase()) throw new Error('Pages and worker staging outputs must be distinct files.');
  const pages = readConfiguration(options['--pages-config'], options['--expected-pages-name']);
  const worker = readConfiguration(options['--worker-config'], options['--expected-worker-name']);
  const backend = publicBackend(pages.vars?.SUPABASE_URL, pages.vars?.SUPABASE_PUBLISHABLE_KEY, options['--expected-project-ref']);
  // Both configs must be deliberately prepared for the same target first. This
  // prevents a target Pages file from silently retargeting a production worker.
  publicBackend(worker.vars?.SUPABASE_URL, worker.vars?.SUPABASE_PUBLISHABLE_KEY, options['--expected-project-ref']);
  const appOrigin = secureOrigin(options['--app-origin'], 'App origin');
  if (worker.vars?.APP_ORIGIN && worker.vars.APP_ORIGIN !== appOrigin) throw new Error('Worker APP_ORIGIN does not match the explicit target app origin.');
  if (!Array.isArray(worker.durable_objects?.bindings) || worker.durable_objects.bindings.some(binding => !binding || typeof binding !== 'object')
    || !worker.durable_objects.bindings.some(binding => binding.name === 'MONITOR_STORE' && binding.class_name === 'MonitorStore'))
    throw new Error('Expected monitoring Durable Object binding is missing.');
  if (worker.triggers?.crons?.length) throw new Error('Monitoring uses Durable Object alarms; a cron-configured input is not an approved alarm-worker target.');
  if (pages.services !== undefined && !Array.isArray(pages.services)) throw new Error('Pages service bindings must be an array.');
  if (pages.services?.some(service => !service || typeof service !== 'object' || typeof service.binding !== 'string'))
    throw new Error('Pages service binding records are invalid.');
  const preparedWorker = { ...relocateConfiguration(worker, options['--worker-config'], workerOutput), vars: {
    ...worker.vars, APP_ORIGIN: appOrigin, SUPABASE_URL: backend.url, SUPABASE_PUBLISHABLE_KEY: backend.key,
    FEED_INGRESS_BASE: `${appOrigin}/api/marketplace-monitor`,
  } };
  const preparedPages = { ...relocateConfiguration(pages, options['--pages-config'], pagesOutput), services: [
    ...(pages.services || []).filter(service => service.binding !== 'MARKETPLACE_MONITOR'),
    { binding: 'MARKETPLACE_MONITOR', service: worker.name },
  ] };
  // All validation completes before either file is created. If a filesystem write
  // fails, report it explicitly and preserve any completed staging output.
  try { writeFreshJson(workerOutput, preparedWorker); writeFreshJson(pagesOutput, preparedPages); }
  catch { throw new Error('Staging output creation failed; inspect both explicit output paths. Inputs and existing backups remain unchanged.'); }
  return {
    prepared_only: true, worker: worker.name, pages: pages.name, expected_project_ref: backend.ref,
    storage: 'preserved SQLite Durable Object binding', scheduler: 'durable_object_alarm',
    pages_service_binding: 'MARKETPLACE_MONITOR', outputs: { pages: pagesOutput, worker: workerOutput }, remote_writes: false,
  };
}

const help = 'Compose new staging monitor configurations; no input overwrite or deployment.\nUsage: node scripts/configure-monitor-runtime.mjs --pages-config <target-pages.jsonc> --worker-config <target-worker.jsonc> --pages-output <new-pages.jsonc> --worker-output <new-worker.jsonc> --expected-project-ref <20-character-ref> --expected-pages-name <name> --expected-worker-name <name> --app-origin <https://app.example>\nBoth input auth configs must already match the expected target. Preserve worker DO bindings/migrations and use its alarm scheduler. No key values are logged.\n';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') process.stdout.write(help);
    else process.stdout.write(JSON.stringify(configureMonitorRuntime(process.argv.slice(2)), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`Monitoring configuration preparation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exitCode = 1;
  }
}
