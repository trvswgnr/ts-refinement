import type {
  BetweenZeroAndTen,
  ExactlyFive,
  GreaterThanFive,
  NonPositive,
  Positive,
} from "./types.ts";

declare const dynamic: number;
declare function unsupportedGuard(value: number): boolean;

export function guardedIf(n: number) {
  if (n > 0) return n as Positive;
  return null;
}

export function guardedElse(n: number) {
  if (n !== 5) return null;
  else return n as ExactlyFive;
}

export function nestedGuards(n: number) {
  if (n > 0) {
    if (n < 10) return n as BetweenZeroAndTen;
  }
  return null;
}

export function guardedAnd(n: number) {
  return n > 0 && (n as Positive);
}

export function guardedConditional(n: number) {
  return n > 0 ? (n as Positive) : null;
}

export function guardedConditionalFalse(n: number) {
  return n !== 5 ? null : (n as ExactlyFive);
}

export function reassignedAfterGuard(n: number) {
  if (n > 0) {
    n = dynamic;
    return n as Positive;
  }
  return null;
}

export function shadowedSubject(n: number) {
  if (n > 0) return ((n: number) => n as Positive)(dynamic);
  return null;
}

export function nanSensitiveFalseBranch(n: number) {
  if (n > 0) return null;
  return n as NonPositive;
}

export function unsupportedGuardFact(n: number) {
  if (unsupportedGuard(n)) return n as Positive;
  return null;
}

export function deferredClosure(n: number) {
  if (n > 0) {
    const read = () => n as Positive;
    n = -1;
    return read();
  }
  return null;
}

export function loopBackedge(n: number) {
  const values: Positive[] = [];
  if (n > 0) {
    for (let index = 0; index < 2; index += 1) {
      values.push(n as Positive);
      n = dynamic;
    }
  }
  return values;
}

export function varInitializer(n: number) {
  if (n > 0) {
    var n = dynamic;
    return n as Positive;
  }
  return null;
}

export function capturedMutator(n: number) {
  function mutate() {
    n = dynamic;
  }
  if (n > 0) {
    mutate();
    return n as Positive;
  }
  return null;
}

export function implicitIterator(n: number) {
  const iterable = {
    *[Symbol.iterator]() {
      n = dynamic;
      yield 0;
    },
  };
  if (n > 0) {
    [...iterable];
    return n as Positive;
  }
  return null;
}

export function destructuringIterator(n: number) {
  const iterable = {
    *[Symbol.iterator]() {
      n = dynamic;
      yield 0;
    },
  };
  if (n > 0) {
    const [value] = iterable;
    void value;
    return n as Positive;
  }
  return null;
}

export function implicitCoercion(n: number) {
  const value = {
    valueOf() {
      n = dynamic;
      return 0;
    },
  };
  if (n > 0) {
    void +value;
    return n as Positive;
  }
  return null;
}

export function proxyOperator(n: number) {
  const proxy = new Proxy(
    {},
    {
      has() {
        n = dynamic;
        return false;
      },
    },
  );
  if (n > 0) {
    void ("value" in proxy);
    return n as Positive;
  }
  return null;
}

export function templateCoercion(n: number) {
  const value = {
    toString() {
      n = dynamic;
      return "";
    },
  };
  if (n > 0) return `${value}${n as Positive}`;
  return null;
}

export function computedObjectKey(n: number) {
  const key: any = {
    [Symbol.toPrimitive]() {
      n = dynamic;
      return "key";
    },
  };
  if (n > 0) return { [key]: 1, value: n as Positive }.value;
  return null;
}

export function arrayBindingDefault(n: number) {
  const iterable = {
    *[Symbol.iterator]() {
      n = dynamic;
      yield undefined;
    },
  };
  if (n > 0) {
    const [value = n as Positive] = iterable;
    return value;
  }
  return null;
}

export function objectBindingDefault(n: number) {
  const source = {
    get value(): number | undefined {
      n = dynamic;
      return undefined;
    },
  };
  if (n > 0) {
    const { value = n as Positive } = source;
    return value;
  }
  return null;
}

export function spreadArgument(n: number) {
  const iterable = {
    *[Symbol.iterator]() {
      n = dynamic;
      yield 0;
    },
  };
  if (n > 0) return Math.max(...iterable, n as Positive);
  return null;
}

export function sourceAndGuard(n: GreaterThanFive) {
  if (n < 10) return n as BetweenZeroAndTen;
  return null;
}

export const staticLiteral = 5 as Positive;
