export type EndpointMatrixEntry = {
  method: string;
  path: string;
  label: string;
  allowNotFound?: boolean;
};

export function endpointProbePasses(entry: EndpointMatrixEntry | undefined, contract: string): boolean;
