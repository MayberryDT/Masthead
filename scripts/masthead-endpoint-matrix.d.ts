export type EndpointMatrixEntry = {
  method: string;
  path: string;
  label: string;
  allowNotFound?: boolean;
};

export const READ_ONLY_ENDPOINTS: EndpointMatrixEntry[];
export const READ_ONLY_POST_ENDPOINTS: Array<EndpointMatrixEntry & { body?: unknown }>;
export const BLOCKED_MUTATION_ENDPOINTS: EndpointMatrixEntry[];

export function endpointProbePasses(entry: EndpointMatrixEntry | undefined, contract: string): boolean;
