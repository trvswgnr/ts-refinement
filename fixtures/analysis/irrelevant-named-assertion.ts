interface ExternalType {
  readonly value: number;
}

declare const value: ExternalType;

export const ordinaryNamedAssertion = value as ExternalType;
