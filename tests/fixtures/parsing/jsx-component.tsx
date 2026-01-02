import React, { useState, type FC, type ReactNode } from "react";

/**
 * Props for the Button component.
 */
export interface ButtonProps {
  /** Button text content */
  children: ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Button variant */
  variant?: "primary" | "secondary" | "danger";
  /** Whether the button is disabled */
  disabled?: boolean;
}

/**
 * A reusable button component.
 */
export const Button: FC<ButtonProps> = ({
  children,
  onClick,
  variant = "primary",
  disabled = false,
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  return (
    <button
      className={`btn btn-${variant}`}
      onClick={handleClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

/**
 * A counter component demonstrating hooks.
 */
export function Counter(): JSX.Element {
  const [count, setCount] = useState(0);

  const increment = () => setCount((c) => c + 1);
  const decrement = () => setCount((c) => c - 1);

  return (
    <div className="counter">
      <Button onClick={decrement}>-</Button>
      <span>{count}</span>
      <Button onClick={increment}>+</Button>
    </div>
  );
}

/**
 * Default exported component.
 */
export default function App(): JSX.Element {
  return (
    <div className="app">
      <h1>My App</h1>
      <Counter />
    </div>
  );
}
