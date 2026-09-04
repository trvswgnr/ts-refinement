declare namespace JSX {
  interface IntrinsicElements {
    section: Record<string, never>;
  }
}

export const element = <section />;
