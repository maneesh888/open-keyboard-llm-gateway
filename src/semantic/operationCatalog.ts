import { readFileSync } from 'fs';
import { resolve, sep } from 'path';

type JsonObject = Record<string, unknown>;

export type SemanticOperation = {
  id: string;
  applicationOperation: string | null;
  description: string;
};

export type SemanticOperationGroup = {
  id: string;
  description: string;
  operations: SemanticOperation[];
};

export type SemanticOperationCatalog = {
  schemaVersion: string;
  contractVersion: string;
  groups: SemanticOperationGroup[];
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readJson(path: string): JsonObject {
  return object(JSON.parse(readFileSync(path, 'utf-8')), path);
}

export function loadSemanticOperationCatalog(root = process.cwd()): SemanticOperationCatalog {
  const contractsRoot = resolve(root, 'Vendor', 'semantic-prompt-contract', 'contracts');
  const manifest = readJson(resolve(contractsRoot, 'manifest.json'));
  const packs = manifest.packs;
  if (!Array.isArray(packs)) throw new Error('semantic contract manifest packs must be an array');

  const groups = packs.map((packValue, packIndex): SemanticOperationGroup => {
    const pack = object(packValue, `manifest pack ${packIndex}`);
    const relativePath = string(pack.path, `manifest pack ${packIndex} path`);
    const contractPath = resolve(contractsRoot, relativePath);
    if (!contractPath.startsWith(`${contractsRoot}${sep}`)) {
      throw new Error(`semantic contract pack path escapes contracts directory: ${relativePath}`);
    }

    const contract = readJson(contractPath);
    const operations = contract.operations;
    if (!Array.isArray(operations)) {
      throw new Error(`semantic contract ${relativePath} operations must be an array`);
    }

    return {
      id: string(contract.id, `${relativePath} id`),
      description: string(contract.description, `${relativePath} description`),
      operations: operations.map((operationValue, operationIndex): SemanticOperation => {
        const operation = object(operationValue, `${relativePath} operation ${operationIndex}`);
        const wireOperation = operation.wire_operation_id;
        if (wireOperation !== null && wireOperation !== undefined && typeof wireOperation !== 'string') {
          throw new Error(`${relativePath} operation ${operationIndex} wire_operation_id must be a string or null`);
        }
        return {
          id: string(operation.id, `${relativePath} operation ${operationIndex} id`),
          applicationOperation: wireOperation || null,
          description: string(operation.description, `${relativePath} operation ${operationIndex} description`),
        };
      }),
    };
  });

  return {
    schemaVersion: string(manifest.schema_version, 'semantic contract schema_version'),
    contractVersion: string(manifest.contract_version, 'semantic contract contract_version'),
    groups,
  };
}
