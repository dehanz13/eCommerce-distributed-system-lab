// Files implementing domain rules, public data validation, client recovery,
// simulation policy and interpretation of observed journeys. No file exclusion
// is applied to the separate overall report.
export const businessFiles = [
  'apps/ordering/src/domain.ts',
  'apps/ordering/src/policies.ts',
  'apps/ordering/src/catalog-cache.ts',
  'apps/fulfillment/src/domain.ts',
  'apps/fulfillment/src/policies.ts',
  'apps/web/lib/architecture-flow.ts',
  'packages/contracts/src/index.ts',
  'packages/contracts/src/experiments.ts',
  'packages/client/src/index.ts',
  'tools/shopper-behavior.ts',
  'tools/feeder.ts',
  'tools/experiments.ts',
];
