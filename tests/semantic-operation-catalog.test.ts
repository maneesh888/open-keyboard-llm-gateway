import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadSemanticOperationCatalog } from '../src/semantic/operationCatalog.js';

describe('semantic operation catalog', () => {
  it('projects every canonical contract operation without prompt or fixture content', () => {
    const root = process.cwd();
    const contractsRoot = join(root, 'Vendor', 'semantic-prompt-contract', 'contracts');
    const manifest = JSON.parse(readFileSync(join(contractsRoot, 'manifest.json'), 'utf-8'));
    const catalog = loadSemanticOperationCatalog(root);

    expect(catalog.contractVersion).toBe(manifest.contract_version);
    expect(catalog.schemaVersion).toBe(manifest.schema_version);
    expect(catalog.groups).toHaveLength(manifest.packs.length);

    for (const [index, pack] of manifest.packs.entries()) {
      const contract = JSON.parse(readFileSync(join(contractsRoot, pack.path), 'utf-8'));
      expect(catalog.groups[index]).toEqual({
        id: contract.id,
        description: contract.description,
        operations: contract.operations.map((operation: Record<string, unknown>) => ({
          id: operation.id,
          applicationOperation: operation.wire_operation_id || null,
          description: operation.description,
        })),
      });
    }

    for (const group of catalog.groups) {
      expect(group).not.toHaveProperty('system_instruction');
      for (const operation of group.operations) {
        expect(Object.keys(operation)).toEqual(['id', 'applicationOperation', 'description']);
      }
    }
  });
});
