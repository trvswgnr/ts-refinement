import type { Refined } from "ts-refinement";

type Strong = Refined<number, "value > 5">;
type Weak = Refined<number, "value > 0">;
type Box<Value> = { readonly value: Value };
type Tagged<Value> = { readonly kind: "empty" } | { readonly kind: "value"; readonly value: Value };

interface StrongNode {
  readonly children: readonly StrongNode[];
  readonly value: Strong;
}

interface WeakNode {
  readonly children: readonly WeakNode[];
  readonly value: Weak;
}

declare const propertyStrong: { readonly value: Strong };
declare const propertyWeak: { readonly value: Weak };
declare const optionalStrong: { readonly value?: Strong };
declare const optionalWeak: { readonly value?: Weak };
declare const arrayStrong: readonly Strong[];
declare const arrayWeak: readonly Weak[];
declare const mutableArrayStrong: Strong[];
declare const tupleStrong: readonly [Strong, string];
declare const tupleWeak: readonly [Weak, string];
declare const optionalTupleStrong: readonly [Strong, string?];
declare const optionalTupleWeak: readonly [Weak, string?];
declare const optionalOnlyStrong: readonly [Strong?];
declare const restTupleStrong: readonly [Strong, ...Strong[]];
declare const restTupleWeak: readonly [Weak, ...Weak[]];
declare const shortTupleStrong: readonly [Strong];
declare const fixedPairStrong: readonly [Strong, Strong];
declare const numericTupleStrong: readonly [Strong, number];
declare const boxStrong: Box<Strong>;
declare const boxWeak: Box<Weak>;
declare const taggedStrong: Tagged<Strong>;
declare const taggedWeak: Tagged<Weak>;
declare const parameterBroad: (value: Weak) => void;
declare const parameterNarrow: (value: Strong) => void;
declare const nodeStrong: StrongNode;
declare const nodeWeak: WeakNode;

export const validProperty: { readonly value: Weak } = propertyStrong;
export const invalidProperty: { readonly value: Strong } = propertyWeak;
export const validOptional: { readonly value?: Weak } = optionalStrong;
export const invalidOptional: { readonly value?: Strong } = optionalWeak;
export const validArray: readonly Weak[] = arrayStrong;
export const invalidArray: readonly Strong[] = arrayWeak;
export const validTuple: readonly [Weak, string] = tupleStrong;
export const invalidTuple: readonly [Strong, string] = tupleWeak;
export const validOptionalTuple: readonly [Weak, string?] = optionalTupleStrong;
export const invalidOptionalTuple: readonly [Strong, string?] = optionalTupleWeak;
export const validRestTuple: readonly [Weak, ...Weak[]] = restTupleStrong;
export const invalidRestTuple: readonly [Strong, ...Strong[]] = restTupleWeak;
export const validGeneric: Box<Weak> = boxStrong;
export const invalidGeneric: Box<Strong> = boxWeak;
export const validUnion: Tagged<Weak> = taggedStrong;
export const invalidUnion: Tagged<Strong> = taggedWeak;
export const validParameter: (value: Strong) => void = parameterBroad;
export const invalidParameter: (value: Weak) => void = parameterNarrow;
export const validRecursive: WeakNode = nodeStrong;
export const invalidRecursive: StrongNode = nodeWeak;
export const validMutableArray: readonly Weak[] = mutableArrayStrong;
export const invalidReadonlyArray: Weak[] = arrayStrong;
export const invalidOptionalRequired: { readonly value: Weak } = optionalStrong;
export const invalidTupleLength: readonly [Weak, string] = shortTupleStrong;
export const invalidTupleMember: readonly [Weak, string] = numericTupleStrong;
export const validRequiredToOptionalTuple: readonly [Weak, string?] = tupleStrong;
export const validShortToOptionalTuple: readonly [Weak, string?] = shortTupleStrong;
export const validFixedToRestTuple: readonly [Weak, ...Weak[]] = fixedPairStrong;
export const invalidOptionalToRequiredTuple: readonly [Weak] = optionalOnlyStrong;
export const invalidRestToFixedTuple: readonly [Weak, Weak] = restTupleStrong;
export const invalidTupleExtra: readonly [Weak] = fixedPairStrong;
export const invalidFixedToRestMember: readonly [Weak, ...number[]] = tupleStrong;
