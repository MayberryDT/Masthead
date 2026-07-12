import { useEffect, useRef } from "react";

type Props = {
  value: number;
  className?: string;
};

export function AnimatedNumber({ value, className = "" }: Props) {
  const elementRef = useRef<HTMLElement>(null);
  const previousValueRef = useRef<string | undefined>(undefined);
  const formattedValue = value.toLocaleString();

  useEffect(() => {
    const element = elementRef.current;
    const previousValue = previousValueRef.current;
    previousValueRef.current = formattedValue;

    if (!element || previousValue === undefined || previousValue === formattedValue) {
      return;
    }

    element.classList.remove("is-animating");
    void element.offsetHeight;
    element.classList.add("is-animating");

    const timeout = window.setTimeout(() => {
      element.classList.remove("is-animating");
    }, 240);

    return () => window.clearTimeout(timeout);
  }, [formattedValue]);

  return (
    <strong ref={elementRef} className={`t-digit-group ${className}`.trim()}>
      {Array.from(formattedValue).map((character, index, characters) => {
        const trailingIndex = characters.length - index - 1;
        return (
          <span
            className="t-digit"
            data-stagger={trailingIndex < 2 ? String(2 - trailingIndex) : undefined}
            key={`${index}-${character}`}
          >
            {character}
          </span>
        );
      })}
    </strong>
  );
}
