import { loadSeedkernel } from '@seedkernel/wasm';

// NOTE: Top-level await, not beforeAll: specs may call a codec while their module body evaluates,
// which happens before any hook runs. Loading is idempotent and cached across files.
await loadSeedkernel();
